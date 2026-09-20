import { CreativeError } from "../errors.ts";
import { extForMime, writeResult } from "./files.ts";
import type { FileResult } from "../types.ts";

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Download a provider output URL to the local work dir. The extension comes
 * from the response Content-Type (falling back to the URL path), and the
 * standard FileResult (bytes + sha256) is computed from the actual bytes.
 */
export async function downloadToResult(
  url: string,
  fallbackMime: string,
): Promise<FileResult> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new CreativeError("provider_timeout", "Timed out downloading the generated file.");
    }
    throw new CreativeError("provider_unreachable", "Could not download the generated file from the provider.");
  }
  if (!response.ok) {
    throw new CreativeError(
      "provider_error",
      `Download of the generated file failed with HTTP ${response.status}. Retry the generation.`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const mime = isKnownMime(contentType) ? contentType : fallbackMime;
  const ext = extForMime(mime);
  return writeResult(buffer, ext, mime);
}

function isKnownMime(mime: string): boolean {
  return /^(image|video|audio)\/(png|jpeg|jpg|webp|gif|mp4|webm|quicktime|x-matroska|mpeg|mp4|wav|ogg)$/.test(mime);
}
