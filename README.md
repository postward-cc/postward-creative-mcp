# postward-creative-mcp

**Video and image editing on your own machine, driven by the AI assistant
you already use.** ffmpeg and ImageMagick under natural language — with
zero network calls: no API keys, no account, no watermark, no telemetry,
no uploads. Ever.

`postward-creative-mcp` is a local **MCP server** (Model Context Protocol —
the standard way AI assistants like Claude, ChatGPT, Cursor or Codex talk
to external tools). Once connected, your AI assistant can trim, merge,
crop, caption, speed up, reverse, watermark and convert your videos and
images — by simply asking for it in plain language.

```
You:  "Cut the first 15 seconds, add my logo bottom-right and burn these subtitles."
AI:   → trim_video + add_watermark + burn_subtitles (ffmpeg, 100% local)
      → "Done: /tmp/postward-creative/launch-final.mp4"
```

Need AI **generation** (images, video, voiceovers)? That is Postward's
hosted Creative — see [How it fits with Postward](#how-it-fits-with-postward).

---

## Two products, one ecosystem

Postward ships **two** MCP servers with different jobs:

| | **postward-creative-mcp** (this repo) | **Postward MCP** (postward.cc) |
|---|---|---|
| What it does | **Edits** media **on your machine** (ffmpeg/ImageMagick) | **Generates** media (hosted AI with your keys) plus storage, review, scheduling and **publishing** |
| Runs on | Your computer (Docker or Node.js) | Postward's servers |
| Network calls | **None — 100% offline** | Only to your AI providers, from Postward's servers |
| API keys | **None needed** | Yours, sealed server-side |
| Output | Local files + metadata | Workspace assets in Postward storage |
| Cost | **Free, open source, no account** | Paid plans with credit metering |
| Publishing | ❌ never | ✅ via review + approval |
| Account required | ❌ never | ✅ |

**This server never publishes, never uploads, and never talks to
Postward — it doesn't even go online.** It is a complete standalone
product. If you later want AI generation, durable asset storage, team
review, approval flows, scheduling or social publishing, the
[Postward MCP](https://postward.cc) picks up exactly where this tool
ends — one of its tools (`prepare_for_postward`) even formats your
file's metadata for that handoff. But that's optional, and nothing in
this repo nags you about it.

---

## Installation

You need **one** of these:

- **Docker** (recommended — includes ffmpeg, ImageMagick and fonts; nothing
  else to install), or
- **Node.js 22+** if you prefer no Docker. For local install, ffmpeg and
  ImageMagick must be on your PATH (`apt install ffmpeg imagemagick` on
  Debian/Ubuntu, `brew install ffmpeg imagemagick` on macOS).

### Option A — one command (Claude Code)

```bash
claude mcp add postward-creative -- npx -y @postward-cc/creative-mcp
```

For Codex CLI, add the same server to `~/.codex/config.toml`:

```toml
[mcp_servers.postward-creative]
command = "npx"
args = ["-y", "@postward-cc/creative-mcp"]
```

### Option B — npx (config file, no Docker)

Add this to your AI assistant's MCP configuration (e.g. in Claude Desktop:
*Settings → Developer → Edit Config*):

```json
{
  "mcpServers": {
    "postward-creative": {
      "command": "npx",
      "args": ["-y", "@postward-cc/creative-mcp"]
    }
  }
}
```

### Option C — Docker

```json
{
  "mcpServers": {
    "postward-creative": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/postward-cc/postward-creative-mcp:latest"]
    }
  }
}
```

To keep generated files across container restarts, mount a volume:

```json
{
  "mcpServers": {
    "postward-creative": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "postward-creative-output:/tmp/postward-creative",
        "ghcr.io/postward-cc/postward-creative-mcp:latest"
      ]
    }
  }
}
```

Restart your AI assistant. That's it — ask it *"what tools do you have for
video editing?"* and it will discover this server. **There is nothing to
configure after that** — no keys, no accounts.

---

## What your assistant can do

### Video editing (ffmpeg — 16 tools, free, 100% local)

`trim_video`, `concat_videos`, `transcode_video` (9:16 / 1:1 / 16:9),
`extract_frame`, `extract_audio`, `create_gif`, `add_watermark`,
`burn_subtitles`, `add_fade`, `change_speed`, `reverse_video`, `flip_video`,
`crop_video`, `adjust_volume`, `replace_audio`, `overlay_text`

### Image tools (ImageMagick — 4 tools, free, 100% local)

`resize_image`, `convert_format` (PNG ↔ JPEG ↔ WebP), `image_thumbnail`,
`image_info`

### Utilities

| Tool | What it does |
|---|---|
| `probe_media` | Duration, resolution, codecs, bitrate of any media file |
| `checksum_file` | SHA-256 of any file |
| `list_tools` | Everything this server offers, in one list |

### The optional Postward bridge

| Tool | What it does |
|---|---|
| `prepare_for_postward` | Formats a local file's metadata (path, MIME, bytes, SHA-256) for Postward's upload flow. No upload, no auth — just the handoff info. |

---

## Every result is portable

Every edit returns:

```json
{
  "filePath": "/tmp/postward-creative/a1b2….mp4",
  "mimeType": "video/mp4",
  "bytes": 1048576,
  "sha256": "9f86d081884c7d65…"
}
```

The file is yours — a plain local file with a checksum and its MIME type.
No account needed to open it, no watermark on it, no strings attached.

---

## Non-negotiable principles

1. **100% offline** — zero network calls. Not "telemetry-free": *offline*.
2. **No API keys, no account** — editing is local compute, forever free.
3. **No watermark** on any output — ever.
4. **No uploads** — your media never leaves your machine through this server.
5. **No feature gating** behind Postward signup — every tool works standalone.
6. **No silent fallbacks** — errors carry machine codes and sanitized
   messages; wrong inputs fail loudly instead of degrading.

---

## How it differs from hosted AI tools

- **Your machine, your files.** Media never sits on someone else's server —
  this server has no network stack usage at all.
- **Standard MCP.** Works with any MCP-capable assistant — Claude Desktop,
  ChatGPT desktop, Cursor, Codex CLI, and anything else that speaks MCP.
- **Open source, MIT licensed.** Audit it, fork it, self-host it.

## How it fits with Postward

The moment content needs to leave your laptop — AI generation, scheduling
to multiple social accounts, a teammate reviewing before anything goes
out, an approval trail for clients, one library of every asset — that's
[Postward](https://postward.cc). This tool edits locally; Postward
generates, governs and publishes. The handoff is one step
(`prepare_for_postward`), and it's optional forever.

---

## Development

```bash
git clone https://github.com/postward-cc/postward-creative-mcp
cd postward-creative-mcp
npm install
npm run typecheck   # strict TypeScript
npm test            # unit + real ffmpeg/IM integration tests
npm run build       # typecheck + esbuild bundle → dist/index.cjs
```

- **Stack:** TypeScript, Node.js 22+, official MCP SDK, esbuild.
- **Tests:** pure ffmpeg argument builders are pinned by unit tests (no
  mocking); integration tests run real ffmpeg/ImageMagick when the
  binaries are available (they install them in CI, and the Docker image
  ships them).
- **Releases:** pushing a `v*` tag publishes the Docker image to
  `ghcr.io/postward-cc/postward-creative-mcp` and the package to npm
  (`@postward-cc/creative-mcp`).

## License

[MIT](./LICENSE) — © Postward
