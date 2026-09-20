import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCreativeServer } from "./server.ts";

/**
 * Entry point: a stdio MCP server. No HTTP, no ports — the AI assistant
 * spawns this process and speaks JSON-RPC over stdin/stdout. Nothing here
 * makes a network call except the AI tools, and only to the provider whose
 * key the user configured.
 */
async function main(): Promise<void> {
  const server = createCreativeServer();
  await server.connect(new StdioServerTransport());
  // Keep the process alive; the MCP SDK handles requests via the transport.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("postward-creative-mcp failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
