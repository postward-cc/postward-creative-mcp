import { CreativeError } from "../errors.ts";
import { postJson, readJson } from "./http.ts";

const OPENAI_BASE = "https://api.openai.com/v1";

/** DALL-E 3 image generation. Returns PNG bytes (b64_json, no second fetch). */
export async function openaiImage(
  key: string,
  input: { prompt: string; size?: string; model?: string },
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    model: input.model ?? "dall-e-3",
    prompt: input.prompt,
    n: 1,
    response_format: "b64_json",
  };
  if (input.size) body["size"] = input.size;
  const response = await postJson(
    "openai",
    `${OPENAI_BASE}/images/generations`,
    { Authorization: `Bearer ${key}` },
    body,
    "image generation",
  );
  const result = (await readJson(response)) as { data?: Array<Record<string, unknown>> };
  const b64 = result.data?.[0]?.["b64_json"];
  if (typeof b64 !== "string") {
    throw new CreativeError("provider_error", "OpenAI returned no image data. Retry.");
  }
  return Buffer.from(b64, "base64");
}

/** TTS-1 speech synthesis. Returns MP3 bytes. */
export async function openaiSpeech(
  key: string,
  input: { text: string; voice?: string; speed?: number; model?: string },
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    model: input.model ?? "tts-1",
    input: input.text,
    voice: input.voice ?? "alloy",
    response_format: "mp3",
  };
  if (input.speed !== undefined) body["speed"] = input.speed;
  const response = await postJson(
    "openai",
    `${OPENAI_BASE}/audio/speech`,
    { Authorization: `Bearer ${key}` },
    body,
    "speech synthesis",
  );
  return Buffer.from(await response.arrayBuffer());
}

/** gpt-image-1 instruct-based image editing (multipart). Returns PNG bytes. */
export async function openaiImageEdit(
  key: string,
  input: { image: Buffer; prompt: string; model?: string },
): Promise<Buffer> {
  const form = new FormData();
  form.append("model", input.model ?? "gpt-image-1");
  form.append("prompt", input.prompt);
  form.append("image", new Blob([new Uint8Array(input.image)], { type: "image/png" }), "image.png");
  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new CreativeError("provider_timeout", "openai did not respond in time for image editing.");
    }
    throw new CreativeError("provider_unreachable", "Could not reach openai for image editing.");
  }
  if (!response.ok) {
    const { providerHttpError } = await import("../errors.ts");
    throw providerHttpError("openai", response.status, "image editing");
  }
  const result = (await readJson(response)) as { data?: Array<Record<string, unknown>> };
  const b64 = result.data?.[0]?.["b64_json"];
  if (typeof b64 !== "string") {
    throw new CreativeError("provider_error", "OpenAI returned no edited image data. Retry.");
  }
  return Buffer.from(b64, "base64");
}
