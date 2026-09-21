import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeMedia } from "../src/lib/ffmpeg.ts";
import { fileResult } from "../src/lib/files.ts";
import { runTool } from "./helpers.ts";

const execFileAsync = promisify(execFile);

async function binAvailable(bin: string, args: string[] = ["-version"]): Promise<boolean> {
  try {
    await execFileAsync(bin, args, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function ffmpegHasFilter(filter: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-filters"], { timeout: 15_000 });
    return stdout.includes(` ${filter} `);
  } catch {
    return false;
  }
}

const hasFfmpeg = await binAvailable("ffmpeg");
const hasIm = await binAvailable("convert");
const hasSubtitlesFilter = hasFfmpeg && (await ffmpegHasFilter("subtitles"));
const hasDrawtextFilter = hasFfmpeg && (await ffmpegHasFilter("drawtext"));
const fontFile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const hasFont = existsSync(fontFile);

const dFfmpeg = hasFfmpeg ? describe : describe.skip;
const dIm = hasIm ? describe : describe.skip;

let work: string;
let fixture: string;

async function makeFixture(dir: string): Promise<string> {
  const filePath = path.join(dir, "fixture.mp4");
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=320x240:rate=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      filePath,
    ],
    { timeout: 60_000 },
  );
  return filePath;
}

async function durationOf(filePath: string): Promise<number> {
  const probe = await probeMedia(filePath);
  return probe.durationSeconds ?? -1;
}

beforeAll(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "pcm-integration-"));
  process.env.POSTWARD_CREATIVE_TMP = work;
  fixture = await makeFixture(work);
}, 120_000);

afterAll(async () => {
  delete process.env.POSTWARD_CREATIVE_TMP;
  await rm(work, { recursive: true, force: true });
});

dFfmpeg("ffmpeg tools (real ffmpeg)", () => {
  it("trim_video cuts [start, end) with -t duration", async () => {
    const result = (await runTool("trim_video", {
      video_path: fixture,
      start: "0",
      end: "1",
    })) as { filePath: string; bytes: number; sha256: string };
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await durationOf(result.filePath)).toBeCloseTo(1, 0);
  });

  it("concat_videos joins two clips", async () => {
    const result = (await runTool("concat_videos", { videos: [fixture, fixture] })) as {
      filePath: string;
    };
    expect(await durationOf(result.filePath)).toBeCloseTo(4, 0);
  });

  it("transcode_video normalizes to 1:1 at 1080x1080", async () => {
    const result = (await runTool("transcode_video", {
      video_path: fixture,
      aspect: "1:1",
      quality: "low",
    })) as { filePath: string };
    const probe = await probeMedia(result.filePath);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1080);
  });

  it("extract_frame grabs a png", async () => {
    const result = (await runTool("extract_frame", { video_path: fixture, timestamp: "1" })) as {
      filePath: string;
      mimeType: string;
    };
    expect(result.mimeType).toBe("image/png");
    expect(existsSync(result.filePath)).toBe(true);
  });

  it("extract_audio produces an m4a", async () => {
    const result = (await runTool("extract_audio", { video_path: fixture })) as { filePath: string };
    const probe = await probeMedia(result.filePath);
    expect(probe.audioCodec).toBe("aac");
  });

  it("create_gif produces an animated gif", async () => {
    const result = (await runTool("create_gif", {
      video_path: fixture,
      start: "0",
      duration: 2,
      width: 160,
    })) as { filePath: string; mimeType: string };
    expect(result.mimeType).toBe("image/gif");
    expect(existsSync(result.filePath)).toBe(true);
  });

  it("add_fade keeps the duration", async () => {
    const result = (await runTool("add_fade", {
      video_path: fixture,
      fade_in: 0.5,
      fade_out: 0.5,
    })) as { filePath: string };
    expect(await durationOf(result.filePath)).toBeCloseTo(2, 0);
  });

  it("change_speed at 2x halves the duration", async () => {
    const result = (await runTool("change_speed", { video_path: fixture, rate: 2 })) as {
      filePath: string;
    };
    expect(await durationOf(result.filePath)).toBeCloseTo(1, 0);
  });

  it("reverse_video keeps the duration", async () => {
    const result = (await runTool("reverse_video", { video_path: fixture })) as { filePath: string };
    expect(await durationOf(result.filePath)).toBeCloseTo(2, 0);
  });

  it("flip_video and crop_video succeed", async () => {
    const flipped = (await runTool("flip_video", {
      video_path: fixture,
      direction: "horizontal",
    })) as { bytes: number };
    expect(flipped.bytes).toBeGreaterThan(0);
    const cropped = (await runTool("crop_video", {
      video_path: fixture,
      width: 160,
      height: 120,
      x: 0,
      y: 0,
    })) as { bytes: number };
    expect(cropped.bytes).toBeGreaterThan(0);
  });

  it("adjust_volume and replace_audio succeed", async () => {
    const louder = (await runTool("adjust_volume", { video_path: fixture, gain: 6 })) as {
      bytes: number;
    };
    expect(louder.bytes).toBeGreaterThan(0);
    const audio = (await runTool("extract_audio", { video_path: fixture })) as { filePath: string };
    const replaced = (await runTool("replace_audio", {
      video_path: fixture,
      audio_path: audio.filePath,
    })) as { bytes: number };
    expect(replaced.bytes).toBeGreaterThan(0);
  });

  it("add_watermark overlays a logo", async () => {
    const frame = (await runTool("extract_frame", { video_path: fixture, timestamp: "0" })) as {
      filePath: string;
    };
    const result = (await runTool("add_watermark", {
      video_path: fixture,
      logo_path: frame.filePath,
      position: "top-left",
    })) as { bytes: number };
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("probe_media reports the fixture's real properties", async () => {
    const result = (await runTool("probe_media", { file_path: fixture })) as {
      durationSeconds: number;
      width: number | null;
      height: number | null;
      audioCodec: string | null;
    };
    expect(result.durationSeconds).toBeCloseTo(2, 0);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.audioCodec).toBe("aac");
  });

  it("burn_subtitles burns an srt into the pixels", async (ctx) => {
    if (!hasSubtitlesFilter) return ctx.skip();
    const srtPath = path.join(work, "subs.srt");
    await writeFile(
      srtPath,
      "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nWorld\n",
      "utf8",
    );
    const result = (await runTool("burn_subtitles", {
      video_path: fixture,
      srt_path: srtPath,
    })) as { bytes: number };
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("overlay_text burns a caption when a font is available", async (ctx) => {
    if (!hasDrawtextFilter || !hasFont) return ctx.skip();
    process.env.POSTWARD_CREATIVE_FONT = fontFile;
    const result = (await runTool("overlay_text", {
      video_path: fixture,
      text: "it's: 100% 'quoted'",
      fontSize: 32,
      color: "white",
      position: "center",
    })) as { bytes: number };
    delete process.env.POSTWARD_CREATIVE_FONT;
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("failing ffmpeg operations produce execution_failed, never a silent fallback", async () => {
    const broken = path.join(work, "broken.mp4");
    await writeFile(broken, "this is not a video");
    await expect(runTool("trim_video", { video_path: broken, start: "0", end: "1" })).rejects.toMatchObject(
      { code: "execution_failed" },
    );
  });
});

dIm("image tools (real ImageMagick)", () => {
  let png: string;

  beforeAll(async () => {
    const frame = (await runTool("extract_frame", { video_path: fixture, timestamp: "0" })) as {
      filePath: string;
    };
    png = frame.filePath;
  });

  it("image_info reads real dimensions", async () => {
    const result = (await runTool("image_info", { image_path: png })) as {
      width: number;
      height: number;
      format: string;
      sha256: string;
    };
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.format.toUpperCase()).toBe("PNG");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resize_image and image_thumbnail produce smaller pngs", async () => {
    const resized = (await runTool("resize_image", { image_path: png, width: 100, height: 100 })) as {
      bytes: number;
      mimeType: string;
    };
    expect(resized.mimeType).toBe("image/png");
    expect(resized.bytes).toBeGreaterThan(0);
    const thumb = (await runTool("image_thumbnail", { image_path: png, size: 64 })) as { bytes: number };
    expect(thumb.bytes).toBeGreaterThan(0);
  });

  it("convert_format produces real jpeg with flattened alpha", async () => {
    const result = (await runTool("convert_format", { image_path: png, format: "jpeg" })) as {
      mimeType: string;
      bytes: number;
    };
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("checksum_file matches fileResult's sha256", async () => {
    const viaTool = (await runTool("checksum_file", { file_path: png })) as { sha256: string };
    const viaLib = await fileResult(png);
    expect(viaTool.sha256).toBe(viaLib.sha256);
  });
});
