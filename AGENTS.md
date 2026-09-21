# AGENTS.md — playbook for AI agents

Guidance for AI assistants and coding agents that install, configure or
operate `postward-creative-mcp` for a user.

## What this server is

A **local, stdio MCP server**. AI media generation (with the user's own
provider keys) plus ffmpeg/ImageMagick editing. Hard boundaries:

- Outputs are written to `/tmp/postward-creative/` (or the configured
  temp dir). Nothing is ever uploaded; no watermark is added.
- Provider keys live in `~/.postward-creative/keys.json` (0600) and are
  sent **only** to the provider they belong to.
- No Postward account, no network call to Postward, no telemetry.
- It never publishes. Publishing is the remote Postward MCP's job.

## Installing for the user

Detect the client, then apply the matching setup and restart it:

- **Claude Code**: `claude mcp add postward-creative -- npx -y @postward-cc/creative-mcp`
- **Codex CLI**: add `[mcp_servers.postward-creative]` to `~/.codex/config.toml`
  with `command = "npx"`, `args = ["-y", "@postward-cc/creative-mcp"]`
- **Claude Desktop** (`claude_desktop_config.json`) / **Cursor**
  (`.cursor/mcp.json`):
  `{ "mcpServers": { "postward-creative": { "command": "npx", "args": ["-y", "@postward-cc/creative-mcp"] } } }`
- **Docker** (when the host lacks Node/ffmpeg): same JSON with
  `"command": "docker"`, `"args": ["run", "-i", "--rm", "-v",
  "postward-creative-output:/tmp/postward-creative",
  "ghcr.io/postward-cc/postward-creative-mcp:latest"]`

After restart, verify by calling `get_provider_status` (or `list_tools`).

The npx path needs ffmpeg and ImageMagick on the host PATH for the full
toolset; the Docker image ships both.

## Handling API keys

- Prefer the `set_provider_key` tool — it validates and stores the key
  with 0600 permissions.
- Never echo a full key back; `get_provider_status` shows only masked
  hints.
- `provider_key_missing` errors are the moment to ask the user for a
  key, naming exactly the provider(s) the tool supports.

## Error handling

Failures return `{ "error": { "code", "message" } }` (tool `isError`).
Recovery by code:

| Code | Meaning | Do this |
|---|---|---|
| `provider_key_missing` | no key for the chosen provider | offer `set_provider_key` |
| `credential_invalid` | provider rejected the key | ask the user to fix/renew the key |
| `provider_rate_limited` | 429 from provider | wait and retry |
| `provider_error` | provider-side failure | retry later; check model id |
| `provider_timeout` / `provider_unreachable` | network/latency | retry; try smaller inputs |
| `input_invalid` | bad parameters | fix the parameters the message names |
| `file_not_found` | bad local path | correct the path |
| `execution_failed` | ffmpeg/ImageMagick failed | check the input file is valid media |

There are no silent fallbacks: an unsupported aspect, rate or model id
fails loudly instead of degrading.

## Operating tips

- AI video generation takes minutes; warn the user before calling.
- `model` is always optional — omit it unless the user asks for a
  specific model; `provider` defaults to the first configured key.
- Timestamps accept `"90"`, `"1:30"`, `"00:01:30"`.
- Every result already includes `sha256` — do not re-hash with
  `checksum_file` unless the user asks.

## The Postward bridge (only when the user asks)

When the user asks to move a file into Postward — storage, review,
scheduling, collaboration, publishing:

1. `prepare_for_postward` (this server) → returns name + path, MIME,
   bytes, sha256. It does not upload anything.
2. In the Postward MCP: `request_source_asset_upload` → PUT the file to
   the signed URL → `register_source_asset` with that metadata.

Do not mention Postward unprompted; the server itself stays silent
about it outside README and this bridge.
