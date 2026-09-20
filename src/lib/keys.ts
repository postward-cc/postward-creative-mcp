import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CreativeError } from "../errors.ts";

export const PROVIDERS = [
  "fal",
  "openai",
  "stability",
  "elevenlabs",
  "replicate",
  "runway",
] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export type ProviderKeys = Partial<Record<ProviderId, string>>;

/** Config home. Override with POSTWARD_CREATIVE_HOME (used by tests). */
export function configHome(): string {
  return process.env.POSTWARD_CREATIVE_HOME ?? path.join(os.homedir(), ".postward-creative");
}

export function keysPath(): string {
  return path.join(configHome(), "keys.json");
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDERS as readonly string[]).includes(value);
}

export async function loadKeys(): Promise<ProviderKeys> {
  let raw: string;
  try {
    raw = await readFile(keysPath(), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CreativeError(
      "input_invalid",
      `Keys file is not valid JSON: ${keysPath()}. Fix or delete it, then set keys again with set_provider_key.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CreativeError("input_invalid", `Keys file must be a JSON object: ${keysPath()}`);
  }
  const keys: ProviderKeys = {};
  for (const [provider, key] of Object.entries(parsed)) {
    if (!isProviderId(provider)) continue; // ignore unknown entries, never crash on them
    if (typeof key !== "string" || key.length === 0) continue;
    keys[provider] = key;
  }
  return keys;
}

/**
 * Persist one provider key. The directory gets 0700 and the file 0600 —
 * keys never leave this machine.
 */
export async function setProviderKey(provider: ProviderId, key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length < 8) {
    throw new CreativeError("input_invalid", `That does not look like a valid ${provider} API key.`);
  }
  const dir = configHome();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keys = await loadKeys();
  keys[provider] = trimmed;
  const tmpPath = path.join(dir, `.keys-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
  await rename(tmpPath, keysPath());
}

/** Resolve the key for one provider or fail with actionable guidance. */
export async function resolveKey(provider: ProviderId): Promise<string> {
  const keys = await loadKeys();
  const key = keys[provider];
  if (!key) {
    throw new CreativeError(
      "provider_key_missing",
      `No ${provider} key configured. Set it with the set_provider_key tool, or edit ${keysPath()} directly ({"${provider}": "your-key"}).`,
    );
  }
  return key;
}

/** First provider among candidates that has a configured key, in order. */
export function firstConfigured(candidates: readonly ProviderId[], keys: ProviderKeys): ProviderId | undefined {
  return candidates.find((p) => typeof keys[p] === "string" && keys[p]!.length > 0);
}

/** Masked hint, e.g. "…a1b2c3" — never the full key. */
export function keyHint(key: string): string {
  return `…${key.slice(-6)}`;
}
