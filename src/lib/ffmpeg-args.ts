/**
 * Pure FFmpeg argument primitives shared by Postward's local editor and cloud
 * worker. No filesystem, process, MCP, or Postward dependencies belong here:
 * adapters own paths, I/O, execution, and error presentation.
 */

export class FfmpegInputError extends Error {
  readonly code = "input_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "FfmpegInputError";
  }
}

export const TRANSCODE_ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type TranscodeAspect = (typeof TRANSCODE_ASPECTS)[number];
export const TRANSCODE_DIMENSIONS: Record<TranscodeAspect, readonly [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};

export function aspectDimensions(aspect: string): { width: number; height: number } {
  if (!(TRANSCODE_ASPECTS as readonly string[]).includes(aspect)) {
    throw new FfmpegInputError(
      `Unsupported aspect "${aspect}". Supported: ${TRANSCODE_ASPECTS.join(", ")}.`,
    );
  }
  const [width, height] = TRANSCODE_DIMENSIONS[aspect as TranscodeAspect];
  return { width, height };
}

/** Filter that scales an image/video to fit, then pads to the requested frame. */
export function scalePadFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}

/** Parse SS, MM:SS or HH:MM:SS (decimals allowed) into seconds. */
export function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  const invalid = () => new FfmpegInputError(
    `Invalid timestamp "${value}". Use seconds ("90"), "MM:SS" ("1:30") or "HH:MM:SS" ("1:00:30").`,
  );
  if (parts.length > 3 || parts.some((part) => part === "")) throw invalid();
  let seconds = 0;
  for (const part of parts) {
    const number = Number(part);
    if (!Number.isFinite(number) || number < 0) throw invalid();
    seconds = seconds * 60 + number;
  }
  return seconds;
}

/** Seconds to ffmpeg-friendly decimal without trailing zeros. */
export function formatSeconds(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Require a positive integer and return it for inline validation. */
export function requirePositiveInt(value: number, name: string, max?: number): number {
  if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new FfmpegInputError(
      `${name} must be a positive integer${max !== undefined ? ` up to ${max}` : ""}.`,
    );
  }
  return value;
}

/** Escape a value embedded in an ffmpeg filtergraph and quote it. */
export function escapeFilterValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%")}'`;
}

/**
 * Encode paths for FFmpeg's concat demuxer list file. The trailing newline is
 * intentional and matches the file format used by both local and cloud tools.
 */
export function concatListContent(paths: readonly string[]): string {
  return paths.map((value) => `file '${value.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export const WATERMARK_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export function watermarkCoordinates(position: string, margin = 24): string {
  if (!(WATERMARK_POSITIONS as readonly string[]).includes(position)) {
    throw new FfmpegInputError(
      `Unsupported position "${position}". Supported: ${WATERMARK_POSITIONS.join(", ")}.`,
    );
  }
  switch (position as WatermarkPosition) {
    case "top-left": return `${margin}:${margin}`;
    case "top-right": return `main_w-overlay_w-${margin}:${margin}`;
    case "bottom-left": return `${margin}:main_h-overlay_h-${margin}`;
    case "bottom-right": return `main_w-overlay_w-${margin}:main_h-overlay_h-${margin}`;
    case "center": return `(main_w-overlay_w)/2:(main_h-overlay_h)/2`;
  }
}

/** Keep each atempo stage in 0.5x–2x; larger single stages skip samples. */
export function atempoChain(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new FfmpegInputError(`rate must be a finite positive number (got ${rate}).`);
  }
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
  return factors.map((factor) => `atempo=${formatSeconds(factor)}`).join(",");
}
