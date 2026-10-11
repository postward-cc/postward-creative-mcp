# Multi-stage build: compile TypeScript, then ship a media-capable runtime.
# The runtime image carries ffmpeg (all codecs), ImageMagick and DejaVu fonts
# so users never install media tooling on the host machine.

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && node esbuild.config.mjs

# The media toolchain, and nothing else.
#
# Published on its own as `ghcr.io/postward-cc/creative-mcp-media:<release tag>`
# so a server-side image that has to run the same ffmpeg and ImageMagick can
# build FROM it instead of repeating this apt line — where the two copies would
# drift, as they already had once (the hosted worker carried an extra openssl
# that this image never installed).
#
# It is deliberately bare: no WORKDIR, no entrypoint, no volume. A base image
# that declared an entrypoint would force every consumer to reset it.
FROM node:24-bookworm-slim AS media
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    imagemagick \
    fonts-dejavu-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM media AS runtime
WORKDIR /app
COPY --from=builder /app/dist/index.cjs ./dist/index.cjs
# Tools write outputs here — mount a volume for large files.
VOLUME ["/tmp/postward-creative"]
ENTRYPOINT ["node", "dist/index.cjs"]