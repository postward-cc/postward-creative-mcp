/**
 * Machine-readable error codes. Every failure path throws a CreativeError —
 * errors are never swallowed and never silently degrade to a different tool.
 */
export type ErrorCode =
  | "input_invalid"
  | "file_not_found"
  | "execution_failed"
  | "unsupported";

export class CreativeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreativeError";
  }
}

export function toCreativeError(err: unknown): CreativeError {
  if (err instanceof CreativeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CreativeError("execution_failed", message);
}
