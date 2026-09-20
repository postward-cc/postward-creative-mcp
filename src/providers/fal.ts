import { CreativeError } from "../errors.ts";
import { postJson, readJson } from "./http.ts";

const FAL_BASE = "https://fal.run";

/** Call a fal.ai model synchronously (fal.run). Returns the parsed JSON. */
export async function falRun(
  key: string,
  model: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await postJson(
    "fal",
    `${FAL_BASE}/${model}`,
    { Authorization: `Key ${key}` },
    body,
    `model ${model}`,
  );
  return readJson(response);
}

/**
 * Extract the output URL from a fal response. Models differ in shape:
 * images[0].url (image models), video.url (video), audio.url (audio),
 * output (plain string). Missing output is a provider error, not a guess.
 */
export function falOutputUrl(result: unknown): string {
  const obj = result as Record<string, unknown> | null;
  if (obj && typeof obj === "object") {
    const images = obj["images"];
    if (Array.isArray(images) && images.length > 0) {
      const url = (images[0] as Record<string, unknown> | undefined)?.["url"];
      if (typeof url === "string") return url;
    }
    const video = obj["video"];
    if (video && typeof video === "object") {
      const url = (video as Record<string, unknown>)["url"];
      if (typeof url === "string") return url;
    }
    const audio = obj["audio"];
    if (audio && typeof audio === "object") {
      const url = (audio as Record<string, unknown>)["url"];
      if (typeof url === "string") return url;
    }
    const image = obj["image"];
    if (image && typeof image === "object") {
      const url = (image as Record<string, unknown>)["url"];
      if (typeof url === "string") return url;
    }
    const output = obj["output"];
    if (typeof output === "string" && output.length > 0) return output;
  }
  throw new CreativeError(
    "provider_error",
    "fal returned a response without a downloadable file. Try a different model.",
  );
}

/** Default fal models — overridable via each tool's `model` parameter. */
export const FAL_DEFAULT_MODELS = {
  imageGen: "fal-ai/flux/schnell",
  videoGen: "fal-ai/kling-video/v1/standard/text-to-video",
  imageToVideo: "fal-ai/kling-video/v1/standard/image-to-video",
  music: "fal-ai/stable-audio",
  tts: "fal-ai/minimax/speech-02-hd",
  imageEdit: "fal-ai/qwen-image-edit",
  backgroundRemoval: "fal-ai/birefnet",
  upscale: "fal-ai/esrgan",
} as const;
