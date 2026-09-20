/**
 * Machine-readable error codes. Every failure path throws a CreativeError —
 * errors are never swallowed and never silently degrade to a different tool.
 */
export type ErrorCode =
  | "input_invalid"
  | "file_not_found"
  | "provider_key_missing"
  | "credential_invalid"
  | "provider_rate_limited"
  | "provider_error"
  | "provider_timeout"
  | "provider_unreachable"
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

/**
 * Map an HTTP status from an AI provider to a sanitized error. Provider
 * response bodies are NEVER included — they may contain internal details.
 */
export function providerHttpError(
  provider: string,
  status: number,
  operation: string,
): CreativeError {
  if (status === 401 || status === 403) {
    return new CreativeError(
      "credential_invalid",
      `${provider} rejected the API key (HTTP ${status}) for ${operation}. Check the key with get_provider_status and update it with set_provider_key.`,
    );
  }
  if (status === 402) {
    return new CreativeError(
      "provider_error",
      `${provider} reported an out-of-credits / billing problem (HTTP 402) for ${operation}. Add credits on the provider's dashboard and retry.`,
    );
  }
  if (status === 404) {
    return new CreativeError(
      "provider_error",
      `${provider} returned 404 for ${operation}. The model id may be wrong or no longer available — try another model.`,
    );
  }
  if (status === 429) {
    return new CreativeError(
      "provider_rate_limited",
      `${provider} rate-limited the request (HTTP 429) for ${operation}. Wait and retry.`,
    );
  }
  if (status >= 400 && status < 500) {
    return new CreativeError(
      "input_invalid",
      `${provider} rejected the request (HTTP ${status}) for ${operation}. Check the parameters (size, duration, model).`,
    );
  }
  return new CreativeError(
    "provider_error",
    `${provider} failed with HTTP ${status} for ${operation}. This is on the provider's side — retry later.`,
  );
}
