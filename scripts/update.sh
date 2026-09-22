#!/usr/bin/env bash
# Update the local postward-creative-mcp image to the newest release.
#
# This is the ONLY command in this project that touches the network — the
# MCP server itself makes zero network calls, always. Updating is an explicit,
# user-initiated action.
#
# Usage: scripts/update.sh
set -euo pipefail

IMAGE="ghcr.io/postward-cc/postward-creative-mcp:latest"

digest() {
  docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null | awk -F@ '{print $2}'
}

echo "pulling $IMAGE …"
old=$(digest || true)
docker pull "$IMAGE"
new=$(digest)

if [ -z "$old" ]; then
  echo "installed: $new"
elif [ "$old" = "$new" ]; then
  echo "already up to date."
else
  echo "updated:"
  echo "  old: $old"
  echo "  new: $new"
fi

echo
echo "Restart your AI assistant so new sessions pick up the new image."
echo "Not sure which version is running? Ask your assistant — the server"
echo "reports its version in the MCP handshake (or check the release notes:"
echo "https://github.com/postward-cc/postward-creative-mcp/releases)."
