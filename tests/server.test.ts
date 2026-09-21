import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { allTools, createCreativeServer, SERVER_NAME, SERVER_VERSION } from "../src/server.ts";
import { CreativeError, toCreativeError } from "../src/errors.ts";
import { runTool } from "./helpers.ts";

let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "pcm-server-"));
  process.env.POSTWARD_CREATIVE_TMP = path.join(home, "out");
});

afterAll(async () => {
  delete process.env.POSTWARD_CREATIVE_TMP;
  await rm(home, { recursive: true, force: true });
});

describe("tool catalog (specification)", () => {
  it("exposes the 23 documented tools with unique names", () => {
    expect(allTools).toHaveLength(23);
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every tool family", () => {
    const names = allTools.map((t) => t.name);
    for (const name of [
      "trim_video",
      "concat_videos",
      "transcode_video",
      "extract_frame",
      "extract_audio",
      "create_gif",
      "add_watermark",
      "burn_subtitles",
      "add_fade",
      "change_speed",
      "reverse_video",
      "flip_video",
      "crop_video",
      "adjust_volume",
      "replace_audio",
      "overlay_text",
      "resize_image",
      "convert_format",
      "image_thumbnail",
      "image_info",
      "probe_media",
      "checksum_file",
      "prepare_for_postward",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("has no AI generation tools and no key handling — the server is 100% offline", () => {
    const names = allTools.map((t) => t.name);
    for (const name of [
      "generate_image",
      "generate_video",
      "generate_music",
      "generate_voiceover",
      "animate_image",
      "edit_image",
      "upscale_image",
      "remove_background",
      "replace_background",
      "set_provider_key",
      "get_provider_status",
    ]) {
      expect(names).not.toContain(name);
    }
    const src = allTools.map((t) => `${t.name} ${t.description}`).join("\n");
    expect(src.toLowerCase()).not.toContain("api key");
  });

  it("gives every tool a meaningful description and a zod schema", () => {
    for (const tool of allTools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.input, tool.name).toBeTruthy();
    }
  });

  it("creates the MCP server with the list_tools utility registered", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const server = createCreativeServer();
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(clientTransport), client.connect(serverTransport)]);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain("list_tools");
    expect(names).toContain("trim_video");
    expect(names).toHaveLength(24); // 23 tools + list_tools
    await client.close();
    await server.close();
  });

  it("identifies the server as postward-creative-mcp with the package version", () => {
    expect(SERVER_NAME).toBe("postward-creative-mcp");
    expect(SERVER_VERSION).toBe(packageJson.version);
  });
});

describe("error contract", () => {
  it("fails closed with file_not_found for missing inputs", async () => {
    await expect(
      runTool("trim_video", { video_path: "/definitely/not/here.mp4", start: "0", end: "1" }),
    ).rejects.toMatchObject({ code: "file_not_found" });
  });

  it("wraps unknown errors into execution_failed", () => {
    const wrapped = toCreativeError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(CreativeError);
    expect(wrapped.code).toBe("execution_failed");
    expect(toCreativeError(new CreativeError("input_invalid", "x")).code).toBe("input_invalid");
  });
});

describe("utility tool outputs", () => {
  it("checksum_file returns the sha256 of a real file", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const filePath = path.join(home, "hello.txt");
    await writeFile(filePath, "hello world");
    const result = (await runTool("checksum_file", { file_path: filePath })) as { sha256: string; bytes: number };
    expect(result.sha256).toBe(createHash("sha256").update("hello world").digest("hex"));
    expect(result.bytes).toBe(11);
  });

  it("prepare_for_postward formats metadata without any network call", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const filePath = path.join(home, "clip.mp4");
    await writeFile(filePath, "fake media bytes");
    const result = (await runTool("prepare_for_postward", { file_path: filePath, name: "My clip" })) as {
      name: string;
      file: { path: string; mimeType: string; bytes: number; sha256: string };
      nextSteps: string[];
    };
    expect(result.name).toBe("My clip");
    expect(result.file.bytes).toBe(16);
    expect(result.file.sha256).toBe(createHash("sha256").update("fake media bytes").digest("hex"));
    expect(result.nextSteps.join(" ")).toContain("request_source_asset_upload");
  });
});
