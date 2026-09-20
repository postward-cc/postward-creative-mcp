# postward-creative-mcp

**AI media generation and video editing on your own machine, driven by the AI
assistant you already use.** Your files, your API keys, no account, no
watermark, no telemetry.

`postward-creative-mcp` is a local **MCP server** (Model Context Protocol —
the standard way AI assistants like Claude, ChatGPT, Cursor or Codex talk to
external tools). Once connected, your AI assistant can generate images,
videos, music and voiceovers with **your own** provider keys, and edit video
locally with ffmpeg — by simply asking for it in plain language.

```
You:  "Create a 10-second vertical video for my product launch and add my logo."
AI:   → generate_image (your fal/OpenAI key)
      → generate_voiceover (your OpenAI/ElevenLabs key)
      → animate_image + overlay_text + trim_video (ffmpeg, local)
      → "Done: /tmp/postward-creative/launch-video.mp4"
```

---

## Two products, one ecosystem

Postward ships **two** MCP servers with different jobs:

| | **postward-creative-mcp** (this repo) | **Postward MCP** (postward.cc) |
|---|---|---|
| What it does | Generates and edits media **on your machine** | Schedules, reviews, approves and **publishes** content |
| Runs on | Your computer (Docker or Node.js) | Postward's servers |
| AI keys | Yours, stored locally | Yours, sealed server-side |
| Output | Local files + metadata | Workspace assets in Postward storage |
| Cost | **Free, open source, no account** | Paid plans with credit metering |
| Publishing | ❌ never | ✅ via review + approval |
| Account required | ❌ never | ✅ |

**This server never publishes anything, never uploads anything, and never
talks to Postward.** It is a complete standalone product. If you later want
durable asset storage, team review, approval flows, scheduling or social
publishing, the [Postward MCP](https://postward.cc) picks up exactly where
this tool ends — one of its tools (`prepare_for_postward`) even formats your
file's metadata for that handoff. But that's optional, and nothing in this
repo nags you about it.

---

## Installation

You need **one** of these:

- **Docker** (recommended — includes ffmpeg, ImageMagick and fonts; nothing
  else to install), or
- **Node.js 22+** if you prefer no Docker. For local install, ffmpeg and
  ImageMagick must be on your PATH (`apt install ffmpeg imagemagick` on
  Debian/Ubuntu, `brew install ffmpeg imagemagick` on macOS).

### Option A — npx (simplest, no Docker)

Add this to your AI assistant's MCP configuration (e.g. in Claude Desktop:
*Settings → Developer → Edit Config*):

```json
{
  "mcpServers": {
    "postward-creative": {
      "command": "npx",
      "args": ["-y", "@postward/creative-mcp"]
    }
  }
}
```

### Option B — Docker

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
media?"* and it will discover this server.

---

## Setting your AI keys (optional, 2 minutes)

The editing tools (trim, crop, subtitles, GIFs, …) need **no key at all** —
they run locally. AI generation tools need a key from the provider you want
to use ([fal.ai](https://fal.ai), [OpenAI](https://platform.openai.com),
[ElevenLabs](https://elevenlabs.io), [Stability](https://platform.stability.ai),
[Replicate](https://replicate.com), [Runway](https://runwayml.com)).

Two ways to configure:

1. **Just ask your assistant:** *"Set my fal key to `key:xyz…`"* — it will
   call `set_provider_key` for you, or
2. Edit the file directly: `~/.postward-creative/keys.json`

```json
{
  "fal": "your-fal-key",
  "openai": "sk-..."
}
```

Keys are stored with file permission 0600 in your home folder. **They are
sent only to the provider they belong to, directly over HTTPS.** They are
never sent to Postward, never sent between providers, never logged, and this
server makes no other network calls.

Check status anytime: *"Which AI providers do I have configured?"* →
`get_provider_status`.

---

## What your assistant can do

### AI generation (your provider keys)

| Tool | What it does |
|---|---|
| `generate_image` | Image from a text description (fal FLUX, OpenAI DALL-E 3, Stability) |
| `generate_video` | Short video from a description (fal, Runway) |
| `animate_image` | Image → video (fal image-to-video) |
| `generate_voiceover` | Text → speech (fal, OpenAI TTS, ElevenLabs) |
| `generate_music` | Instrumental music from a description (fal) |
| `edit_image` | Edit an image with an instruction ("make the background blue") |
| `remove_background` | Transparent PNG background removal (Replicate, fal) |
| `replace_background` | AI background replacement (fal) |
| `upscale_image` | 2x/4x upscale (Replicate Real-ESRGAN, fal) |

Every tool accepts a `model` parameter to pick a specific model; omit it for
a sensible default. When several providers support a tool and you have keys
for more than one, omit `provider` to use the first configured one.

### Video editing (ffmpeg — free, local, no keys)

`trim_video`, `concat_videos`, `transcode_video` (9:16 / 1:1 / 16:9),
`extract_frame`, `extract_audio`, `create_gif`, `add_watermark`,
`burn_subtitles`, `add_fade`, `change_speed`, `reverse_video`, `flip_video`,
`crop_video`, `adjust_volume`, `replace_audio`, `overlay_text`

### Image tools (ImageMagick — free, local, no keys)

`resize_image`, `convert_format` (PNG ↔ JPEG ↔ WebP), `image_thumbnail`,
`image_info`

### Utilities

| Tool | What it does |
|---|---|
| `probe_media` | Duration, resolution, codecs, bitrate of any media file |
| `checksum_file` | SHA-256 of any file |
| `list_tools` | Everything this server offers, in one list |
| `get_provider_status` | Which keys are configured (masked) |
| `set_provider_key` | Store a provider key locally |

### The optional Postward bridge

| Tool | What it does |
|---|---|
| `prepare_for_postward` | Formats a local file's metadata (path, MIME, bytes, SHA-256) for Postward's upload flow. No upload, no auth — just the handoff info. |

---

## Every result is portable

Every generation and edit returns:

```json
{
  "filePath": "/tmp/postward-creative/a1b2….png",
  "mimeType": "image/png",
  "bytes": 1048576,
  "sha256": "9f86d081884c7d65…"
}
```

The file is yours — a plain local file with a checksum and its MIME type.
No account needed to open it, no watermark on it, no strings attached.

---

## Non-negotiable principles

1. **No Postward account required** — works 100% offline (only AI
   generation calls the provider you configured).
2. **No watermark** on any output — ever.
3. **No hidden telemetry** — zero network calls except to your chosen AI
   provider.
4. **No feature gating** behind Postward signup — every tool works standalone.
5. **API keys stay local** — sent only to the provider they belong to.
6. **No silent fallbacks** — errors carry machine codes and sanitized
   messages; wrong inputs fail loudly instead of degrading.

---

## How it differs from hosted AI tools

- **Your keys, your bill.** You pay providers directly at cost; there is no
  middleman markup.
- **Your machine, your files.** Media never sits on someone else's server.
- **Standard MCP.** Works with any MCP-capable assistant — Claude Desktop,
  ChatGPT desktop, Cursor, Codex CLI, and anything else that speaks MCP.
- **Open source, MIT licensed.** Audit it, fork it, self-host it.

## When Postward makes sense

The moment content needs to leave your laptop — scheduling to multiple
social accounts, a teammate reviewing before anything goes out, an approval
trail for clients, one library of every asset — that's
[Postward](https://postward.cc). The local tool generates; Postward
governs and publishes. The handoff is one step, and it's optional forever.

---

## Development

```bash
git clone https://github.com/postward-cc/postward-creative-mcp
cd postward-creative-mcp
npm install
npm run typecheck   # strict TypeScript
npm test            # unit + provider (mocked HTTP) + real ffmpeg/IM integration tests
npm run build       # typecheck + esbuild bundle → dist/index.cjs
```

- **Stack:** TypeScript, Node.js 22+, official MCP SDK, esbuild.
- **Tests:** pure ffmpeg argument builders are pinned by unit tests (no
  mocking); provider clients are tested at the fetch boundary; integration
  tests run real ffmpeg/ImageMagick when the binaries are available (they
  install them in CI, and the Docker image ships them).
- **Releases:** pushing a `v*` tag publishes the Docker image to
  `ghcr.io/postward-cc/postward-creative-mcp` and the package to npm
  (`@postward/creative-mcp`).

## License

[MIT](./LICENSE) — © Postward
