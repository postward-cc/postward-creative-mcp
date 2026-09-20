import { CreativeError } from "../errors.ts";
import { getJson, postJson, readJson } from "./http.ts";

const REPLICATE_BASE = "https://api.replicate.com/v1";

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_MS = 10 * 60 * 1000;

/**
 * Run a hosted Replicate model (owner/name) and poll until it finishes.
 * Local files are passed as data URIs — Replicate accepts them directly.
 */
export async function replicateRun(
  key: string,
  model: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const headers = { Authorization: `Bearer ${key}` };
  const created = await postJson(
    "replicate",
    `${REPLICATE_BASE}/models/${model}/predictions`,
    headers,
    { input },
    `model ${model}`,
  );
  const prediction = (await readJson(created)) as { id?: string; urls?: { get?: string } };
  const getUrl = prediction.urls?.get;
  if (typeof getUrl !== "string") {
    throw new CreativeError("provider_error", "replicate did not return a poll URL for the prediction.");
  }
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    const status = (await getJson("replicate", getUrl, headers, `prediction ${prediction.id ?? ""}`)) as {
      status?: string;
      output?: unknown;
      error?: unknown;
    };
    if (status.status === "succeeded") return status;
    if (status.status === "failed" || status.status === "canceled") {
      throw new CreativeError(
        "provider_error",
        `replicate prediction ${status.status}. Check the model and inputs, then retry.`,
      );
    }
    if (Date.now() > deadline) {
      throw new CreativeError(
        "provider_timeout",
        `replicate prediction did not finish in ${POLL_MAX_MS / 1000}s. Try a smaller input.`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Extract the output file URL (string or single-element array). */
export function replicateOutputUrl(result: unknown): string {
  const output = (result as { output?: unknown }).output;
  if (typeof output === "string" && output.length > 0) return output;
  if (Array.isArray(output) && typeof output[0] === "string" && output[0].length > 0) {
    return output[0];
  }
  throw new CreativeError("provider_error", "replicate returned no downloadable output. Retry.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default Replicate models — overridable via each tool's `model` parameter. */
export const REPLICATE_DEFAULT_MODELS = {
  upscale: "nightmareai/real-esrgan",
  backgroundRemoval: "lucataco/remove-bg",
} as const;
