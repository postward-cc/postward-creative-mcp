import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/index.cjs",
  // npm bin entries are executed directly and need a shebang.
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  minify: false,
  legalComments: "inline",
});

await build({
  entryPoints: ["src/lib/ffmpeg-args.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/ffmpeg-args.js",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
});

await build({
  entryPoints: ["src/lib/ffmpeg-args.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/ffmpeg-args.cjs",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
});
