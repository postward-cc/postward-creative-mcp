#!/usr/bin/env node
/**
 * End-to-end execution suite: drives the real MCP server (stdio JSON-RPC)
 * through every tool, then through a multi-tool pipeline, asserting on the
 * actual output files.
 *
 * Usage:
 *   node scripts/e2e.mjs                     # node dist/index.cjs (system ffmpeg)
 *   node scripts/e2e.mjs <command...>        # custom server command
 *
 * In CI the Dockerfile.e2e target runs this inside the shipped image
 * (node dist/index.cjs + ffmpeg + ImageMagick + fonts), so the exact
 * artifact users install is what gets exercised.
 */
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVER_CMD = process.argv.length > 2 ? process.argv.slice(2) : ["node", "dist/index.cjs"];
const CALL_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Minimal MCP stdio client (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

class McpClient {
  #proc;
  #buffer = "";
  #pending = new Map();
  #nextId = 1;

  constructor(command) {
    this.#proc = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
    this.#proc.stdout.setEncoding("utf8");
    this.#proc.stdout.on("data", (chunk) => {
      this.#buffer += chunk;
      let index;
      while ((index = this.#buffer.indexOf("\n")) !== -1) {
        const line = this.#buffer.slice(0, index).trim();
        this.#buffer = this.#buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const pending = this.#pending.get(message.id);
        if (pending) {
          this.#pending.delete(message.id);
          pending(message);
        }
      }
    });
  }

  async request(method, params) {
    const id = this.#nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS}ms`)),
        CALL_TIMEOUT_MS,
      );
      this.#pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    this.#proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await promise;
  }

  async start() {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "postward-e2e", version: "0.0.0" },
    });
    this.#proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return response;
  }

  /**
   * Call a tool; ALWAYS returns a parsed envelope — either the tool result
   * or `{ error: { code, message } }`. Schema-level rejections come back as
   * JSON-RPC protocol errors (code -32602), surfaced as code "protocol_error".
   */
  async call(name, args) {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) {
      return { error: { code: "protocol_error", message: String(response.error.message ?? "") } };
    }
    const text = response.result?.content?.[0]?.text ?? "";
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { code: "protocol_error", message: text.slice(0, 300) } };
    }
    if (response.result.isError && !payload.error) {
      return { error: { code: "execution_failed", message: text.slice(0, 300) } };
    }
    return payload;
  }

  close() {
    this.#proc.kill();
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function assertFileResult(label, result) {
  check(`${label}: filePath exists on disk`, typeof result.filePath === "string" && existsSync(result.filePath), result.filePath);
  check(`${label}: bytes > 0`, Number.isFinite(result.bytes) && result.bytes > 0, String(result.bytes));
  check(`${label}: sha256 well-formed`, typeof result.sha256 === "string" && /^[0-9a-f]{64}$/.test(result.sha256));
  check(`${label}: mimeType set`, typeof result.mimeType === "string" && result.mimeType.includes("/"), result.mimeType);
  return result;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function durationOf(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", filePath,
  ]);
  return Number(JSON.parse(stdout).format?.duration ?? -1);
}

const closeTo = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeFixtures(dir) {
  const video = path.join(dir, "fixture.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=15",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    video,
  ]);
  await writeFile(
    path.join(dir, "subs.srt"),
    "1\n00:00:00,000 --> 00:00:02,000\nHello from the e2e suite\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond cue\n",
    "utf8",
  );
  return { video, srt: path.join(dir, "subs.srt") };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

async function main() {
  console.log(`server: ${SERVER_CMD.join(" ")}`);
  const work = await mkdtemp(path.join(os.tmpdir(), "pcm-e2e-"));
  const client = new McpClient(SERVER_CMD);
  const { video, srt } = await makeFixtures(work);

  try {
    const init = await client.start();
    console.log(`handshake: ${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}`);
    check("handshake: server name", init.result?.serverInfo?.name === "postward-creative-mcp");

    const listed = await client.call("list_tools", {});
    check("list_tools: every tool advertised", Array.isArray(listed.tools) && listed.tools.length >= 23, `${listed.tools?.length}`);

    // -- every tool, one by one --------------------------------------------
    console.log("\n== every tool executes ==");

    const probe = await client.call("probe_media", { file_path: video });
    check("probe_media: duration ≈ 4s", closeTo(probe.durationSeconds, 4, 0.3), `${probe.durationSeconds}`);
    check("probe_media: 320x240", probe.width === 320 && probe.height === 240);

    const checksum = await client.call("checksum_file", { file_path: video });
    check("checksum_file: sha256 matches local hash", checksum.sha256 === (await sha256(video)));

    const trimmed = assertFileResult("trim_video", await client.call("trim_video", { video_path: video, start: "1", end: "3" }));
    check("trim_video: output ≈ 2s", closeTo(await durationOf(trimmed.filePath), 2, 0.3), `${await durationOf(trimmed.filePath)}`);

    const transcoded = assertFileResult("transcode_video", await client.call("transcode_video", { video_path: video, aspect: "1:1", quality: "low" }));
    const tInfo = await execFileAsync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", transcoded.filePath]);
    const tStream = JSON.parse(tInfo.stdout).streams.find((s) => s.codec_type === "video");
    check("transcode_video: output 1080x1080", tStream.width === 1080 && tStream.height === 1080, `${tStream.width}x${tStream.height}`);

    const concatenated = assertFileResult("concat_videos", await client.call("concat_videos", { videos: [video, video] }));
    check("concat_videos: output ≈ 8s", closeTo(await durationOf(concatenated.filePath), 8, 0.4));

    const frame = assertFileResult("extract_frame", await client.call("extract_frame", { video_path: video, timestamp: "1" }));

    const audio = assertFileResult("extract_audio", await client.call("extract_audio", { video_path: video }));
    const audioProbe = JSON.parse((await execFileAsync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", audio.filePath])).stdout);
    check("extract_audio: aac stream", audioProbe.streams.some((s) => s.codec_name === "aac"));

    const gif = assertFileResult("create_gif", await client.call("create_gif", { video_path: video, start: "0", duration: 2, width: 160 }));

    const watermarked = assertFileResult("add_watermark", await client.call("add_watermark", { video_path: video, logo_path: frame.filePath, position: "top-left" }));

    const subtitled = assertFileResult("burn_subtitles", await client.call("burn_subtitles", { video_path: video, srt_path: srt }));

    const faded = assertFileResult("add_fade", await client.call("add_fade", { video_path: video, fade_in: 0.5, fade_out: 0.5 }));
    check("add_fade: duration preserved ≈ 4s", closeTo(await durationOf(faded.filePath), 4, 0.3));

    const sped = assertFileResult("change_speed", await client.call("change_speed", { video_path: video, rate: 2 }));
    check("change_speed: 2x halves duration", closeTo(await durationOf(sped.filePath), 2, 0.4), `${await durationOf(sped.filePath)}`);

    const reversed = assertFileResult("reverse_video", await client.call("reverse_video", { video_path: video }));
    check("reverse_video: duration preserved ≈ 4s", closeTo(await durationOf(reversed.filePath), 4, 0.3));

    const flipped = assertFileResult("flip_video", await client.call("flip_video", { video_path: video, direction: "horizontal" }));

    const cropped = assertFileResult("crop_video", await client.call("crop_video", { video_path: video, width: 160, height: 120, x: 0, y: 0 }));

    const louder = assertFileResult("adjust_volume", await client.call("adjust_volume", { video_path: video, gain: 6 }));

    const replaced = assertFileResult("replace_audio", await client.call("replace_audio", { video_path: video, audio_path: audio.filePath }));

    const captioned = assertFileResult("overlay_text", await client.call("overlay_text", { video_path: video, text: "Postward e2e", fontSize: 32, color: "white", position: "center" }));

    const resized = assertFileResult("resize_image", await client.call("resize_image", { image_path: frame.filePath, width: 100, height: 100 }));

    const converted = assertFileResult("convert_format", await client.call("convert_format", { image_path: frame.filePath, format: "jpeg" }));
    check("convert_format: image/jpeg", converted.mimeType === "image/jpeg");

    const thumb = assertFileResult("image_thumbnail", await client.call("image_thumbnail", { image_path: frame.filePath, size: 64 }));

    const info = await client.call("image_info", { image_path: frame.filePath });
    check("image_info: 320x240 png", info.width === 320 && info.height === 240 && info.format === "PNG", `${info.width}x${info.height} ${info.format}`);

    const prepared = await client.call("prepare_for_postward", { file_path: video, name: "E2E fixture" });
    check("prepare_for_postward: metadata sha matches", prepared.file?.sha256 === (await sha256(video)));

    // -- e2e pipeline: several tools chained on one artifact ----------------
    console.log("\n== pipeline: edit → caption → brand → package ==");

    const step1 = assertFileResult("pipeline: trim", await client.call("trim_video", { video_path: video, start: "0", end: "3" }));
    const step2 = assertFileResult("pipeline: overlay_text", await client.call("overlay_text", { video_path: step1.filePath, text: "LAUNCH", fontSize: 48, color: "white", position: "bottom-right" }));
    const step3 = assertFileResult("pipeline: burn_subtitles", await client.call("burn_subtitles", { video_path: step2.filePath, srt_path: srt }));
    const step4 = assertFileResult("pipeline: add_fade", await client.call("add_fade", { video_path: step3.filePath, fade_in: 0.3, fade_out: 0.3 }));
    const step5 = assertFileResult("pipeline: change_speed", await client.call("change_speed", { video_path: step4.filePath, rate: 1.5 }));
    const step6 = await client.call("probe_media", { file_path: step5.filePath });
    check("pipeline: final duration ≈ 2s (3s @1.5x)", closeTo(step6.durationSeconds, 2, 0.4), `${step6.durationSeconds}`);
    const step7 = await client.call("checksum_file", { file_path: step5.filePath });
    check("pipeline: checksum matches bytes on disk", step7.sha256 === (await sha256(step5.filePath)));
    const step8 = await client.call("prepare_for_postward", { file_path: step5.filePath, name: "launch-vertical" });
    check("pipeline: handoff metadata complete", Boolean(step8.file?.path && step8.file?.mimeType && step8.file?.bytes > 0 && /^[0-9a-f]{64}$/.test(step8.file?.sha256 ?? "")));

    // -- fail-closed spot checks --------------------------------------------
    console.log("\n== fail closed ==");

    const bad = await client.call("transcode_video", { video_path: video, aspect: "4:3" });
    check(
      "unknown aspect rejected with input_invalid",
      ["input_invalid", "protocol_error"].includes(bad.error?.code),
      JSON.stringify(bad.error),
    );
    const missing = await client.call("trim_video", { video_path: "/no/such/file.mp4", start: "0", end: "1" });
    check("missing file rejected with file_not_found", missing.error?.code === "file_not_found", JSON.stringify(missing.error));
  } finally {
    client.close();
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAILED: ${failure}`);
    process.exitCode = 1;
  }
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => {
  console.error("e2e harness crashed:", err?.message ?? err);
  process.exit(1);
});
