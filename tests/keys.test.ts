import { mkdtemp, rm, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  firstConfigured,
  keyHint,
  keysPath,
  loadKeys,
  resolveKey,
  setProviderKey,
  PROVIDERS,
} from "../src/lib/keys.ts";
import { CreativeError } from "../src/errors.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "pcm-keys-"));
  process.env.POSTWARD_CREATIVE_HOME = home;
});

afterEach(async () => {
  delete process.env.POSTWARD_CREATIVE_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("provider keys", () => {
  it("stores a key with 0600 permissions and loads it back", async () => {
    await setProviderKey("fal", "fal-test-key-123456");
    const keys = await loadKeys();
    expect(keys.fal).toBe("fal-test-key-123456");
    const info = await stat(keysPath());
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("keeps other providers when overwriting one key", async () => {
    await setProviderKey("fal", "fal-key-111111111");
    await setProviderKey("openai", "sk-openai-2222222");
    const keys = await loadKeys();
    expect(keys.fal).toBe("fal-key-111111111");
    expect(keys.openai).toBe("sk-openai-2222222");
  });

  it("fails with actionable guidance when a key is missing", async () => {
    try {
      await resolveKey("elevenlabs");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CreativeError);
      const e = err as CreativeError;
      expect(e.code).toBe("provider_key_missing");
      expect(e.message).toContain("set_provider_key");
      expect(e.message).toContain(keysPath());
    }
  });

  it("never reveals the full key in hints", async () => {
    const key = "sk-abcdefghijklmnop";
    const hint = keyHint(key);
    expect(hint).not.toContain("sk-abc");
    expect(hint.endsWith("mnop")).toBe(true);
  });

  it("firstConfigured respects preference order", () => {
    expect(firstConfigured(["fal", "openai"], {})).toBeUndefined();
    expect(firstConfigured(["fal", "openai"], { openai: "sk-x-123456" })).toBe("openai");
    expect(firstConfigured(["fal", "openai"], { fal: "f-123456", openai: "sk-123456" })).toBe("fal");
  });

  it("ignores unknown entries in the keys file instead of crashing", async () => {
    await setProviderKey("fal", "fal-key-123456789");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      keysPath(),
      JSON.stringify({ fal: "fal-key-123456789", "rogue-provider": "x", broken: 42 }),
    );
    const keys = await loadKeys();
    expect(keys.fal).toBe("fal-key-123456789");
    expect(Object.keys(keys)).toEqual(["fal"]);
  });

  it("covers the six supported providers", () => {
    expect(PROVIDERS).toEqual(["fal", "openai", "stability", "elevenlabs", "replicate", "runway"]);
  });
});
