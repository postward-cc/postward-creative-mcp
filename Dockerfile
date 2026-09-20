# Multi-stage build: compile TypeScript, then ship a media-capable runtime.
# The runtime image carries ffmpeg (all codecs), ImageMagick and DejaVu fonts
# so users never install media tooling on the host machine.

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && node esbuild.config.mjs

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    imagemagick \
    fonts-dejavu-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/dist/index.cjs ./dist/index.cjs
# Tools write outputs here — mount a volume for large files.
VOLUME ["/tmp/postward-creative"]
ENTRYPOINT ["node", "dist/index.cjs"]
