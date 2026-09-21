import { z } from "zod";
import { mimeForExt, readInputFile, sha256 } from "../lib/files.ts";
import { probeMedia } from "../lib/ffmpeg.ts";
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
];
