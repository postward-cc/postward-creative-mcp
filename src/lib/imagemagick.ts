import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import * as path from "node:path";
import { CreativeError } from "../errors.ts";

const execFileAsync = promisify(execFile);

export const IM_TIMEOUT_MS = 10 * 60 * 1000;

/** ImageMagick 7 ships `magick`, ImageMagick 6 (Debian/Ubuntu) ships
 * `convert`. Detect once per process. Override with IMAGEMAGICK_BIN. */
let detectedBin: "magick" | "convert" | null = null;

export async function imagemagickBin(): Promise<"magick" | "convert"> {
  if (detectedBin) return detectedBin;
  const override = process.env.IMAGEMAGICK_BIN;
  if (override === "magick" || override === "convert") {
    detectedBin = override;
    return detectedBin;
  }
  for (const bin of ["magick", "convert"] as const) {
    try {
      await execFileAsync(bin, ["-version"], { timeout: 10_000 });
      detectedBin = bin;
      return bin;
    } catch {
      // try next
    }
  }
  throw new CreativeError(
    "execution_failed",
    "ImageMagick not found. Install it (apt install imagemagick) or run this server via Docker — the Docker image ships with it.",
  );
}

export interface MagickPlan {
  args: string[];
  outputPath: string;
}

export async function runMagick(plan: MagickPlan): Promise<void> {
  const bin = await imagemagickBin();
  try {
    await execFileAsync(bin, plan.args, {
      timeout: IM_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr?: unknown }).stderr ?? "") : "";
    const detail = stderr.trim().split("\n").filter(Boolean).pop() ?? "ImageMagick failed";
    throw new CreativeError("execution_failed", `ImageMagick failed: ${detail.slice(0, 500)}`);
  }
}

function outPath(workDirPath: string, ext: string): string {
  return path.join(workDirPath, `${randomUUID()}.${ext}`);
}

export const IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** resize_image: fits within width x height, aspect ratio preserved. */
export function buildResizeArgs(
  imagePath: string,
  width: number,
  height: number,
  workDirPath: string,
): MagickPlan {
  const outputPath = outPath(workDirPath, "png");
  return {
    outputPath,
    args: [imagePath, "-resize", `${width}x${height}`, outputPath],
  };
}

/** convert_format: PNG ↔ JPEG ↔ WebP. JPEG has no alpha — flatten on white. */
export function buildConvertArgs(
  imagePath: string,
  format: ImageFormat,
  workDirPath: string,
): MagickPlan {
  const outputPath = outPath(workDirPath, format === "jpeg" ? "jpg" : format);
  const args = [imagePath];
  if (format === "jpeg") args.push("-background", "white", "-flatten", "-quality", "90");
  if (format === "webp") args.push("-quality", "90");
  args.push(outputPath);
  return { outputPath, args };
}

/** image_thumbnail: small preview, aspect preserved. */
export function buildThumbnailArgs(
  imagePath: string,
  size: number,
  workDirPath: string,
): MagickPlan {
  const outputPath = outPath(workDirPath, "png");
  return {
    outputPath,
    args: [imagePath, "-thumbnail", `${size}x${size}`, outputPath],
  };
}

export interface ImageInfoRaw {
  format: string;
  width: number;
  height: number;
}

/** image_info internals: `identify -format "%m %w %h"`. IM7 uses
 * `magick identify …`; IM6 ships a standalone `identify` binary. */
export async function identifyImage(imagePath: string): Promise<ImageInfoRaw> {
  const main = await imagemagickBin();
  const bin = main === "magick" ? "magick" : "identify";
  const args = main === "magick" ? ["identify", "-format", "%m %w %h", imagePath] : ["-format", "%m %w %h", imagePath];
  let stdout: string;
  try {
    const result = await execFileAsync(bin, args, { timeout: 60_000 });
    stdout = result.stdout;
  } catch {
    throw new CreativeError(
      "execution_failed",
      `Could not read the image: ${imagePath}. Is it a valid image file?`,
    );
  }
  const parts = stdout.trim().split(/\s+/);
  if (parts.length < 3) {
    throw new CreativeError("execution_failed", "Could not parse identify output.");
  }
  return {
    format: parts[0] ?? "unknown",
    width: Number(parts[1]),
    height: Number(parts[2]),
  };
}
