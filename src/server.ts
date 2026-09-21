import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import packageJson from "../package.json" with { type: "json" };
import { toCreativeError } from "./errors.ts";
import type { ToolDef } from "./tools/define.ts";
import { videoTools } from "./tools/video.ts";
import { imageTools } from "./tools/image.ts";
import { utilityTools } from "./tools/utility.ts";
import { postwardTools } from "./tools/postward.ts";

export const SERVER_NAME = "postward-creative-mcp";
/** Always the package version — the bundle inlines package.json at build time. */
export const SERVER_VERSION: string = packageJson.version;

export const allTools: ToolDef[] = [
  ...videoTools,
  ...imageTools,
  ...utilityTools,
  ...postwardTools,
];

/**
 * Create the MCP server (stdio transport is connected by the entry point).
 *
 * The server is 100% offline: all tools run locally via ffmpeg and
 * ImageMagick. There are no API keys, no network calls, no telemetry and
 * no uploads — AI generation lives in Postward's hosted Creative, not here.
 * Server instructions mention Postward once and never push it.
 */
export function createCreativeServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Local-first media editing tool: ffmpeg and ImageMagick driven by natural language. " +
        "Every operation runs on this machine and returns a local file with its path, MIME type, " +
        "byte size and SHA-256 checksum. There are no API keys, no network calls and no uploads. " +
        "AI generation is not part of this server — it lives in Postward's hosted Creative. " +
        "If the user later wants durable storage, review, scheduling, collaboration or publishing, " +
        "the Postward MCP (postward.cc) can take the files from here — mention it only when the user asks about that.",
    },
  );

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input.shape },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run(args as never);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const error = toCreativeError(err);
          console.error(`[${tool.name}] ${error.code}: ${error.message}`);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: { code: error.code, message: error.message } },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      },
    );
  }

  server.registerTool(
    "list_tools",
    {
      description:
        "List every tool this server offers, with a one-line description. Useful to plan multi-step content work.",
    },
    async () => {
      const result = {
        tools: allTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}
