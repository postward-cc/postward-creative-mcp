import type { z } from "zod";

/** Uniform shape for every registered tool. The server turns these into
 * MCP tool registrations; `list_tools` reports them from the same source. */
export interface ToolDef {
  name: string;
  description: string;
  /** Full zod object — registered via `.shape` and used to parse handler args. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: z.ZodObject<any>;
  run: (input: never) => Promise<unknown>;
}

/** Type-safe helper so each tool's `run` receives its inferred input type. */
export function defineTool<S extends z.ZodObject<any>>(def: {
  name: string;
  description: string;
  input: S;
  run: (input: z.infer<S>) => Promise<unknown>;
}): ToolDef {
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    run: def.run as (input: never) => Promise<unknown>,
  };
}
