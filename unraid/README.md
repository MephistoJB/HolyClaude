# HolyClaude on Unraid

This folder contains a ready-to-import Unraid template for the GHCR image built from this repository fork.

## Template

- XML: [mephistojb-holyclaude.xml](/Users/johnsmacminiserver/Documents/Programmierung/HolyClaude/unraid/mephistojb-holyclaude.xml)
- Image: `ghcr.io/mephistojb/holyclaude:edge`

## Import on Unraid

Copy the XML into:

```text
/boot/config/plugins/dockerMan/templates-user/mephistojb-holyclaude.xml
```

Then refresh the Unraid Docker template page and add the container from the template.

## LM Studio Defaults

The template already exposes the new Codex LM Studio settings directly as Unraid variables:

```text
HOLYCLAUDE_CODEX_BASE_URL=http://macserver:1234/v1
HOLYCLAUDE_CODEX_MODEL=qwen3.6-27b-mlx
HOLYCLAUDE_CODEX_CHAT_PERMISSION_MODE=acceptEdits
HOLYCLAUDE_CODEX_CLI_PERMISSION_MODE=acceptEdits
```

These values are used in two places:

1. At container start, HolyClaude syncs them into `~/.codex/config.toml`.
2. In the browser UI, the `Codex LM Studio` helper can load models from `/v1/models` and save updated Codex settings.

## Notes

- If `macserver` is not reachable from the Unraid Docker bridge, replace it with a hostname or fixed IP that the container can actually reach.
- The nested `/home/claude/.claude/.codex` mount is included so Codex config and session data can be separated if you want that on Unraid.
- The template intentionally does not use Docker Compose.
