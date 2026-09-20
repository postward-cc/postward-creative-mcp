import { afterEach, describe, expect, it, vi } from "vitest";
import { falOutputUrl, falRun } from "../src/providers/fal.ts";
import { openaiImage, openaiSpeech } from "../src/providers/openai.ts";
import { replicateRun, replicateOutputUrl } from "../src/providers/replicate.ts";
import { sizeToAspect, stabilityImage } from "../src/providers/stability.ts";
import { providerHttpError, CreativeError } from "../src/errors.ts";
import { downloadToResult } from "../src/lib/download.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchStub = (url: string | URL | globalThis.Request, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)).buffer as ArrayBuffer,
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

function bytesResponse(bytes: Buffer, mime: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    headers: new Headers({ "content-type": mime }),
  } as unknown as Response;
}

describe("provider error mapping", () => {
  it("maps 401/403 to credential_invalid", () => {
    expect(providerHttpError("fal", 401, "op").code).toBe("credential_invalid");
    expect(providerHttpError("fal", 403, "op").code).toBe("credential_invalid");
  });

  it("maps 429 to provider_rate_limited", () => {
    expect(providerHttpError("openai", 429, "op").code).toBe("provider_rate_limited");
  });

  it("maps other 4xx to input_invalid and 5xx to provider_error", () => {
    expect(providerHttpError("runway", 422, "op").code).toBe("input_invalid");
    expect(providerHttpError("runway", 500, "op").code).toBe("provider_error");
  });

  it("messages never contain provider response bodies", () => {
    // Bodies are never passed into the mapper at all — enforced by the type.
    const err = providerHttpError("stability", 401, "image generation");
    expect(err.message).not.toMatch(/\{|\}/);
  });
});

describe("fal client", () => {
  it("sends the key as 'Key <key>' to fal.run", async () => {
    const fetchMock: FetchStub = async (_url, init) => {
      expect(String(_url)).toBe("https://fal.run/fal-ai/flux/schnell");
      expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Key fal-key-123");
      return jsonResponse({ images: [{ url: "https://cdn.fal/x.png" }] });
    };
    vi.stubGlobal("fetch", fetchMock);
    const result = await falRun("fal-key-123", "fal-ai/flux/schnell", { prompt: "a cat" });
    expect(falOutputUrl(result)).toBe("https://cdn.fal/x.png");
  });

  it("extracts video and audio URLs", () => {
    expect(falOutputUrl({ video: { url: "https://cdn/v.mp4" } })).toBe("https://cdn/v.mp4");
    expect(falOutputUrl({ audio: { url: "https://cdn/a.mp3" } })).toBe("https://cdn/a.mp3");
  });

  it("fails with provider_error when no output URL exists", () => {
    expect(() => falOutputUrl({ status: "OK" })).toThrow(CreativeError);
  });

  it("maps 401 to credential_invalid", async () => {
    vi.stubGlobal("fetch", (async () => jsonResponse({ error: "unauthorized" }, 401)) as FetchStub);
    await expect(falRun("bad", "fal-ai/flux/schnell", {})).rejects.toMatchObject({
      code: "credential_invalid",
    });
  });
});

describe("openai client", () => {
  it("decodes b64 image data", async () => {
    const png = Buffer.from("png-bytes");
    vi.stubGlobal(
      "fetch",
      (async () =>
        jsonResponse({ data: [{ b64_json: png.toString("base64") }] })) as FetchStub,
    );
    const buffer = await openaiImage("sk-123", { prompt: "a cat" });
    expect(buffer.equals(png)).toBe(true);
  });

  it("returns speech bytes as mp3", async () => {
    const mp3 = Buffer.from("mp3-bytes");
    vi.stubGlobal("fetch", (async () => bytesResponse(mp3, "audio/mpeg")) as FetchStub);
    const buffer = await openaiSpeech("sk-123", { text: "hello" });
    expect(buffer.equals(mp3)).toBe(true);
  });

  it("maps 429 to provider_rate_limited", async () => {
    vi.stubGlobal("fetch", (async () => jsonResponse({}, 429)) as FetchStub);
    await expect(openaiSpeech("sk-123", { text: "hello" })).rejects.toMatchObject({
      code: "provider_rate_limited",
    });
  });
});

describe("stability client", () => {
  it("returns image bytes and maps sizes to aspects", async () => {
    const png = Buffer.from("stable-png");
    vi.stubGlobal("fetch", (async () => bytesResponse(png, "image/png")) as FetchStub);
    const buffer = await stabilityImage("sk-123", { prompt: "a cat", aspectRatio: "16:9" });
    expect(buffer.equals(png)).toBe(true);
    expect(sizeToAspect("1024x1792")).toBe("9:16");
    expect(sizeToAspect("1920x1080")).toBe("16:9");
    expect(sizeToAspect("1024x1024")).toBe("1:1");
    expect(sizeToAspect("not-a-size")).toBe("1:1");
  });
});

describe("replicate client", () => {
  it("creates a prediction, polls until success and returns the output URL", async () => {
    const calls: string[] = [];
    let polls = 0;
    const fetchMock: FetchStub = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (calls.length === 1) {
        expect(init?.method).toBe("POST");
        expect(String(url)).toContain("/models/nightmareai/real-esrgan/predictions");
        return jsonResponse({ id: "p1", urls: { get: "https://api.replicate.com/v1/predictions/p1" } });
      }
      polls += 1;
      if (polls === 1) return jsonResponse({ status: "processing" });
      return jsonResponse({ status: "succeeded", output: "https://replicate.delivery/out.png" });
    };
    vi.stubGlobal("fetch", fetchMock);
    const result = await replicateRun("r8-123", "nightmareai/real-esrgan", { image: "data:..." });
    expect(replicateOutputUrl(result)).toBe("https://replicate.delivery/out.png");
    expect(calls.filter((c) => c.startsWith("GET"))).toHaveLength(2);
  });

  it("fails with provider_error when the prediction fails", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      (async () => {
        if (first) {
          first = false;
          return jsonResponse({ id: "p2", urls: { get: "https://api.replicate.com/v1/predictions/p2" } });
        }
        return jsonResponse({ status: "failed" });
      }) as FetchStub,
    );
    await expect(replicateRun("r8-123", "x/y", {})).rejects.toMatchObject({ code: "provider_error" });
  });

  it("extracts array outputs", () => {
    expect(replicateOutputUrl({ output: ["https://x/a.png"] })).toBe("https://x/a.png");
    expect(() => replicateOutputUrl({ output: null })).toThrow(CreativeError);
  });
});

describe("downloadToResult", () => {
  it("downloads bytes and computes the standard result shape", async () => {
    const png = Buffer.from("downloaded-image");
    vi.stubGlobal("fetch", (async () => bytesResponse(png, "image/png")) as FetchStub);
    const result = (await downloadToResult("https://cdn/x", "image/png")) as {
      filePath: string;
      mimeType: string;
      bytes: number;
      sha256: string;
    };
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes).toBe(png.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.filePath.startsWith("/tmp/postward-creative")).toBe(true);
  });
});
