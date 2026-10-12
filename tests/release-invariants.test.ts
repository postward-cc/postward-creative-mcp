import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Invariants that have to survive every change, checked here rather than
 * remembered. Each one was a real drift that reached the repository and cost
 * a release to undo or a debugging session to find:
 *
 * - The four Node axes disagreed (engines said 22, CI and the image ran 24),
 *   so the package declared support it never exercised and typed itself
 *   against a runtime older than the one it ships in.
 * - The images were renamed from postward-creative-mcp to creative-mcp and
 *   four files kept pulling the path that no longer existed, including the
 *   one that performs the update.
 *
 * These read the repository rather than a manifest someone maintains
 * alongside it: a second source of truth drifts from the first exactly when
 * nobody is looking, which is the failure mode in question.
 */

const ROOT = process.cwd()
const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))

function workflows(): { file: string; body: string }[] {
  const dir = path.join(ROOT, ".github/workflows")
  return readdirSync(dir)
    .filter((file) => file.endsWith(".yml"))
    .map((file) => ({ file, body: readFileSync(path.join(dir, file), "utf8") }))
}

/** Major version only: "^24.0.0" and ">=24" both mean 24, not 2400. */
function major(range: string): number {
  return Number.parseInt(range.replace(/^\D*/, ""), 10)
}

describe("the Node version the repository declares, tests and ships", () => {
  it("agrees across engines, CI, @types/node and the image", () => {
    const engines = manifest.engines?.node
    expect(engines, "package.json must declare engines.node").toBeTruthy()

    const floor = major(engines)
    expect(Number.isNaN(floor), `engines.node is not a version this check can read: ${engines}`).toBe(false)

    // Every workflow that builds on a runtime must build on the same one, and
    // that one must be the floor engines allows. A workflow on a newer runtime
    // tests something no consumer is allowed to run.
    const ciVersions = workflows()
      .map(({ file, body }) => ({ file, version: body.match(/node-version:\s*"?(\d+)"?/)?.[1] }))
      .filter((entry): entry is { file: string; version: string } => Boolean(entry.version))
      .map((entry) => ({ ...entry, version: Number(entry.version) }))

    expect(
      ciVersions.length,
      "no workflow pins node-version; the CI axes have drifted out of existence",
    ).toBeGreaterThan(0)

    for (const { file, version } of ciVersions) {
      expect(
        version,
        `${file} builds on Node ${version} but engines.node allows from ${floor}. Raise the floor, ` +
          "or lower the workflow — the two are the same promise made twice.",
      ).toBe(floor)
    }

    // The image the package ships inside has to match, because the published
    // binary is what the runtime is, for anyone pulling rather than installing.
    //
    // Every Dockerfile in the root, not just the one that publishes. Two
    // auxiliary images — the client smoke and the E2E harness — were still on
    // Node 24 after this repository moved to 26, and this check did not notice,
    // because it only ever read `Dockerfile`. An invariant that covers one file
    // of three is worse than none: it reports agreement.
    const dockerfiles = readdirSync(ROOT).filter(
      (file) => file === "Dockerfile" || file.startsWith("Dockerfile."),
    )
    expect(
      dockerfiles.length,
      "no Dockerfile found in the root — the check below would pass vacuously",
    ).toBeGreaterThan(0)

    for (const file of dockerfiles) {
      const body = readFileSync(path.join(ROOT, file), "utf8")
      const baseVersions = [...body.matchAll(/^FROM node:(\d+)/gm)].map((match) => Number(match[1]))
      expect(baseVersions.length, `${file} has no node base to check`).toBeGreaterThan(0)
      for (const version of baseVersions) {
        expect(
          version,
          `${file} builds on Node ${version} but engines.node allows from ${floor}. The published ` +
            "binary runs on whatever this image carries, and the smoke and E2E images run the same " +
            "tools as everything else.",
        ).toBe(floor)
      }
    }

    // Types track the floor rather than the version being tested: code that
    // type-checks against a newer lib than engines permits compiles clean here
    // and fails on the oldest runtime a consumer is entitled to use.
    const typesVersion = manifest.devDependencies?.["@types/node"]
    expect(typesVersion, "@types/node must be a declared devDependency").toBeTruthy()
    expect(
      major(typesVersion),
      `@types/node is ${typesVersion} but engines.node allows from Node ${floor}. Point the types at ` +
        "the floor so a newer-only API cannot pass the check and break the oldest supported runtime.",
    ).toBe(floor)
  })
})

describe("published artifact names", () => {
  const RETIRED = "ghcr.io/postward-cc/postward-creative-mcp"

  it("never references the image path that was renamed away", () => {
    // The repository is still called postward-creative-mcp, and the clone URL
    // and the npm scope have to keep saying so. What must not come back is the
    // registry path: that image was deleted, and following it is a 404 on
    // `docker pull` rather than anything a test in this repository would catch.
    const files = [
      "AGENTS.md",
      "README.md",
      "Dockerfile",
      ...workflows().map(({ file }) => `.github/workflows/${file}`),
    ]
    const offenders: string[] = []

    for (const file of files) {
      const full = path.join(ROOT, file)
      let body: string
      try {
        body = readFileSync(full, "utf8")
      } catch {
        continue
      }
      body.split("\n").forEach((line, index) => {
        if (line.includes(RETIRED)) offenders.push(`${file}:${index + 1}  ${line.trim()}`)
      })
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These reference the retired image path, which 404s on pull:\n  ${offenders.join("\n  ")}\n\n` +
          "The images are published as creative-mcp and creative-mcp-media. The repository keeps its name.",
    ).toEqual([])
  })

  it("names the images the package actually publishes", () => {
    expect(manifest.name, "the image names follow the npm package name").toBe("@postward-cc/creative-mcp")
  })
})