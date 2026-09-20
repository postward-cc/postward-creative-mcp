import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import * as path from "node:path";
import { CreativeError } from "../errors.ts";
import type { ProbeInfo } from "../types.ts";

const execFileAsync = promisify(execFile);

export const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;

export function ffmpegBin(): string {
  return process.env.FFMPEG_BIN ?? "ffmpeg";
}

export function ffprobeBin(): string {
  return process.env.FFPROBE_BIN ?? "ffprobe";
}

function baseArgs(): string[] {
  return ["-hide_banner", "-loglevel", "error", "-y"];
}

export interface FfmpegPlan {
  /** Complete ffmpeg argument list, including the output file. */
  args: string[];
  /** Absolute output path (last element of args). */
  outputPath: string;
  /**
   * Files that must be written to disk before ffmpeg runs (e.g. the concat
   * list file). Pure builders never touch the filesystem themselves.
   */
  preWrite?: Array<{ path: string; content: string }>;
}

function outPath(workDir: string, ext: string): string {
  return path.join(workDir, `${randomUUID()}.${ext}`);
}

/** Run ffmpeg. Fails closed with a sanitized message from ffmpeg's stderr. */
export async function runFfmpeg(plan: FfmpegPlan): Promise<void> {
  for (const file of plan.preWrite ?? []) {
    await writeFile(file.path, file.content, "utf8");
  }
  try {
    await execFileAsync(ffmpegBin(), plan.args, {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    if (err instanceof Error && "killed" in err && (err as { killed?: boolean }).killed) {
      throw new CreativeError(
        "execution_failed",
        "ffmpeg timed out after 15 minutes. Try a shorter/smaller operation.",
      );
    }
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr?: unknown }).stderr ?? "") : "";
    const detail = stderr.trim().split("\n").filter(Boolean).pop() ?? "ffmpeg failed";
    throw new CreativeError("execution_failed", `ffmpeg failed: ${detail.slice(0, 500)}`);
  }
}

/** Probe a media file with ffprobe. */
export async function probeMedia(filePath: string): Promise<ProbeInfo> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      ffprobeBin(),
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch {
    throw new CreativeError(
      "execution_failed",
      `Could not read the media file: ${filePath}. Is it a valid audio/video/image file?`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new CreativeError("execution_failed", "ffprobe returned unreadable output.");
  }
  const { width, height, videoCodec, audioCodec } = streamsInfo(parsed);
  const format = (parsed as { format?: Record<string, unknown> }).format ?? {};
  const durationRaw = typeof format.duration === "string" ? Number(format.duration) : null;
  const bitrateRaw = typeof format.bit_rate === "string" ? Number(format.bit_rate) : null;
  return {
    durationSeconds: durationRaw !== null && Number.isFinite(durationRaw) ? durationRaw : null,
    width,
    height,
    videoCodec,
    audioCodec,
    bitrate: bitrateRaw,
    formatName: typeof format.format_name === "string" ? format.format_name : "unknown",
  };
}

function streamsInfo(parsed: unknown): {
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const streams = (parsed as { streams?: Array<Record<string, unknown>> }).streams ?? [];
  let width: number | null = null;
  let height: number | null = null;
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  for (const stream of streams) {
    if (stream.codec_type === "video" && videoCodec === null) {
      videoCodec = typeof stream.codec_name === "string" ? stream.codec_name : null;
      width = typeof stream.width === "number" ? stream.width : null;
      height = typeof stream.height === "number" ? stream.height : null;
    }
    if (stream.codec_type === "audio" && audioCodec === null) {
      audioCodec = typeof stream.codec_name === "string" ? stream.codec_name : null;
    }
  }
  return { width, height, videoCodec, audioCodec };
}

/** True when the file has at least one audio stream. */
export async function hasAudio(filePath: string): Promise<boolean> {
  return (await probeMedia(filePath)).audioCodec !== null;
}

/**
 * Parse "SS", "MM:SS", "HH:MM:SS" (decimals allowed in the last field) into
 * seconds. Anything else is input_invalid — no silent fallback.
 */
export function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((p) => p === "")) {
    throw new CreativeError(
      "input_invalid",
      `Invalid timestamp "${value}". Use seconds ("90"), "MM:SS" ("1:30") or "HH:MM:SS" ("1:00:30").`,
    );
  }
  let seconds = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) {
      throw new CreativeError(
        "input_invalid",
        `Invalid timestamp "${value}". Use seconds ("90"), "MM:SS" ("1:30") or "HH:MM:SS" ("1:00:30").`,
      );
    }
    seconds = seconds * 60 + n;
  }
  return seconds;
}

/** Seconds → ffmpeg-friendly string without trailing zeros ("15", not "15.000"). */
export function formatSeconds(n: number): string {
  return String(Number(n.toFixed(3)));
}

export function requirePositiveInt(value: number, name: string, max?: number): number {
  if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new CreativeError(
      "input_invalid",
      `${name} must be a positive integer${max !== undefined ? ` up to ${max}` : ""}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Pure argument builders — one per tool. These are pinned by unit tests.
// ---------------------------------------------------------------------------

/** trim_video: -ss BEFORE -i, then -t duration. Never -to: with input
 * seeking, -to is measured from the seek point, not the absolute timeline. */
export function buildTrimArgs(
  videoPath: string,
  start: string,
  end: string,
  workDirPath: string,
): FfmpegPlan {
  const startSec = parseTimestamp(start);
  const endSec = parseTimestamp(end);
  if (endSec <= startSec) {
    throw new CreativeError("input_invalid", `end (${end}) must be after start (${start}).`);
  }
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-ss",
      formatSeconds(startSec),
      "-i",
      videoPath,
      "-t",
      formatSeconds(endSec - startSec),
      "-c",
      "copy",
      outputPath,
    ],
  };
}

export const TRANSCODE_ASPECTS = ["9:16", "1:1", "16:9"] as const;
export const TRANSCODE_DIMENSIONS: Record<(typeof TRANSCODE_ASPECTS)[number], [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};
export const TRANSCODE_QUALITIES = ["high", "medium", "low"] as const;
export type TranscodeQuality = (typeof TRANSCODE_QUALITIES)[number];

/** transcode_video: normalize to a fixed aspect. Unknown aspects fail —
 * there is no silent fallback to 9:16. */
export function buildTranscodeArgs(
  videoPath: string,
  aspect: string,
  quality: string,
  workDirPath: string,
): FfmpegPlan {
  if (!(TRANSCODE_ASPECTS as readonly string[]).includes(aspect)) {
    throw new CreativeError(
      "input_invalid",
      `Unsupported aspect "${aspect}". Supported: ${TRANSCODE_ASPECTS.join(", ")}.`,
    );
  }
  if (!(TRANSCODE_QUALITIES as readonly string[]).includes(quality)) {
    throw new CreativeError(
      "input_invalid",
      `Unsupported quality "${quality}". Supported: ${TRANSCODE_QUALITIES.join(", ")}.`,
    );
  }
  const [w, h] = TRANSCODE_DIMENSIONS[aspect as (typeof TRANSCODE_ASPECTS)[number]];
  const crf = quality === "high" ? 18 : quality === "medium" ? 23 : 28;
  const preset = quality === "high" ? "slow" : quality === "medium" ? "medium" : "veryfast";
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      String(crf),
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ],
  };
}

export const CONCAT_MAX_CLIPS = 4;

/** concat_videos: concat demuxer + stream copy (same codec required). */
export function buildConcatArgs(videos: string[], workDirPath: string): FfmpegPlan {
  if (videos.length < 2 || videos.length > CONCAT_MAX_CLIPS) {
    throw new CreativeError(
      "input_invalid",
      `concat_videos needs 2 to ${CONCAT_MAX_CLIPS} clips (got ${videos.length}).`,
    );
  }
  const listPath = path.join(workDirPath, `${randomUUID()}-list.txt`);
  const content = videos
    .map((v) => `file '${v.replace(/'/g, "'\\''")}'`)
    .join("\n") + "\n";
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outputPath,
    ],
    preWrite: [{ path: listPath, content }],
  };
}

/** extract_frame: one PNG at the given timestamp. */
export function buildExtractFrameArgs(
  videoPath: string,
  timestamp: string,
  workDirPath: string,
): FfmpegPlan {
  const outputPath = outPath(workDirPath, "png");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-ss",
      formatSeconds(parseTimestamp(timestamp)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      outputPath,
    ],
  };
}

/** extract_audio: audio track as AAC in an .m4a. */
export function buildExtractAudioArgs(videoPath: string, workDirPath: string): FfmpegPlan {
  const outputPath = outPath(workDirPath, "m4a");
  return {
    outputPath,
    args: [...baseArgs(), "-i", videoPath, "-vn", "-c:a", "aac", outputPath],
  };
}

export const GIF_MAX_DURATION = 30;

/** create_gif: palette-based GIF for quality. */
export function buildGifArgs(
  videoPath: string,
  start: string,
  duration: number,
  width: number,
  workDirPath: string,
): FfmpegPlan {
  const dur = requirePositiveInt(duration, "duration", GIF_MAX_DURATION);
  const w = requirePositiveInt(width, "width", 1920);
  const outputPath = outPath(workDirPath, "gif");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-ss",
      formatSeconds(parseTimestamp(start)),
      "-i",
      videoPath,
      "-t",
      String(dur),
      "-vf",
      `fps=12,scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
      "-loop",
      "0",
      outputPath,
    ],
  };
}

export const WATERMARK_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

const WATERMARK_MARGIN = 24;

function watermarkCoords(position: WatermarkPosition): string {
  const m = WATERMARK_MARGIN;
  switch (position) {
    case "top-left":
      return `${m}:${m}`;
    case "top-right":
      return `main_w-overlay_w-${m}:${m}`;
    case "bottom-left":
      return `${m}:main_h-overlay_h-${m}`;
    case "bottom-right":
      return `main_w-overlay_w-${m}:main_h-overlay_h-${m}`;
    case "center":
      return `(main_w-overlay_w)/2:(main_h-overlay_h)/2`;
  }
}

/** add_watermark: overlay a logo image onto the video. */
export function buildWatermarkArgs(
  videoPath: string,
  logoPath: string,
  position: string,
  workDirPath: string,
): FfmpegPlan {
  if (!(WATERMARK_POSITIONS as readonly string[]).includes(position)) {
    throw new CreativeError(
      "input_invalid",
      `Unsupported position "${position}". Supported: ${WATERMARK_POSITIONS.join(", ")}.`,
    );
  }
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-i",
      logoPath,
      "-filter_complex",
      `overlay=${watermarkCoords(position as WatermarkPosition)}`,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

/** Escape a value used inside an ffmpeg filtergraph (drawtext text, subtitle
 * filename, …): \\, ', :, and % all need escaping, then quote it. */
export function escapeFilterValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%")}'`;
}

/** burn_subtitles: SRT burned into the pixels. */
export function buildBurnSubtitlesArgs(
  videoPath: string,
  srtPath: string,
  style: string | undefined,
  workDirPath: string,
): FfmpegPlan {
  let filter = `subtitles=filename=${escapeFilterValue(path.resolve(srtPath))}`;
  if (style !== undefined && style.trim().length > 0) {
    if (style.includes("\n")) {
      throw new CreativeError("input_invalid", "style must be a single-line ASS force_style string.");
    }
    filter += `:force_style=${escapeFilterValue(style.trim())}`;
  }
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

/** add_fade: video fade in and/or out. Needs the clip duration to place the
 * fade-out, so the handler probes first and passes it in. */
export function buildFadeArgs(
  videoPath: string,
  durationSeconds: number,
  fadeIn: number,
  fadeOut: number,
  workDirPath: string,
): FfmpegPlan {
  if (fadeIn < 0 || fadeOut < 0 || (fadeIn === 0 && fadeOut === 0)) {
    throw new CreativeError("input_invalid", "Provide fade_in and/or fade_out (seconds, >= 0); not both zero.");
  }
  const filters: string[] = [];
  if (fadeIn > 0) filters.push(`fade=t=in:st=0:d=${formatSeconds(fadeIn)}`);
  if (fadeOut > 0) {
    const st = Math.max(0, durationSeconds - fadeOut);
    filters.push(`fade=t=out:st=${formatSeconds(st)}:d=${formatSeconds(fadeOut)}`);
  }
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      filters.join(","),
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

export const SPEED_MIN_RATE = 0.25;
export const SPEED_MAX_RATE = 4;

/**
 * change_speed: setpts for video; atempo chains for audio because a single
 * atempo only covers 0.5–2.0.
 */
export function buildSpeedArgs(
  videoPath: string,
  rate: number,
  workDirPath: string,
): FfmpegPlan {
  if (!Number.isFinite(rate) || rate < SPEED_MIN_RATE || rate > SPEED_MAX_RATE) {
    throw new CreativeError(
      "input_invalid",
      `rate must be between ${SPEED_MIN_RATE} and ${SPEED_MAX_RATE} (got ${rate}).`,
    );
  }
  const atempo = atempoChain(rate);
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      `setpts=PTS/${rate}`,
      "-af",
      atempo,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      outputPath,
    ],
  };
}

export function atempoChain(rate: number): string {
  const factors: number[] = [];
  let remaining = rate;
  while (remaining > 2.0) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(Number(remaining.toFixed(4)));
  return factors.map((f) => `atempo=${formatSeconds(f)}`).join(",");
}

/** reverse_video: video always reversed; audio only when an audio stream
 * exists (probed by the handler — otherwise areverse would fail). */
export function buildReverseArgs(videoPath: string, withAudio: boolean, workDirPath: string): FfmpegPlan {
  const outputPath = outPath(workDirPath, "mp4");
  const args = [...baseArgs(), "-i", videoPath, "-vf", "reverse"];
  if (withAudio) args.push("-af", "areverse");
  args.push("-c:v", "libx264", "-crf", "20", "-preset", "veryfast", outputPath);
  if (withAudio) args.push("-c:a", "aac");
  return { outputPath, args };
}

export const FLIP_DIRECTIONS = ["horizontal", "vertical"] as const;

/** flip_video. */
export function buildFlipArgs(videoPath: string, direction: string, workDirPath: string): FfmpegPlan {
  if (!(FLIP_DIRECTIONS as readonly string[]).includes(direction)) {
    throw new CreativeError(
      "input_invalid",
      `direction must be "horizontal" or "vertical" (got "${direction}").`,
    );
  }
  const filter = direction === "horizontal" ? "hflip" : "vflip";
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

/** crop_video: all values must be even (codec requirement). */
export function buildCropArgs(
  videoPath: string,
  width: number,
  height: number,
  x: number,
  y: number,
  workDirPath: string,
): FfmpegPlan {
  for (const [value, name] of [
    [width, "width"],
    [height, "height"],
    [x, "x"],
    [y, "y"],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new CreativeError("input_invalid", `${name} must be a non-negative integer (got ${value}).`);
    }
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new CreativeError("input_invalid", "width and height must be even numbers (codec requirement).");
  }
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      `crop=${width}:${height}:${x}:${y}`,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

export const VOLUME_MIN_DB = -60;
export const VOLUME_MAX_DB = 24;

/** adjust_volume: gain in decibels. */
export function buildVolumeArgs(videoPath: string, gainDb: number, workDirPath: string): FfmpegPlan {
  if (!Number.isFinite(gainDb) || gainDb < VOLUME_MIN_DB || gainDb > VOLUME_MAX_DB) {
    throw new CreativeError(
      "input_invalid",
      `gain must be between ${VOLUME_MIN_DB} and ${VOLUME_MAX_DB} dB (got ${gainDb}).`,
    );
  }
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-af",
      `volume=${gainDb}dB`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      outputPath,
    ],
  };
}

/** replace_audio: keep the video stream, swap in the new audio track. */
export function buildReplaceAudioArgs(
  videoPath: string,
  audioPath: string,
  workDirPath: string,
): FfmpegPlan {
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      outputPath,
    ],
  };
}

export const TEXT_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];

const TEXT_MARGIN = 24;

function textCoords(position: TextPosition): string {
  const m = TEXT_MARGIN;
  switch (position) {
    case "top-left":
      return `${m}:${m}`;
    case "top-right":
      return `w-text_w-${m}:${m}`;
    case "bottom-left":
      return `${m}:h-text_h-${m}`;
    case "bottom-right":
      return `w-text_w-${m}:h-text_h-${m}`;
    case "center":
      return `(w-text_w)/2:(h-text_h)/2`;
  }
}

export function isValidColor(color: string): boolean {
  return /^[a-zA-Z]+$/.test(color) || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
}

/** overlay_text: drawtext with proper filter escaping. */
export function buildOverlayTextArgs(
  videoPath: string,
  text: string,
  fontSize: number,
  color: string,
  position: string,
  fontFile: string | undefined,
  workDirPath: string,
): FfmpegPlan {
  if (text.trim().length === 0) {
    throw new CreativeError("input_invalid", "text must not be empty.");
  }
  requirePositiveInt(fontSize, "fontSize", 400);
  if (!isValidColor(color)) {
    throw new CreativeError(
      "input_invalid",
      `color must be a color name (e.g. "white") or hex (#RRGGBB) — got "${color}".`,
    );
  }
  if (!(TEXT_POSITIONS as readonly string[]).includes(position)) {
    throw new CreativeError(
      "input_invalid",
      `Unsupported position "${position}". Supported: ${TEXT_POSITIONS.join(", ")}.`,
    );
  }
  const [xExpr = "0", yExpr = "0"] = textCoords(position as TextPosition).split(":");
  let filter = `drawtext=text=${escapeFilterValue(text)}:fontsize=${fontSize}:fontcolor=${color}`;
  if (fontFile) filter += `:fontfile=${escapeFilterValue(fontFile)}`;
  filter += `:x=${xExpr}:y=${yExpr}`;
  const outputPath = outPath(workDirPath, "mp4");
  return {
    outputPath,
    args: [
      ...baseArgs(),
      "-i",
      videoPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}
