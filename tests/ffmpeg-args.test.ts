import { describe, expect, it } from "vitest";
import {
  atempoChain,
  buildBurnSubtitlesArgs,
  buildConcatArgs,
  buildCropArgs,
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
  escapeFilterValue,
  parseTimestamp,
} from "../src/lib/ffmpeg.ts";
import { CreativeError } from "../src/errors.ts";

const WORK = "/tmp/postward-creative-test";

describe("parseTimestamp", () => {
  it("accepts seconds, MM:SS and HH:MM:SS", () => {
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("1:30")).toBe(90);
    expect(parseTimestamp("1:00:30")).toBe(3630);
    expect(parseTimestamp("1.5")).toBe(1.5);
  });

  it("rejects garbage with input_invalid", () => {
    expect(() => parseTimestamp("abc")).toThrow(CreativeError);
    expect(() => parseTimestamp("-5")).toThrow(CreativeError);
    expect(() => parseTimestamp("1:2:3:4")).toThrow(CreativeError);
    try {
      parseTimestamp("xyz");
    } catch (err) {
      expect((err as CreativeError).code).toBe("input_invalid");
    }
  });
});

describe("buildTrimArgs", () => {
  it("uses -ss before -i and -t duration, never -to", () => {
    const plan = buildTrimArgs("/in.mp4", "10", "25", WORK);
    expect(plan.args.indexOf("-ss")).toBeLessThan(plan.args.indexOf("-i"));
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("15");
    expect(plan.args).not.toContain("-to");
    expect(plan.outputPath.endsWith(".mp4")).toBe(true);
  });

  it("parses MM:SS ranges", () => {
    const plan = buildTrimArgs("/in.mp4", "0:00", "1:00", WORK);
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("60");
  });

  it("rejects end <= start", () => {
    expect(() => buildTrimArgs("/in.mp4", "10", "10", WORK)).toThrow(CreativeError);
    expect(() => buildTrimArgs("/in.mp4", "20", "10", WORK)).toThrow(CreativeError);
  });
});

describe("buildTranscodeArgs", () => {
  it("scales and pads to the target aspect", () => {
    const plan = buildTranscodeArgs("/in.mp4", "9:16", "medium", WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("scale=1080:1920");
    expect(vf).toContain("pad=1080:1920");
  });

  it("maps quality to crf", () => {
    expect(buildTranscodeArgs("/in.mp4", "1:1", "high", WORK).args).toContain("18");
    expect(buildTranscodeArgs("/in.mp4", "1:1", "low", WORK).args).toContain("28");
  });

  it("rejects unknown aspects and qualities (no silent fallback)", () => {
    expect(() => buildTranscodeArgs("/in.mp4", "4:3", "medium", WORK)).toThrow(CreativeError);
    expect(() => buildTranscodeArgs("/in.mp4", "9:16", "ultra", WORK)).toThrow(CreativeError);
  });
});

describe("buildConcatArgs", () => {
  it("uses the concat demuxer with stream copy", () => {
    const plan = buildConcatArgs(["/a.mp4", "/b.mp4"], WORK);
    expect(plan.args[plan.args.indexOf("-f") + 1]).toBe("concat");
    expect(plan.args).toContain("-c");
    expect(plan.preWrite).toHaveLength(1);
    expect(plan.preWrite?.[0]?.content).toContain("file '/a.mp4'");
    expect(plan.preWrite?.[0]?.content).toContain("file '/b.mp4'");
  });

  it("escapes single quotes in clip paths", () => {
    const plan = buildConcatArgs(["/my 'clip'.mp4", "/b.mp4"], WORK);
    expect(plan.preWrite?.[0]?.content).toContain("file '/my '\\''clip'\\''.mp4'");
  });

  it("accepts 2 to 4 clips only", () => {
    expect(() => buildConcatArgs(["/a.mp4"], WORK)).toThrow(CreativeError);
    expect(() => buildConcatArgs(["/a.mp4", "/b.mp4", "/c.mp4", "/d.mp4", "/e.mp4"], WORK)).toThrow(
      CreativeError,
    );
  });
});

describe("buildExtractFrameArgs", () => {
  it("seeks before input and outputs a png", () => {
    const plan = buildExtractFrameArgs("/in.mp4", "1:30", WORK);
    expect(plan.args.indexOf("-ss")).toBeLessThan(plan.args.indexOf("-i"));
    expect(plan.args[plan.args.indexOf("-frames:v") + 1]).toBe("1");
    expect(plan.outputPath.endsWith(".png")).toBe(true);
  });
});

describe("buildGifArgs", () => {
  it("uses palette generation for quality", () => {
    const plan = buildGifArgs("/in.mp4", "0", 3, 480, WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("fps=12");
    expect(vf).toContain("palettegen");
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("3");
  });

  it("caps duration at 30s", () => {
    expect(() => buildGifArgs("/in.mp4", "0", 31, 480, WORK)).toThrow(CreativeError);
  });
});

describe("buildWatermarkArgs", () => {
  it("positions with overlay expressions", () => {
    const plan = buildWatermarkArgs("/in.mp4", "/logo.png", "bottom-right", WORK);
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("overlay=main_w-overlay_w-24:main_h-overlay_h-24");
    expect(plan.args.filter((a) => a === "-i")).toHaveLength(2);
  });

  it("rejects unknown positions", () => {
    expect(() => buildWatermarkArgs("/in.mp4", "/logo.png", "middle", WORK)).toThrow(CreativeError);
  });
});

describe("escapeFilterValue", () => {
  it("escapes backslash, quote, colon and percent", () => {
    expect(escapeFilterValue("a\\b")).toBe("'a\\\\b'");
    expect(escapeFilterValue("it's")).toBe("'it\\'s'");
    expect(escapeFilterValue("a:b")).toBe("'a\\:b'");
    expect(escapeFilterValue("100%")).toBe("'100\\%'");
  });
});

describe("buildBurnSubtitlesArgs", () => {
  it("references the srt via an escaped filename", () => {
    const plan = buildBurnSubtitlesArgs("/in.mp4", "/tmp/my subs.srt", undefined, WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("subtitles=filename='/tmp/my subs.srt'");
  });

  it("appends force_style when a style is given", () => {
    const plan = buildBurnSubtitlesArgs("/in.mp4", "/subs.srt", "FontSize=24", WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("force_style='FontSize=24'");
  });

  it("rejects multi-line styles", () => {
    expect(() => buildBurnSubtitlesArgs("/in.mp4", "/subs.srt", "FontSize=24\nColor=red", WORK)).toThrow(
      CreativeError,
    );
  });
});

describe("buildFadeArgs", () => {
  it("places fade-out relative to the clip duration", () => {
    const plan = buildFadeArgs("/in.mp4", 10, 0.5, 2, WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("fade=t=in:st=0:d=0.5");
    expect(vf).toContain("fade=t=out:st=8:d=2");
  });

  it("requires at least one non-zero fade", () => {
    expect(() => buildFadeArgs("/in.mp4", 10, 0, 0, WORK)).toThrow(CreativeError);
  });
});

describe("buildSpeedArgs / atempoChain", () => {
  it("chains atempo for rates above 2", () => {
    expect(atempoChain(4)).toBe("atempo=2,atempo=2");
    const plan = buildSpeedArgs("/in.mp4", 4, WORK);
    const af = plan.args[plan.args.indexOf("-af") + 1];
    expect(af).toBe("atempo=2,atempo=2");
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toBe("setpts=PTS/4");
  });

  it("chains atempo for rates below 0.5", () => {
    expect(atempoChain(0.25)).toBe("atempo=0.5,atempo=0.5");
  });

  it("rejects rates out of range", () => {
    expect(() => buildSpeedArgs("/in.mp4", 8, WORK)).toThrow(CreativeError);
    expect(() => buildSpeedArgs("/in.mp4", 0.1, WORK)).toThrow(CreativeError);
  });
});

describe("buildReverseArgs", () => {
  it("includes areverse only when audio exists", () => {
    const withAudio = buildReverseArgs("/in.mp4", true, WORK);
    expect(withAudio.args).toContain("areverse");
    expect(withAudio.args).toContain("aac");
    const silent = buildReverseArgs("/in.mp4", false, WORK);
    expect(silent.args).not.toContain("-af");
    expect(silent.args).not.toContain("areverse");
  });
});

describe("buildFlipArgs", () => {
  it("maps directions to filters", () => {
    expect(buildFlipArgs("/in.mp4", "horizontal", WORK).args).toContain("hflip");
    expect(buildFlipArgs("/in.mp4", "vertical", WORK).args).toContain("vflip");
    expect(() => buildFlipArgs("/in.mp4", "diagonal", WORK)).toThrow(CreativeError);
  });
});

describe("buildCropArgs", () => {
  it("builds crop=w:h:x:y", () => {
    const plan = buildCropArgs("/in.mp4", 640, 360, 10, 20, WORK);
    expect(plan.args[plan.args.indexOf("-vf") + 1]).toBe("crop=640:360:10:20");
  });

  it("rejects odd dimensions and negatives", () => {
    expect(() => buildCropArgs("/in.mp4", 641, 360, 0, 0, WORK)).toThrow(CreativeError);
    expect(() => buildCropArgs("/in.mp4", 640, -8, 0, 0, WORK)).toThrow(CreativeError);
  });
});

describe("buildVolumeArgs", () => {
  it("applies the gain in dB", () => {
    const plan = buildVolumeArgs("/in.mp4", 6, WORK);
    expect(plan.args[plan.args.indexOf("-af") + 1]).toBe("volume=6dB");
    expect(() => buildVolumeArgs("/in.mp4", 40, WORK)).toThrow(CreativeError);
  });
});

describe("buildReplaceAudioArgs", () => {
  it("maps video from input 0 and audio from input 1", () => {
    const plan = buildReplaceAudioArgs("/in.mp4", "/new.m4a", WORK);
    const args = plan.args;
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0");
    expect(args[args.lastIndexOf("-map") + 1]).toBe("1:a:0");
    expect(args).toContain("-shortest");
  });
});

describe("buildOverlayTextArgs", () => {
  it("escapes the text and defaults to centered", () => {
    const plan = buildOverlayTextArgs("/in.mp4", "it's: 100% done", 48, "white", "center", undefined, WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("drawtext=text='it\\'s\\: 100\\% done'");
    expect(vf).toContain("x=(w-text_w)/2:y=(h-text_h)/2");
    expect(vf).toContain("fontsize=48");
  });

  it("validates color and position", () => {
    expect(() => buildOverlayTextArgs("/in.mp4", "hi", 48, "#zzz", "center", undefined, WORK)).toThrow(
      CreativeError,
    );
    expect(() => buildOverlayTextArgs("/in.mp4", "hi", 48, "white", "middle", undefined, WORK)).toThrow(
      CreativeError,
    );
  });

  it("honors a font file override", () => {
    const plan = buildOverlayTextArgs("/in.mp4", "hi", 48, "white", "center", "/fonts/x.ttf", WORK);
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("fontfile=");
  });
});
