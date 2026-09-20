import { z } from "zod";
import { mimeForExt, readInputFile, sha256 } from "../lib/files.ts";
import { probeMedia } from "../lib/ffmpeg.ts";
import {
  keyHint,
  keysPath,
  loadKeys,
  PROVIDERS,
  setProviderKey,
  type ProviderId,
} from "../lib/keys.ts";
import { defineTool } from "./define.ts";

export const utilityTools = [
  defineTool({
    name: "probe_media",
    description:
      "Get detailed info about a local media file — duration, resolution, codecs, bitrate. Works on video, audio and images.",
    input: z.object({
      file_path: z.string().describe("Local path to the media file"),
    }),
    run: async (input) => {
      const file = await readInputFile(input.file_path, "media file");
      const probe = await probeMedia(file.path);
      const ext = file.path.split(".").pop() ?? "";
      return {
        filePath: file.path,
        mimeType: mimeForExt(ext),
        bytes: file.bytes,
        sha256: sha256(file.buffer),
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        bitrate: probe.bitrate,
        container: probe.formatName,
      };
    },
  }),

  defineTool({
    name: "checksum_file",
    description: "Calculate the SHA-256 hash of any local file.",
    input: z.object({
      file_path: z.string().describe("Local path to the file"),
    }),
    run: async (input) => {
      const file = await readInputFile(input.file_path, "file");
      return {
        filePath: file.path,
        bytes: file.bytes,
        sha256: sha256(file.buffer),
      };
    },
  }),

  defineTool({
    name: "set_provider_key",
    description:
      "Configure an AI provider API key. Keys are stored locally in ~/.postward-creative/keys.json (file permission 0600) and never leave this machine — they are sent only to the provider they belong to.",
    input: z.object({
      provider: z.enum(["fal", "openai", "stability", "elevenlabs", "replicate", "runway"])
        .describe("The AI provider this key belongs to"),
      key: z.string().min(8).describe("The API key from the provider's dashboard"),
    }),
    run: async (input) => {
      const provider = input.provider as ProviderId;
      await setProviderKey(provider, input.key);
      const keys = await loadKeys();
      const stored = keys[provider];
      return {
        provider,
        stored: true,
        configPath: keysPath(),
        keyHint: stored ? keyHint(stored) : null,
        note: "The key is saved locally with file permission 0600. It is only ever sent to " + provider + ".",
      };
    },
  }),

  defineTool({
    name: "get_provider_status",
    description:
      "Check which AI provider API keys are configured (keys are only shown masked). Also lists which providers each generation tool can use.",
    input: z.object({}),
    run: async () => {
      const keys = await loadKeys();
      return {
        configPath: keysPath(),
        providers: PROVIDERS.map((provider) => {
          const key = keys[provider];
          return {
            provider,
            configured: typeof key === "string" && key.length > 0,
            keyHint: key ? keyHint(key) : null,
          };
        }),
        toolProviders: {
          generate_image: ["fal", "openai", "stability"],
          generate_video: ["fal", "runway"],
          generate_music: ["fal"],
          generate_voiceover: ["fal", "openai", "elevenlabs"],
          animate_image: ["fal"],
          edit_image: ["fal", "openai"],
          upscale_image: ["replicate", "fal"],
          remove_background: ["replicate", "fal"],
          replace_background: ["fal"],
        },
      };
    },
  }),
];
