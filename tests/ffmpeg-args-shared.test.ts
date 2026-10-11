import { describe, expect, it } from "vitest";
import {
  FfmpegInputError,
  TRANSCODE_ASPECTS,
  WATERMARK_POSITIONS,
  aspectDimensions,
  atempoChain,
  concatListContent,
  escapeFilterValue,
  formatSeconds,
  parseTimestamp,
  requirePositiveInt,
  scalePadFilter,
  watermarkCoordinates,
} from "../src/lib/ffmpeg-args.ts";

/**
 * Contract tests for the published `@postward-cc/creative-mcp/ffmpeg-args`
 * subpath, exercised directly rather than through an adapter.
 *
 * The adapters each validate their own inputs first, to raise their own domain
 * error, so the guards inside this module are unreachable from both production
 * callers. They are still part of the published surface a third party imports,
 * so they are pinned here instead of left to be discovered in someone's stack.
 */
describe("parseTimestamp", () => {
  it("accepts seconds, MM:SS, HH:MM:SS and decimals", () => {
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("1:30")).toBe(90);
    expect(parseTimestamp("1:00:30")).toBe(3630);
    expect(parseTimestamp("1.5")).toBe(1.5);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTimestamp("  1:30  ")).toBe(90);
  });

  it.each(["not-a-time", "-5", "1:2:3:4", "1::30", "", "1:30:00:00"])(
    "rejects %j instead of coercing it to zero",
    (value) => {
      expect(() => parseTimestamp(value)).toThrow(FfmpegInputError);
    },
  );
});

describe("formatSeconds", () => {
  it("drops trailing zeros but keeps meaningful decimals", () => {
    expect(formatSeconds(15)).toBe("15");
    expect(formatSeconds(1.5)).toBe("1.5");
    expect(formatSeconds(0.123456)).toBe("0.123");
  });
});

describe("aspectDimensions", () => {
  it.each(TRANSCODE_ASPECTS)("maps %s to its declared frame", (aspect) => {
    expect(aspectDimensions(aspect)).toEqual({
      width: aspect === "16:9" ? 1920 : 1080,
      height: aspect === "9:16" ? 1920 : 1080,
    });
  });

  it("rejects an aspect outside the table rather than defaulting", () => {
    expect(() => aspectDimensions("4:3")).toThrow(FfmpegInputError);
  });
});

describe("scalePadFilter", () => {
  it("scales with aspect preservation, then pads to the exact frame", () => {
    expect(scalePadFilter(1080, 1920)).toBe(
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    );
  });

  it("stays centred for a square frame", () => {
    expect(scalePadFilter(1080, 1080)).toContain("pad=1080:1080");
  });
});

describe("requirePositiveInt", () => {
  it("returns the value when it is within range", () => {
    expect(requirePositiveInt(30, "duration")).toBe(30);
    expect(requirePositiveInt(30, "duration", 30)).toBe(30);
  });

  it("rejects zero, negatives, fractions and out-of-range values", () => {
    expect(() => requirePositiveInt(0, "duration")).toThrow(FfmpegInputError);
    expect(() => requirePositiveInt(-1, "duration")).toThrow(FfmpegInputError);
    expect(() => requirePositiveInt(1.5, "duration")).toThrow(FfmpegInputError);
    expect(() => requirePositiveInt(31, "duration", 30)).toThrow(FfmpegInputError);
  });

  it("names the field and the limit so the message is actionable", () => {
    expect(() => requirePositiveInt(31, "duration", 30)).toThrow(/duration.*up to 30/);
  });
});

describe("escapeFilterValue", () => {
  it("escapes and quotes every character that would break a filtergraph", () => {
    expect(escapeFilterValue("it's: 100% done\\")).toBe("'it\\'s\\: 100\\% done\\\\'");
  });

  it("leaves ordinary text intact", () => {
    expect(escapeFilterValue("Hello World")).toBe("'Hello World'");
  });
});

describe("concatListContent", () => {
  it("writes one file line per clip with a trailing newline", () => {
    expect(concatListContent(["/a.mp4", "/b.mp4"])).toBe("file '/a.mp4'\nfile '/b.mp4'\n");
  });

  it("escapes single quotes using the concat demuxer's own form", () => {
    expect(concatListContent(["/my 'clip'.mp4"])).toBe("file '/my '\\''clip'\\''.mp4'\n");
  });

  it("produces only the newline for an empty list", () => {
    expect(concatListContent([])).toBe("\n");
  });
});

describe("watermarkCoordinates", () => {
  it.each([
    ["top-left", "24:24"],
    ["top-right", "main_w-overlay_w-24:24"],
    ["bottom-left", "24:main_h-overlay_h-24"],
    ["bottom-right", "main_w-overlay_w-24:main_h-overlay_h-24"],
    ["center", "(main_w-overlay_w)/2:(main_h-overlay_h)/2"],
  ])("places %s at %s", (position, expected) => {
    expect(watermarkCoordinates(position)).toBe(expected);
  });

  it("honours a caller-supplied margin", () => {
    expect(watermarkCoordinates("top-left", 40)).toBe("40:40");
  });

  it("rejects an unknown position", () => {
    expect(() => watermarkCoordinates("middle")).toThrow(FfmpegInputError);
    expect(() => watermarkCoordinates("middle")).toThrow(/Supported/);
  });

  it("declares exactly the positions the ffmpeg overlay expression covers", () => {
    expect([...WATERMARK_POSITIONS]).toEqual([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "center",
    ]);
  });
});

describe("atempoChain", () => {
  it("leaves a single stage alone inside ffmpeg's smooth range", () => {
    expect(atempoChain(1)).toBe("atempo=1");
    expect(atempoChain(1.5)).toBe("atempo=1.5");
    expect(atempoChain(2)).toBe("atempo=2");
    expect(atempoChain(0.5)).toBe("atempo=0.5");
  });

  it("chains stages above 2x so ffmpeg blends rather than skips samples", () => {
    expect(atempoChain(4)).toBe("atempo=2,atempo=2");
    expect(atempoChain(8)).toBe("atempo=2,atempo=2,atempo=2");
  });

  it("chains stages below 0.5x for the same reason", () => {
    expect(atempoChain(0.25)).toBe("atempo=0.5,atempo=0.5");
  });

  it("keeps every stage inside 0.5x–2x", () => {
    for (const rate of [0.1, 0.3, 0.75, 1, 1.9, 2.5, 3, 6, 16]) {
      const factors = atempoChain(rate)
        .split(",")
        .map((stage) => Number(stage.split("=")[1]));
      for (const factor of factors) {
        expect(factor).toBeGreaterThanOrEqual(0.5);
        expect(factor).toBeLessThanOrEqual(2);
      }
      expect(factors.reduce((product, factor) => product * factor, 1)).toBeCloseTo(rate, 4);
    }
  });

  it("rejects non-finite and non-positive rates", () => {
    expect(() => atempoChain(Number.NaN)).toThrow(FfmpegInputError);
    expect(() => atempoChain(Number.POSITIVE_INFINITY)).toThrow(FfmpegInputError);
    expect(() => atempoChain(0)).toThrow(FfmpegInputError);
    expect(() => atempoChain(-1)).toThrow(FfmpegInputError);
  });
});