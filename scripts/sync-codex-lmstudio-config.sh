#!/bin/bash
set -e

CLAUDE_HOME="${CLAUDE_HOME:-/home/claude}"
CODEX_CONFIG_DIR="$CLAUDE_HOME/.codex"
CODEX_CONFIG_FILE="$CODEX_CONFIG_DIR/config.toml"

read_first_env() {
    for env_name in "$@"; do
        env_value="${!env_name}"
        if [ -n "${env_value:-}" ]; then
            printf '%s' "$env_value"
            return 0
        fi
    done
    return 1
}

normalize_base_url() {
    raw_value="$1"
    raw_value="${raw_value%"${raw_value##*[![:space:]]}"}"
    raw_value="${raw_value#"${raw_value%%[![:space:]]*}"}"
    raw_value="${raw_value%/}"

    if [ -z "$raw_value" ]; then
        return 1
    fi

    case "$raw_value" in
        http://*|https://*)
            ;;
        *)
            return 1
            ;;
    esac

    case "$raw_value" in
        */v1)
            printf '%s' "$raw_value"
            ;;
        *)
            printf '%s/v1' "$raw_value"
            ;;
    esac
}

upsert_toml_string() {
    key="$1"
    value="$2"
    escaped_value=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')

    if grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$CODEX_CONFIG_FILE" 2>/dev/null; then
        perl -0pi -e "s|^[[:space:]]*${key}[[:space:]]*=.*$|${key} = \\\"${escaped_value}\\\"|m" "$CODEX_CONFIG_FILE"
    else
        printf '\n%s = "%s"\n' "$key" "$escaped_value" >> "$CODEX_CONFIG_FILE"
    fi
}

mkdir -p "$CODEX_CONFIG_DIR"
touch "$CODEX_CONFIG_FILE"

configured_base_url="$(read_first_env HOLYCLAUDE_CODEX_BASE_URL CODEX_OSS_BASE_URL || true)"
configured_model="$(read_first_env HOLYCLAUDE_CODEX_MODEL CODEX_MODEL || true)"

if [ -n "$configured_base_url" ]; then
    normalized_base_url="$(normalize_base_url "$configured_base_url" || true)"
    if [ -n "$normalized_base_url" ]; then
        upsert_toml_string "model_provider" "lmstudio"
        upsert_toml_string "oss_provider" "lmstudio"
        upsert_toml_string "openai_base_url" "$normalized_base_url"
        echo "[entrypoint] Synced Codex LM Studio base URL from env"
    else
        echo "[entrypoint] WARNING: could not normalize HOLYCLAUDE_CODEX_BASE_URL/CODEX_OSS_BASE_URL"
    fi
fi

if [ -n "$configured_model" ]; then
    upsert_toml_string "model_provider" "lmstudio"
    upsert_toml_string "oss_provider" "lmstudio"
    upsert_toml_string "model" "$configured_model"
    echo "[entrypoint] Synced Codex LM Studio model from env"
fi
