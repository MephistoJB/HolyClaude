#!/bin/bash
set -e

CLAUDE_HOME="${CLAUDE_HOME:-/home/claude}"
CODEX_CONFIG_DIR="$CLAUDE_HOME/.codex"
CODEX_CONFIG_FILE="$CODEX_CONFIG_DIR/config.toml"
HOLYCLAUDE_CODEX_PROVIDER_ID="holyclaude_lmstudio"
MANAGED_BLOCK_START="# >>> HolyClaude Codex LM Studio >>>"
MANAGED_BLOCK_END="# <<< HolyClaude Codex LM Studio <<<"

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

remove_existing_lmstudio_settings() {
    perl -0pi -e 's/^\Q'"$MANAGED_BLOCK_START"'\E\n.*?^\Q'"$MANAGED_BLOCK_END"'\E\n?//ms' "$CODEX_CONFIG_FILE"
    perl -0pi -e 's/^[[:space:]]*(model_provider|oss_provider|openai_base_url|model)[[:space:]]*=.*\n//mg' "$CODEX_CONFIG_FILE"
    perl -0pi -e 's/^\[model_providers\.holyclaude_lmstudio\]\n(?:[^\n]*\n)*?(?=^\[|\z)//msg' "$CODEX_CONFIG_FILE"
}

insert_managed_block() {
    managed_block="$1"
    tmp_file="$(mktemp)"
    awk -v block="$managed_block" '
        BEGIN { inserted = 0 }
        /^\[/ && inserted == 0 {
            print block
            print ""
            inserted = 1
        }
        { print }
        END {
            if (inserted == 0) {
                if (NR > 0) {
                    print ""
                }
                print block
            }
        }
    ' "$CODEX_CONFIG_FILE" > "$tmp_file"
    mv "$tmp_file" "$CODEX_CONFIG_FILE"
}

mkdir -p "$CODEX_CONFIG_DIR"
touch "$CODEX_CONFIG_FILE"

configured_base_url="$(read_first_env HOLYCLAUDE_CODEX_BASE_URL CODEX_OSS_BASE_URL || true)"
configured_model="$(read_first_env HOLYCLAUDE_CODEX_MODEL CODEX_MODEL || true)"
managed_block=""

if [ -n "$configured_base_url" ]; then
    normalized_base_url="$(normalize_base_url "$configured_base_url" || true)"
    if [ -n "$normalized_base_url" ]; then
        managed_block="${MANAGED_BLOCK_START}
model_provider = \"${HOLYCLAUDE_CODEX_PROVIDER_ID}\"

[model_providers.${HOLYCLAUDE_CODEX_PROVIDER_ID}]
name = \"LM Studio (HolyClaude)\"
base_url = \"${normalized_base_url}\"
wire_api = \"responses\""
        echo "[entrypoint] Synced Codex LM Studio base URL from env"
    else
        echo "[entrypoint] WARNING: could not normalize HOLYCLAUDE_CODEX_BASE_URL/CODEX_OSS_BASE_URL"
    fi
fi

if [ -n "$configured_model" ]; then
    if [ -z "$managed_block" ]; then
        managed_block="${MANAGED_BLOCK_START}
model_provider = \"${HOLYCLAUDE_CODEX_PROVIDER_ID}\""
    fi
    managed_block="${managed_block}
model = \"${configured_model}\""
    echo "[entrypoint] Synced Codex LM Studio model from env"
fi

remove_existing_lmstudio_settings

if [ -n "$managed_block" ]; then
    managed_block="${managed_block}
${MANAGED_BLOCK_END}"
    insert_managed_block "$managed_block"
fi
