import { z } from "zod";
import { CreativeError } from "../errors.ts";
import { readInputFile, fileResult } from "../lib/files.ts";
import {
  buildBurnSubtitlesArgs,
  buildConcatArgs,
  buildCropArgs,
  buildExtractAudioArgs,
  buildExtractFrameArgs,
  buildFadeArgs,
  buildFlipArgs,
  buildGifArgs,
  buildOverlayTextArgs,
  buildReplaceAudioArgs,
  buildReverseArgs,
  buildSpeedArgs,
  buildTranscodeArgs,
  buildTrimArgs,
  buildVolumeArgs,
  buildWatermarkArgs,
  hasAudio,
  probeMedia,
  runFfmpeg,
  type FfmpegPlan,
} from "../lib/ffmpeg.ts";
import { ensureWorkDir } from "../lib/files.ts";
import { defineTool } from "./define.ts";

async function runVideoTool(plan: FfmpegPlan, extraMeta?: Record<string, string | number>): Promise<unknown> {
  await runFfmpeg(plan);
  return await fileResult(plan.outputPath, "video/mp4", extraMeta);
}

/** Every video tool validates its inputs exist before invoking ffmpeg. */
async function requireVideo(path: string): Promise<string> {
  return (await readInputFile(path, "video")).path;
}

export const videoTools = [
  defineTool({
    name: "trim_video",
    description:
      "Cut a segment out of a video (start to end). Timestamps accept seconds (\"90\"), \"MM:SS\" or \"HH:MM:SS\". " +
      "Cut points snap to the nearest keyframe (stream copy, no re-encode).",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      start: z.string().describe('Start timestamp, e.g. "5", "1:30", "00:01:30"'),
      end: z.string().describe('End timestamp — must be after start'),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildTrimArgs(video, input.start, input.end, work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "concat_videos",
    description:
      "Join 2 to 4 video clips into one. Clips must share the same codec/resolution (stream copy, no re-encode) — " +
      "use transcode_video first if they differ.",
    input: z.object({
      videos: z.array(z.string()).min(2).max(4).describe("Paths of the clips, in order"),
    }),
    run: async (input) => {
      for (const video of input.videos) await requireVideo(video);
      const work = await ensureWorkDir();
      const plan = buildConcatArgs(input.videos, work);
      await runFfmpeg(plan);
      return await fileResult(plan.outputPath, "video/mp4");
    },
  }),

  defineTool({
    name: "transcode_video",
    description:
      "Normalize a video to a fixed aspect ratio (9:16, 1:1 or 16:9) with padding, re-encoded. " +
      "Unknown aspect values are rejected — nothing silently falls back.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      aspect: z.enum(["9:16", "1:1", "16:9"]).describe("Target aspect ratio"),
      quality: z.enum(["high", "medium", "low"]).optional().describe("Encoding quality. Default medium."),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildTranscodeArgs(video, input.aspect, input.quality ?? "medium", work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "extract_frame",
    description: 'Grab a single frame from a video as a PNG image, at a timestamp ("90", "1:30", "00:01:30").',
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      timestamp: z.string().describe("Timestamp of the frame"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildExtractFrameArgs(video, input.timestamp, work);
      await runFfmpeg(plan);
      return await fileResult(plan.outputPath, "image/png");
    },
  }),

  defineTool({
    name: "extract_audio",
    description: "Pull the audio track out of a video as an AAC .m4a file.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildExtractAudioArgs(video, work);
      await runFfmpeg(plan);
      return await fileResult(plan.outputPath, "audio/mp4");
    },
  }),

  defineTool({
    name: "create_gif",
    description: "Create a looping animated GIF from a segment of a video.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      start: z.string().optional().describe('Start timestamp. Default "0".'),
      duration: z.number().int().min(1).max(30).optional().describe("Duration in seconds. Default 3, max 30."),
      width: z.number().int().min(64).max(1920).optional().describe("Output width in pixels. Default 480."),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildGifArgs(video, input.start ?? "0", input.duration ?? 3, input.width ?? 480, work);
      await runFfmpeg(plan);
      return await fileResult(plan.outputPath, "image/gif");
    },
  }),

  defineTool({
    name: "add_watermark",
    description: "Overlay a logo image (PNG with transparency works best) on top of a video.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      logo_path: z.string().describe("Local path to the logo image"),
      position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).optional()
        .describe("Where to place the logo. Default bottom-right."),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const logo = await readInputFile(input.logo_path, "logo image");
      const work = await ensureWorkDir();
      const plan = buildWatermarkArgs(video, logo.path, input.position ?? "bottom-right", work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "burn_subtitles",
    description:
      "Burn an .srt subtitle file into the video pixels (visible on every platform). " +
      "Optional ASS force_style string, e.g. \"FontSize=24,PrimaryColour=&H00FFFFFF\".",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      srt_path: z.string().describe("Local path to the .srt file"),
      style: z.string().optional().describe("ASS force_style overrides (single line)"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      await readInputFile(input.srt_path, "subtitle file");
      const work = await ensureWorkDir();
      const plan = buildBurnSubtitlesArgs(video, input.srt_path, input.style, work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "add_fade",
    description: "Add a fade-in and/or fade-out to a video (seconds).",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      fade_in: z.number().min(0).optional().describe("Fade-in duration in seconds"),
      fade_out: z.number().min(0).optional().describe("Fade-out duration in seconds"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const fadeIn = input.fade_in ?? 0;
      const fadeOut = input.fade_out ?? 0;
      const work = await ensureWorkDir();
      const duration = (await probeMedia(video)).durationSeconds;
      if (duration === null) {
        throw new CreativeError("input_invalid", "Could not determine the video duration — fade_out cannot be placed.");
      }
      const plan = buildFadeArgs(video, duration, fadeIn, fadeOut, work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "change_speed",
    description: "Change playback speed (0.25x to 4x). Video and audio stay in sync.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      rate: z.number().min(0.25).max(4).describe("Speed multiplier (2 = twice as fast, 0.5 = half speed)"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildSpeedArgs(video, input.rate, work);
      return await runVideoTool(plan, { rate: input.rate });
    },
  }),

  defineTool({
    name: "reverse_video",
    description: "Play a video backwards (audio included when present).",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildReverseArgs(video, await hasAudio(video), work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "flip_video",
    description: "Mirror a video horizontally or vertically.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      direction: z.enum(["horizontal", "vertical"]).describe("Mirror direction"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildFlipArgs(video, input.direction, work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "crop_video",
    description: "Cut a video to a rectangular region. Width/height must be even numbers.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      width: z.number().int().positive().describe("Crop width in pixels"),
      height: z.number().int().positive().describe("Crop height in pixels"),
      x: z.number().int().min(0).describe("Left offset in pixels"),
      y: z.number().int().min(0).describe("Top offset in pixels"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildCropArgs(video, input.width, input.height, input.x, input.y, work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "adjust_volume",
    description: "Adjust audio volume, in decibels (+6 = louder, -6 = quieter).",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      gain: z.number().min(-60).max(24).describe("Gain in dB"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const plan = buildVolumeArgs(video, input.gain, work);
      return await runVideoTool(plan, { gainDb: input.gain });
    },
  }),

  defineTool({
    name: "replace_audio",
    description: "Swap a video's audio track with another audio file. Output ends when the shortest input ends.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      audio_path: z.string().describe("Local path to the new audio file"),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const audio = await readInputFile(input.audio_path, "audio file");
      const work = await ensureWorkDir();
      const plan = buildReplaceAudioArgs(video, audio.path, work);
      return await runVideoTool(plan);
    },
  }),

  defineTool({
    name: "overlay_text",
    description:
      "Burn a text caption onto the video (e.g. a hook or a call to action). Text is centered by default.",
    input: z.object({
      video_path: z.string().describe("Local path to the video"),
      text: z.string().min(1).max(200).describe("The text to display"),
      fontSize: z.number().int().min(8).max(400).optional().describe("Font size in px. Default 48."),
      color: z.string().optional().describe('Color name or #RRGGBB. Default "white".'),
      position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).optional()
        .describe("Text position. Default center."),
    }),
    run: async (input) => {
      const video = await requireVideo(input.video_path);
      const work = await ensureWorkDir();
      const fontFile = process.env.POSTWARD_CREATIVE_FONT;
      const plan = buildOverlayTextArgs(
        video,
        input.text,
        input.fontSize ?? 48,
        input.color ?? "white",
        input.position ?? "center",
        fontFile,
        work,
      );
      return await runVideoTool(plan);
    },
  }),
];
