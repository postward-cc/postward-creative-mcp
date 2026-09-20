const STABILITY_BASE = "https://api.stability.ai";

const ASPECT_VALUES: Array<[string, number]> = [
  ["1:1", 1],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
];

/**
 * Stable Image Core generation (multipart form). Returns image bytes
 * directly (Accept: image/*). Stability takes an aspect ratio rather than
 * exact dimensions; the caller picks the ratio.
 */
export async function stabilityImage(
  key: string,
  input: { prompt: string; aspectRatio?: string },
): Promise<Buffer> {
  const form = new FormData();
  form.append("prompt", input.prompt);
  form.append("output_format", "png");
  if (input.aspectRatio) form.append("aspect_ratio", input.aspectRatio);
  const response = await fetch(`${STABILITY_BASE}/v2beta/stable-image/generate/core`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "image/*",
    },
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) {
    const { providerHttpError } = await import("../errors.ts");
    throw providerHttpError("stability", response.status, "image generation");
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Nearest supported Stability aspect for a "WxH" size string (deterministic
 * normalization, documented in the generate_image description). */
export function sizeToAspect(size: string): string {
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  let best = ASPECT_VALUES[0];
  for (const entry of ASPECT_VALUES) {
    const [, bestValue] = best ?? ["1:1", 1];
    if (Math.abs(ratio - entry[1]) < Math.abs(ratio - bestValue)) best = entry;
  }
  return best?.[0] ?? "1:1";
}
