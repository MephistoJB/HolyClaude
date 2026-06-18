#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?usage: docker_persistence_smoke.sh <image> [label]}"
LABEL="${2:-local}"
SAVE_TIMEOUT="${HOLYCLAUDE_PERSIST_SMOKE_TIMEOUT:-180}"
SYNC_INTERVAL="${HOLYCLAUDE_PERSIST_SMOKE_INTERVAL:-5}"
TMP_DIR="$(mktemp -d)"
CONTAINER="holyclaude-persist-${LABEL}-$$"

dump_debug() {
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
    echo "::group::holyclaude persistence container logs"
    docker logs "$CONTAINER" || true
    echo "::endgroup::"

    echo "::group::holyclaude persistence container state"
    docker exec "$CONTAINER" sh -lc 'ls -la /home/claude /home/claude/.claude 2>/dev/null || true' || true
    docker exec -i "$CONTAINER" node - <<'NODE' || true
const fs = require('node:fs');
for (const file of ['/home/claude/.claude.json', '/home/claude/.claude/.claude.json.persist']) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`${file}:`, {
      keys: Object.keys(data),
      emailAddress: data.oauthAccount?.emailAddress ?? null,
      hasCompletedOnboarding: data.hasCompletedOnboarding ?? null,
      installMethod: data.installMethod ?? null
    });
  } catch (error) {
    console.log(`${file}: ${error.message}`);
  }
}
NODE
    echo "::endgroup::"
  fi

  echo "::group::holyclaude persistence host state"
  ls -la "$CLAUDE_DIR" 2>/dev/null || true
  node - "$CLAUDE_DIR/.claude.json.persist" <<'NODE' || true
const fs = require('node:fs');
const [file] = process.argv.slice(2);
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${file}:`, {
    keys: Object.keys(data),
    emailAddress: data.oauthAccount?.emailAddress ?? null,
    hasCompletedOnboarding: data.hasCompletedOnboarding ?? null,
    installMethod: data.installMethod ?? null
  });
} catch (error) {
  console.log(`${file}: ${error.message}`);
}
NODE
  echo "::endgroup::"
}

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}

trap dump_debug ERR
trap cleanup EXIT

CLAUDE_DIR="$TMP_DIR/claude"
WORKSPACE_DIR="$TMP_DIR/workspace"
mkdir -p "$CLAUDE_DIR" "$WORKSPACE_DIR"

write_json() {
  local target="$1"
  local email="$2"
  node - "$target" "$email" <<'NODE'
const fs = require('node:fs');
const [target, email] = process.argv.slice(2);
fs.writeFileSync(target, JSON.stringify({
  projects: {
    '/workspace': {
      allowedTools: ['Bash']
    }
  },
  oauthAccount: {
    emailAddress: email
  }
}));
NODE
}

assert_container_state() {
  local expected_email="$1"
  docker exec -i "$CONTAINER" node - "$expected_email" <<'NODE'
const fs = require('node:fs');
const [expectedEmail] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync('/home/claude/.claude.json', 'utf8'));
const actualEmail = data.oauthAccount?.emailAddress ?? null;
if (actualEmail !== expectedEmail) {
  console.error(`expected live state for ${expectedEmail}; saw ${actualEmail ?? 'no oauthAccount.emailAddress'}`);
  process.exit(1);
}
NODE
}

assert_host_persisted_state() {
  local expected_email="$1"
  node - "$CLAUDE_DIR/.claude.json.persist" "$expected_email" <<'NODE'
const fs = require('node:fs');
const [persistedPath, expectedEmail] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(persistedPath, 'utf8'));
if (data.oauthAccount?.emailAddress !== expectedEmail) {
  console.error(`expected persisted state for ${expectedEmail}`);
  process.exit(1);
}
NODE
}

wait_for_host_persisted_state() {
  local expected_email="$1"
  local deadline=$((SECONDS + SAVE_TIMEOUT))

  while ! assert_host_persisted_state "$expected_email" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      assert_host_persisted_state "$expected_email"
      return 1
    fi
    sleep 5
  done
}

assert_container_default_state() {
  docker exec -i "$CONTAINER" node - <<'NODE'
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync('/home/claude/.claude.json', 'utf8'));
if (data.hasCompletedOnboarding !== true || data.installMethod !== 'native') {
  console.error('expected default live Claude state');
  process.exit(1);
}
NODE
}

wait_for_container_state() {
  local expected_email="$1"
  local deadline=$((SECONDS + SAVE_TIMEOUT))

  while ! assert_container_state "$expected_email" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      assert_container_state "$expected_email"
      return 1
    fi
    sleep 2
  done
}

wait_for_container_default_state() {
  local deadline=$((SECONDS + SAVE_TIMEOUT))

  while ! assert_container_default_state >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      assert_container_default_state
      return 1
    fi
    sleep 2
  done
}

start_container() {
  docker run -d \
    --name "$CONTAINER" \
    -e PUID="$(id -u)" \
    -e PGID="$(id -g)" \
    -e HOLYCLAUDE_CLAUDE_JSON_SYNC_INTERVAL="$SYNC_INTERVAL" \
    -v "$CLAUDE_DIR:/home/claude/.claude" \
    -v "$WORKSPACE_DIR:/workspace" \
    "$IMAGE" >/dev/null
}

write_json "$CLAUDE_DIR/.claude.json.persist" "persisted-before-start@example.invalid"

start_container
wait_for_container_state "persisted-before-start@example.invalid"

docker exec -i "$CONTAINER" node - <<'NODE'
const fs = require('node:fs');
fs.writeFileSync('/home/claude/.claude.json', JSON.stringify({
  projects: {
    '/workspace/runtime': {
      allowedTools: ['Edit']
    }
  },
  oauthAccount: {
    emailAddress: 'runtime-saved@example.invalid'
  }
}));
NODE

wait_for_host_persisted_state "runtime-saved@example.invalid"

docker rm -f "$CONTAINER" >/dev/null
start_container
wait_for_container_state "runtime-saved@example.invalid"
docker rm -f "$CONTAINER" >/dev/null

printf '{not json' > "$CLAUDE_DIR/.claude.json.persist"
start_container
wait_for_container_default_state

if ! find "$CLAUDE_DIR" -maxdepth 1 -name '.claude.json.persist.invalid.*' | grep -q .; then
  docker logs "$CONTAINER" || true
  echo "expected invalid persisted backup" >&2
  exit 1
fi

assert_container_default_state
