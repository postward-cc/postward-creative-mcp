import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  atempoChain,
  concatListContent,
  parseTimestamp,
} from "@postward-cc/creative-mcp/ffmpeg-args";

assert.equal(parseTimestamp("1:30"), 90);
assert.equal(atempoChain(4), "atempo=2,atempo=2");
assert.equal(concatListContent(["a.mp4", "b.mp4"]), "file 'a.mp4'\nfile 'b.mp4'\n");

const require = createRequire(import.meta.url);
const commonJs = require("@postward-cc/creative-mcp/ffmpeg-args");
assert.equal(commonJs.parseTimestamp("1:30"), 90);

console.log("ffmpeg-args ESM and CommonJS package exports: OK");