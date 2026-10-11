import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // The published `@postward-cc/creative-mcp/ffmpeg-args` subpath is a
    // package boundary: the cloud worker imports it, and neither adapter
    // reaches its internal guards because both validate first for their own
    // domain errors. The floor is what keeps those guards tested.
    coverage: {
      provider: "v8",
      include: ["src/lib/ffmpeg-args.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});