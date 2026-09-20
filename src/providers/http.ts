import { CreativeError } from "../errors.ts";

export const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** POST JSON, map HTTP failures to sanitized CreativeErrors. Never returns
 * or logs the response body of an error — it stays on the provider side. */
export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  operation: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(provider, err, operation);
  }
  if (!response.ok) {
    const { providerHttpError } = await import("../errors.ts");
    throw providerHttpError(provider, response.status, operation);
  }
  return response;
}

export async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  operation: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(provider, err, operation);
  }
  if (!response.ok) {
    const { providerHttpError } = await import("../errors.ts");
    throw providerHttpError(provider, response.status, operation);
  }
  return response.json() as Promise<unknown>;
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CreativeError("provider_error", "Provider returned a malformed JSON response.");
  }
}

function networkError(provider: string, err: unknown, operation: string): CreativeError {
  if (err instanceof Error && err.name === "TimeoutError") {
    return new CreativeError(
      "provider_timeout",
      `${provider} did not respond in time for ${operation}. Try again, or use a smaller/faster request.`,
    );
  }
  return new CreativeError(
    "provider_unreachable",
    `Could not reach ${provider} for ${operation}. Check your internet connection and try again.`,
  );
}
