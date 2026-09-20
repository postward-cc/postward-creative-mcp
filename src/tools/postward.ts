import { z } from "zod";
import { fileResult, readInputFile } from "../lib/files.ts";
import { defineTool } from "./define.ts";

export const postwardTools = [
  defineTool({
    name: "prepare_for_postward",
    description:
      "Format a local file's metadata for upload to Postward (postward.cc). Returns the file info " +
      "(path, MIME type, byte size, SHA-256) that you need to call request_source_asset_upload and then " +
      "register_source_asset in the Postward MCP. This tool does NOT upload or authenticate — it only prepares " +
      "the metadata. Use it when the user asks to move content into Postward for storage, review, " +
      "scheduling or publishing.",
    input: z.object({
      file_path: z.string().describe("Local path to the file"),
      name: z.string().optional().describe("Human-readable name for the asset in Postward"),
    }),
    run: async (input) => {
      const file = await readInputFile(input.file_path, "file");
      const result = await fileResult(file.path);
      return {
        name: input.name ?? file.path.split("/").pop() ?? "asset",
        file: {
          path: result.filePath,
          mimeType: result.mimeType,
          bytes: result.bytes,
          sha256: result.sha256,
        },
        nextSteps: [
          "In the Postward MCP, call request_source_asset_upload to get a signed upload URL.",
          "PUT the local file to that URL.",
          "Call register_source_asset with this metadata (name, mimeType, bytes, sha256).",
        ],
      };
    },
  }),
];
