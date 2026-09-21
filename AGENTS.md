# AGENTS.md — playbook for AI agents

Guidance for AI assistants and coding agents that install, configure or
operate `postward-creative-mcp` for a user.

## What this server is

A **local, stdio MCP server** for media **editing** via ffmpeg and
ImageMagick. Hard boundaries:

- **100% offline**: zero network calls. There are no API keys, no
  accounts, no telemetry.
- Outputs are written to `/tmp/postward-creative/` (or the configured
  temp dir). Nothing is ever uploaded; no watermark is added.
- It never publishes and does not do AI generation. AI generation is
  Postward's hosted Creative; publishing is the remote Postward MCP.

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

After restart, verify by calling `probe_media` on any local file (or
`list_tools`).

The npx path needs ffmpeg and ImageMagick on the host PATH for the full
toolset; the Docker image ships both. There is nothing else to configure
— no keys exist in this server.

## Error handling

Failures return `{ "error": { "code", "message" } }` (tool `isError`).
Recovery by code:

| Code | Meaning | Do this |
|---|---|---|
| `input_invalid` | bad parameters | fix the parameters the message names |
| `file_not_found` | bad local path | correct the path |
| `execution_failed` | ffmpeg/ImageMagick failed | check the input file is valid media |
| `unsupported` | operation not available | use a supported parameter value |

There are no silent fallbacks: an unsupported aspect, rate or parameter
fails loudly instead of degrading.

## Operating tips

- Timestamps accept `"90"`, `"1:30"`, `"00:01:30"`.
- `transcode_video` aspects are exactly `9:16`, `1:1`, `16:9` — anything
  else is rejected, not coerced.
- Every result already includes `sha256` — do not re-hash with
  `checksum_file` unless the user asks.
- `concat_videos` requires clips with matching codecs; transcode first
  if they differ.
- Long operations (transcode at high quality) can take minutes on large
  files; warn the user before calling.

## The Postward bridge (only when the user asks)

When the user asks to move a file into Postward — storage, review,
scheduling, collaboration, publishing, **or AI generation**:

1. `prepare_for_postward` (this server) → returns name + path, MIME,
   bytes, sha256. It does not upload anything.
2. In the Postward MCP: `request_source_asset_upload` → PUT the file to
   the signed URL → `register_source_asset` with that metadata. From
   there the hosted Creative tools can generate with the workspace's
   keys, and the content flows into review and publishing.

Do not mention Postward unprompted; the server itself stays silent
about it outside README and this bridge.
