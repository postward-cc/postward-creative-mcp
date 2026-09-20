import { z } from "zod";
import { CreativeError } from "../errors.ts";
import { dataUri, readInputFile, writeResult } from "../lib/files.ts";
import { downloadToResult } from "../lib/download.ts";
import { firstConfigured, loadKeys, resolveKey } from "../lib/keys.ts";
import type { ProviderId, ProviderKeys } from "../lib/keys.ts";
import { FAL_DEFAULT_MODELS, falOutputUrl, falRun } from "../providers/fal.ts";
import { openaiImage, openaiImageEdit, openaiSpeech } from "../providers/openai.ts";
import { REPLICATE_DEFAULT_MODELS, replicateOutputUrl, replicateRun } from "../providers/replicate.ts";
import { runwayTextToVideo } from "../providers/runway.ts";
import { sizeToAspect, stabilityImage } from "../providers/stability.ts";
import { elevenlabsSpeech } from "../providers/elevenlabs.ts";
import { defineTool } from "./define.ts";

const IMAGE_GENERATION_PROVIDERS = ["fal", "openai", "stability"] as const;
const SPEECH_PROVIDERS = ["fal", "openai", "elevenlabs"] as const;
const VIDEO_PROVIDERS = ["fal", "runway"] as const;
const IMAGE_EDIT_PROVIDERS = ["fal", "openai"] as const;
const BACKGROUND_PROVIDERS = ["replicate", "fal"] as const;

/**
 * Choose the provider: explicit request wins (validated against the tools'
 * supported set); otherwise the first configured key in preference order.
 */
function pickProvider(
  supported: readonly ProviderId[],
  requested: string | undefined,
  keys: ProviderKeys,
): ProviderId {
  if (requested !== undefined) {
    if (!(supported as readonly string[]).includes(requested)) {
      throw new CreativeError(
        "input_invalid",
        `This tool supports: ${supported.join(", ")}. Got "${requested}".`,
      );
    }
    return requested as ProviderId;
  }
  const found = firstConfigured(supported, keys);
  if (!found) {
    throw new CreativeError(
      "provider_key_missing",
      `No API key configured for any supported provider (${supported.join(", ")}). Set one with set_provider_key, or edit ~/.postward-creative/keys.json.`,
    );
  }
  return found;
}

function parseSize(size: string | undefined): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(size.trim());
  if (!match) {
    throw new CreativeError("input_invalid", `size must look like "1024x1024" (got "${size}").`);
  }
  const width = Number(match[1] ?? 0);
  const height = Number(match[2] ?? 0);
  if (width < 64 || width > 4096 || height < 64 || height > 4096) {
    throw new CreativeError("input_invalid", "size dimensions must be between 64 and 4096 pixels.");
  }
  return { width, height };
}

async function requireImageInput(imagePath: string): Promise<{ dataUri: string }> {
  const file = await readInputFile(imagePath, "image");
  return { dataUri: dataUri(file.buffer, "image/png") };
}

export const generateTools = [
  defineTool({
    name: "generate_image",
    description:
      "Generate an image from a text description using AI (fal FLUX, OpenAI DALL-E 3 or Stability). " +
      "Requires a provider API key (set_provider_key). The image is saved locally — it is not uploaded anywhere. " +
      "For Stability, any WxH size is mapped to the nearest supported aspect ratio.",
    input: z.object({
      prompt: z.string().min(1).describe("Detailed description of the image to generate"),
      provider: z.enum(["fal", "openai", "stability"]).optional().describe("AI provider. Omit to use the first configured key."),
      model: z.string().optional().describe("Model id (e.g. \"fal-ai/flux/schnell\", \"dall-e-3\"). Omit for the default."),
      size: z.string().optional().describe('Image dimensions as "WxH", e.g. "1024x1024", "1024x1792".'),
    }),
    run: async (input) => {
      const keys = await loadKeys();
      const provider = pickProvider(IMAGE_GENERATION_PROVIDERS, input.provider, keys);
      if (provider === "fal") {
        const key = await resolveKey("fal");
        const { width, height } = parseSize(input.size);
        const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.imageGen, {
          prompt: input.prompt,
          image_size: { width, height },
        });
        return await downloadToResult(falOutputUrl(result), "image/png");
      }
      if (provider === "openai") {
        const key = await resolveKey("openai");
        const buffer = await openaiImage(key, { prompt: input.prompt, size: input.size, model: input.model });
        return await writeResult(buffer, "png");
      }
      const key = await resolveKey("stability");
      const buffer = await stabilityImage(key, {
        prompt: input.prompt,
        aspectRatio: input.size ? sizeToAspect(input.size) : undefined,
      });
      return await writeResult(buffer, "png");
    },
  }),

  defineTool({
    name: "generate_voiceover",
    description:
      "Generate a voiceover from text using AI text-to-speech (fal, OpenAI TTS or ElevenLabs). " +
      "Requires a provider API key. Returns the path to the generated MP3.",
    input: z.object({
      text: z.string().min(1).describe("The script to convert to speech"),
      provider: z.enum(["fal", "openai", "elevenlabs"]).optional().describe("AI provider. Omit to use the first configured key."),
      voice: z.string().optional().describe("Voice id or name (provider-specific). Omit for the default voice."),
      speed: z.number().min(0.25).max(4).optional().describe("Speech rate (0.5 = slow, 2.0 = fast). Default 1.0."),
      model: z.string().optional().describe("Model id. Omit for the default (fal: minimax speech, openai: tts-1, elevenlabs: multilingual v2)."),
    }),
    run: async (input) => {
      const keys = await loadKeys();
      const provider = pickProvider(SPEECH_PROVIDERS, input.provider, keys);
      if (provider === "openai") {
        const key = await resolveKey("openai");
        const buffer = await openaiSpeech(key, {
          text: input.text,
          voice: input.voice,
          speed: input.speed,
          model: input.model,
        });
        return await writeResult(buffer, "mp3");
      }
      if (provider === "elevenlabs") {
        const key = await resolveKey("elevenlabs");
        const buffer = await elevenlabsSpeech(key, { text: input.text, voice: input.voice });
        return await writeResult(buffer, "mp3");
      }
      const key = await resolveKey("fal");
      const body: Record<string, unknown> = { text: input.text };
      if (input.voice) body["voice"] = input.voice;
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.tts, body);
      return await downloadToResult(falOutputUrl(result), "audio/mpeg");
    },
  }),

  defineTool({
    name: "generate_music",
    description:
      "Generate instrumental background music from a description (fal). Requires a fal API key. " +
      "Returns the path to the generated audio file.",
    input: z.object({
      prompt: z.string().min(1).describe("Description of the music style and mood"),
      duration: z.number().int().min(3).max(190).optional().describe("Duration in seconds. Default is provider-dependent."),
      model: z.string().optional().describe("fal model id. Omit for the default."),
    }),
    run: async (input) => {
      const key = await resolveKey("fal");
      const body: Record<string, unknown> = { prompt: input.prompt };
      if (input.duration) body["seconds"] = input.duration;
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.music, body);
      return await downloadToResult(falOutputUrl(result), "audio/wav");
    },
  }),

  defineTool({
    name: "generate_video",
    description:
      "Generate a short video from a text description using AI (fal or Runway). Requires a provider API key. " +
      "Generation is slow (minutes). Returns the path to the generated MP4.",
    input: z.object({
      prompt: z.string().min(1).describe("Description of the video to generate"),
      provider: z.enum(["fal", "runway"]).optional().describe("AI provider. Omit to use the first configured key."),
      duration: z.number().optional().describe("Duration in seconds (5-10, provider-dependent; Runway snaps to 5 or 10)."),
      model: z.string().optional().describe("Model id. Omit for the default."),
    }),
    run: async (input) => {
      const keys = await loadKeys();
      const provider = pickProvider(VIDEO_PROVIDERS, input.provider, keys);
      if (provider === "runway") {
        const key = await resolveKey("runway");
        const url = await runwayTextToVideo(key, {
          prompt: input.prompt,
          duration: input.duration,
          model: input.model,
        });
        return await downloadToResult(url, "video/mp4");
      }
      const key = await resolveKey("fal");
      const body: Record<string, unknown> = { prompt: input.prompt };
      if (input.duration) body["duration"] = input.duration;
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.videoGen, body);
      return await downloadToResult(falOutputUrl(result), "video/mp4");
    },
  }),

  defineTool({
    name: "animate_image",
    description:
      "Animate a static image using AI image-to-video (fal). The source image is a local file path. " +
      "Requires a fal API key. Returns the path to the generated MP4.",
    input: z.object({
      image_path: z.string().describe("Local path to the source image"),
      prompt: z.string().min(1).describe("How to animate the image"),
      duration: z.number().optional().describe("Duration in seconds (provider-dependent)."),
      model: z.string().optional().describe("fal model id. Omit for the default."),
    }),
    run: async (input) => {
      const key = await resolveKey("fal");
      const image = await requireImageInput(input.image_path);
      const body: Record<string, unknown> = { image_url: image.dataUri, prompt: input.prompt };
      if (input.duration) body["duration"] = input.duration;
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.imageToVideo, body);
      return await downloadToResult(falOutputUrl(result), "video/mp4");
    },
  }),

  defineTool({
    name: "edit_image",
    description:
      "Edit an existing image using a text instruction (e.g. \"make the background blue\", \"add a red hat\"). " +
      "Uses fal or OpenAI. Requires the matching provider key. Returns the path to the edited image.",
    input: z.object({
      image_path: z.string().describe("Local path to the image to edit"),
      prompt: z.string().min(1).describe("The editing instruction"),
      provider: z.enum(["fal", "openai"]).optional().describe("AI provider. Omit to use the first configured key."),
      model: z.string().optional().describe("Model id. Omit for the default (fal: qwen-image-edit, openai: gpt-image-1)."),
    }),
    run: async (input) => {
      const keys = await loadKeys();
      const provider = pickProvider(IMAGE_EDIT_PROVIDERS, input.provider, keys);
      if (provider === "openai") {
        const key = await resolveKey("openai");
        const file = await readInputFile(input.image_path, "image");
        const buffer = await openaiImageEdit(key, { image: file.buffer, prompt: input.prompt, model: input.model });
        return await writeResult(buffer, "png");
      }
      const key = await resolveKey("fal");
      const image = await requireImageInput(input.image_path);
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.imageEdit, {
        image_url: image.dataUri,
        prompt: input.prompt,
      });
      return await downloadToResult(falOutputUrl(result), "image/png");
    },
  }),

  defineTool({
    name: "remove_background",
    description:
      "Remove the background from an image, producing a transparent PNG (Replicate or fal). " +
      "Requires the matching provider key.",
    input: z.object({
      image_path: z.string().describe("Local path to the source image"),
      provider: z.enum(["replicate", "fal"]).optional().describe("AI provider. Omit to use the first configured key."),
      model: z.string().optional().describe("Model id (owner/name for Replicate). Omit for the default."),
    }),
    run: async (input) => {
      const keys = await loadKeys();
      const provider = pickProvider(BACKGROUND_PROVIDERS, input.provider, keys);
      if (provider === "replicate") {
        const key = await resolveKey("replicate");
        const image = await requireImageInput(input.image_path);
        const result = await replicateRun(key, input.model ?? REPLICATE_DEFAULT_MODELS.backgroundRemoval, {
          image: image.dataUri,
        });
        return await downloadToResult(replicateOutputUrl(result), "image/png");
      }
      const key = await resolveKey("fal");
      const image = await requireImageInput(input.image_path);
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.backgroundRemoval, {
        image_url: image.dataUri,
      });
      return await downloadToResult(falOutputUrl(result), "image/png");
    },
  }),

  defineTool({
    name: "upscale_image",
    description:
      "Upscale an image to higher resolution — 2x or 4x (Replicate Real-ESRGAN or fal). " +
      "Requires the matching provider key.",
    input: z.object({
      image_path: z.string().describe("Local path to the source image"),
      scale: z.union([z.literal(2), z.literal(4)]).optional().describe("Upscale factor. Default 2."),
      provider: z.enum(["replicate", "fal"]).optional().describe("AI provider. Omit to use the first configured key."),
      model: z.string().optional().describe("Model id (owner/name for Replicate). Omit for the default."),
    }),
    run: async (input) => {
      const scale = input.scale ?? 2;
      const keys = await loadKeys();
      const provider = pickProvider(BACKGROUND_PROVIDERS, input.provider, keys);
      if (provider === "replicate") {
        const key = await resolveKey("replicate");
        const image = await requireImageInput(input.image_path);
        const result = await replicateRun(key, input.model ?? REPLICATE_DEFAULT_MODELS.upscale, {
          image: image.dataUri,
          scale,
        });
        return await downloadToResult(replicateOutputUrl(result), "image/png");
      }
      const key = await resolveKey("fal");
      const image = await requireImageInput(input.image_path);
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.upscale, {
        image_url: image.dataUri,
        scale,
      });
      return await downloadToResult(falOutputUrl(result), "image/png");
    },
  }),

  defineTool({
    name: "replace_background",
    description:
      "Replace the background of an image following a text description (fal). " +
      "Requires a fal API key. Returns the path to the new image.",
    input: z.object({
      image_path: z.string().describe("Local path to the source image"),
      prompt: z.string().min(1).describe("What the new background should look like"),
      model: z.string().optional().describe("fal model id. Omit for the default."),
    }),
    run: async (input) => {
      const key = await resolveKey("fal");
      const image = await requireImageInput(input.image_path);
      const result = await falRun(key, input.model ?? FAL_DEFAULT_MODELS.imageEdit, {
        image_url: image.dataUri,
        prompt: `Replace the background: ${input.prompt}`,
      });
      return await downloadToResult(falOutputUrl(result), "image/png");
    },
  }),
];
