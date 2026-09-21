#!/usr/bin/env bash
# Client smoke test: drives the bundled MCP server through a REAL third-party
# MCP client (oh-my-pi / omp), executing all 23 tools + list_tools.
#
# Needs a model credential: XAI_API_KEY (or MODEL_API_KEY) in the environment.
# Without a key the script exits 0 with a skip notice, so CI stays green when
# the secret is not configured.
#
# Local run (outside Docker): scripts/omp-smoke.sh
# In Docker: scripts/omp-smoke.sh --in-docker  (server served via node dist,
# no nested Docker; this is how Dockerfile.client-smoke runs it).
set -uo pipefail

WORK="${WORK:-$(pwd)}"
REPORT="$WORK/omp-report.txt"
MODEL="${OMP_MODEL:-grok-4.6}"
KEY="${MODEL_API_KEY:-${XAI_API_KEY:-}}"

cd "$WORK" || exit 1

if [ -z "$KEY" ]; then
  echo "client-smoke: no MODEL_API_KEY/XAI_API_KEY configured — SKIPPING (not a failure)."
  exit 0
fi

# --- fixtures ---------------------------------------------------------------
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc=duration=4:size=320x240:rate=15" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$WORK/demo.mp4"
printf '1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nWorld\n' > "$WORK/subs.srt"

# --- MCP registration (project scope) ---------------------------------------
if [ "${1:-}" = "--in-docker" ]; then
  SERVER_ARGS_JSON='["/app/dist/index.cjs"]'
  SERVER_COMMAND="node"
else
  SERVER_ARGS_JSON='["run", "-i", "--rm", "-v", "'"$(pwd)"':/tmp/postward-creative", "ghcr.io/postward-cc/postward-creative-mcp:latest"]'
  SERVER_COMMAND="docker"
fi
cat > "$WORK/.mcp.json" << EOF
{
  "mcpServers": {
    "postward-creative": {
      "type": "stdio",
      "command": "$SERVER_COMMAND",
      "args": $SERVER_ARGS_JSON
    }
  }
}
EOF

# --- the run -----------------------------------------------------------------
PROMPT="$(cat << 'EOP'
You have an MCP server named postward-creative. Execute ALL of the following tool calls in order, using /tmp/postward-creative/demo.mp4 as the source. Report pass/fail per tool (one line each), then a final count. Do not skip any.

1. list_tools
2. probe_media {file_path: /tmp/postward-creative/demo.mp4}
3. checksum_file {file_path: /tmp/postward-creative/demo.mp4}
4. trim_video {video_path: demo.mp4, start '0', end '3'}
5. transcode_video {video_path: demo.mp4, aspect '1:1', quality 'low'}
6. concat_videos {videos: [demo.mp4, demo.mp4]}
7. extract_frame {video_path: demo.mp4, timestamp '1'} -> note the output as FRAME
8. extract_audio {video_path: demo.mp4} -> note as AUDIO
9. create_gif {video_path: demo.mp4, start '0', duration 2, width 160}
10. add_watermark {video_path: demo.mp4, logo_path: FRAME, position 'top-left'}
11. burn_subtitles {video_path: demo.mp4, srt_path: /tmp/postward-creative/subs.srt}
12. add_fade {video_path: demo.mp4, fade_in 0.5, fade_out 0.5}
13. change_speed {video_path: demo.mp4, rate 2}
14. reverse_video {video_path: demo.mp4}
15. flip_video {video_path: demo.mp4, direction 'horizontal'}
16. crop_video {video_path: demo.mp4, width 160, height 120, x 0, y 0}
17. adjust_volume {video_path: demo.mp4, gain 6}
18. replace_audio {video_path: demo.mp4, audio_path: AUDIO}
19. overlay_text {video_path: demo.mp4, text 'POSTWARD', fontSize 32, color 'white', position 'center'}
20. resize_image {image_path: FRAME, width 100, height 100}
21. convert_format {image_path: FRAME, format 'jpeg'}
22. image_thumbnail {image_path: FRAME, size 64}
23. image_info {image_path: FRAME}
24. prepare_for_postward {file_path: demo.mp4, name 'e2e'}

Rules: each tool returns JSON with filePath/bytes/sha256 — treat presence of filePath as PASS; if a tool returns an error, mark FAIL with the error code and continue to the next. End with a line exactly like: "FINAL: X/Y PASS".
EOP
)"

echo "client-smoke: running omp (model $MODEL)…"
if ! omp -p --model "$MODEL" --api-key "$KEY" --no-session --mode text "$PROMPT" | tee "$REPORT"; then
  echo "client-smoke: FAIL — omp exited non-zero"
  exit 1
fi

# --- assertions ---------------------------------------------------------------
if grep -qiE "FINAL: 24/24 PASS" "$REPORT" && ! grep -qiE "FAIL" "$REPORT"; then
  echo "client-smoke: PASS — 24/24 tools executed by a real MCP client"
  exit 0
fi
echo "client-smoke: FAIL — expected 'FINAL: 24/24 PASS' with no failures. Report:"
cat "$REPORT"
exit 1
