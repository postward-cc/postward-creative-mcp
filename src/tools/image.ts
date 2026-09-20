import { z } from "zod";
import { readInputFile, fileResult, mimeForExt } from "../lib/files.ts";
import {
  buildConvertArgs,
  buildResizeArgs,
  buildThumbnailArgs,
  identifyImage,
  runMagick,
  type ImageFormat,
} from "../lib/imagemagick.ts";
import { ensureWorkDir } from "../lib/files.ts";
import { defineTool } from "./define.ts";

async function requireImage(path: string): Promise<string> {
  return (await readInputFile(path, "image")).path;
}

export const imageTools = [
  defineTool({
    name: "resize_image",
    description: "Scale an image to fit within width x height (aspect ratio preserved).",
    input: z.object({
      image_path: z.string().describe("Local path to the image"),
      width: z.number().int().min(16).max(8192).describe("Max width in pixels"),
      height: z.number().int().min(16).max(8192).describe("Max height in pixels"),
    }),
    run: async (input) => {
      const image = await requireImage(input.image_path);
      const work = await ensureWorkDir();
      const plan = buildResizeArgs(image, input.width, input.height, work);
      await runMagick(plan);
      return await fileResult(plan.outputPath, "image/png");
    },
  }),

  defineTool({
    name: "convert_format",
    description: "Convert an image between PNG, JPEG and WebP. JPEG gets a white background where the source is transparent.",
    input: z.object({
      image_path: z.string().describe("Local path to the image"),
      format: z.enum(["png", "jpeg", "webp"]).describe("Target format"),
    }),
    run: async (input) => {
      const image = await requireImage(input.image_path);
      const work = await ensureWorkDir();
      const plan = buildConvertArgs(image, input.format as ImageFormat, work);
      await runMagick(plan);
      return await fileResult(plan.outputPath, mimeForExt(input.format === "jpeg" ? "jpg" : input.format));
    },
  }),

  defineTool({
    name: "image_thumbnail",
    description: "Create a small preview version of an image (aspect ratio preserved).",
    input: z.object({
      image_path: z.string().describe("Local path to the image"),
      size: z.number().int().min(16).max(2048).optional().describe("Max dimension in px. Default 320."),
    }),
    run: async (input) => {
      const image = await requireImage(input.image_path);
      const work = await ensureWorkDir();
      const plan = buildThumbnailArgs(image, input.size ?? 320, work);
      await runMagick(plan);
      return await fileResult(plan.outputPath, "image/png");
    },
  }),

  defineTool({
    name: "image_info",
    description: "Get an image's dimensions, format, byte size, MIME type and SHA-256.",
    input: z.object({
      image_path: z.string().describe("Local path to the image"),
    }),
    run: async (input) => {
      const image = await readInputFile(input.image_path, "image");
      const info = await identifyImage(image.path);
      const ext = info.format.toLowerCase().replace("jpeg", "jpg");
      const result = await fileResult(image.path, mimeForExt(ext));
      return {
        filePath: image.path,
        format: info.format,
        width: info.width,
        height: info.height,
        bytes: image.bytes,
        mimeType: result.mimeType,
        sha256: result.sha256,
      };
    },
  }),
];
