import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { CreativeError } from "../errors.ts";
import type { FileResult } from "../types.ts";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  srt: "application/x-subrip",
};

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase().replace(/^\./, "")] ?? "application/octet-stream";
}

/** Extension for a MIME type — used when a provider returns bytes by content-type. */
export function extForMime(mime: string): string {
  const entry = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime);
  return entry ? entry[0] : "bin";
}

/**
 * Working directory for all outputs. Default /tmp/postward-creative; the
 * Docker image declares it as a volume. Override with POSTWARD_CREATIVE_TMP
 * (used by tests).
 */
export function workDir(): string {
  return process.env.POSTWARD_CREATIVE_TMP ?? "/tmp/postward-creative";
}

export async function ensureWorkDir(): Promise<string> {
  const dir = workDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface InputFile {
  path: string;
  buffer: Buffer;
  bytes: number;
}

/**
 * Read a local file given by the agent. Fails closed: missing files and
 * directories produce file_not_found, never a downstream tool error.
 */
export async function readInputFile(filePath: string, label: string): Promise<InputFile> {
  const resolved = path.resolve(filePath);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new CreativeError("file_not_found", `${label} not found: ${resolved}`);
  }
  if (!info.isFile()) {
    throw new CreativeError("file_not_found", `${label} is not a regular file: ${resolved}`);
  }
  const buffer = await readFile(resolved);
  return { path: resolved, buffer, bytes: buffer.length };
}

/** Write bytes to the work dir and return the standard FileResult shape. */
export async function writeResult(buffer: Buffer, ext: string, mime?: string): Promise<FileResult> {
  const dir = await ensureWorkDir();
  const filePath = path.join(dir, `${randomUUID()}.${ext.replace(/^\./, "")}`);
  await writeFile(filePath, buffer, { mode: 0o644 });
  return {
    filePath,
    mimeType: mime ?? mimeForExt(ext),
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
}

/** Build a FileResult for a file already written to disk. */
export async function fileResult(
  filePath: string,
  mime?: string,
  meta?: FileResult["meta"],
): Promise<FileResult> {
  const info = await stat(filePath);
  const buffer = await readFile(filePath);
  return {
    filePath,
    mimeType: mime ?? mimeForExt(path.extname(filePath)),
    bytes: info.size,
    sha256: sha256(buffer),
    meta,
  };
}

/** Base64 data URI — how local files are handed to AI providers. */
export function dataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
