import { CreativeError } from "../errors.ts";
import { getJson, postJson } from "./http.ts";

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_MS = 10 * 60 * 1000;

function runwayHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "X-Runway-Version": RUNWAY_API_VERSION,
  };
}

/** Text-to-video (Gen-3/Gen-4 family). Polls the task until it finishes. */
export async function runwayTextToVideo(
  key: string,
  input: { prompt: string; duration?: number; model?: string; ratio?: string },
): Promise<string> {
  const body = {
    promptText: input.prompt,
    model: input.model ?? "gen4_turbo",
    duration: clampDuration(input.duration),
    ratio: input.ratio ?? "1280:720",
  };
  const created = await postJson(
    "runway",
    `${RUNWAY_BASE}/text_to_video`,
    runwayHeaders(key),
    body,
    "text-to-video",
  );
  const task = (await created.json().catch(() => null)) as { id?: string } | null;
  if (!task || typeof task.id !== "string") {
    throw new CreativeError("provider_error", "runway did not return a task id.");
  }
  return await pollTask(key, task.id);
}

/** Image-to-video. The source image is passed as a data URI. */
export async function runwayImageToVideo(
  key: string,
  input: { image: string; prompt: string; duration?: number; model?: string; ratio?: string },
): Promise<string> {
  const body = {
    promptImage: input.image,
    promptText: input.prompt,
    model: input.model ?? "gen4_turbo",
    duration: clampDuration(input.duration),
    ratio: input.ratio ?? "1280:720",
  };
  const created = await postJson(
    "runway",
    `${RUNWAY_BASE}/image_to_video`,
    runwayHeaders(key),
    body,
    "image-to-video",
  );
  const task = (await created.json().catch(() => null)) as { id?: string } | null;
  if (!task || typeof task.id !== "string") {
    throw new CreativeError("provider_error", "runway did not return a task id.");
  }
  return await pollTask(key, task.id);
}

async function pollTask(key: string, taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    const task = (await getJson(
      "runway",
      `${RUNWAY_BASE}/tasks/${taskId}`,
      runwayHeaders(key),
      `task ${taskId}`,
    )) as { status?: string; output?: unknown };
    if (task.status === "SUCCEEDED") {
      const output = task.output;
      const url =
        typeof output === "string" && output.length > 0
          ? output
          : Array.isArray(output) && typeof output[0] === "string"
            ? output[0]
            : undefined;
      if (!url) {
        throw new CreativeError("provider_error", "runway finished the task but returned no video URL.");
      }
      return url;
    }
    if (task.status === "FAILED") {
      throw new CreativeError("provider_error", "runway task failed. Check the inputs and retry.");
    }
    if (Date.now() > deadline) {
      throw new CreativeError(
        "provider_timeout",
        `runway task did not finish in ${POLL_MAX_MS / 1000}s. Try a shorter video.`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function clampDuration(duration: number | undefined): number {
  // Runway durations are 5 or 10 seconds — snap deterministically.
  if (duration === undefined) return 5;
  return duration > 7.5 ? 10 : 5;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
