import { allTools } from "../src/server.ts";

/** Run a registered tool handler directly (bypassing MCP framing). */
export function runTool(name: string, input: unknown): Promise<unknown> {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return (tool.run as (input: unknown) => Promise<unknown>)(input);
}

export function toolDef(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}
