/**
 * Is what consumers installed the same dependency set this repository declares?
 *
 * esbuild bundles every runtime dependency into dist/index.cjs — there are no
 * externals — so the versions in the published binary are the ones frozen at
 * the last release, not the ones in package.json today. That gap is invisible
 * from inside the repository: the tests pass, CI is green, and the registry
 * quietly serves older code than main builds.
 *
 * It is not hypothetical. zod moved from 3 to 4 here while the published
 * package still carried zod 3 inside its binary, for four merges, and nothing
 * said so. The published index.cjs was 787,733 bytes against this
 * repository's 1,403,115.
 *
 * This runs on a schedule rather than in the pull-request gate on purpose: it
 * asks the registry a question, and a gate that depends on a network round trip
 * is a gate that fails for reasons unrelated to the change under review. A
 * drift here is not urgent — the published artifact works, it is just behind —
 * so failing loudly on a schedule is the right weight.
 *
 * Usage: node scripts/check-runtime-deps-published.mjs
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifest = require("../package.json");
const packageName = manifest.name;

function publishedDependencies(version) {
  const raw = execFileSync(
    "npm",
    ["view", `${packageName}@${version}`, "dependencies", "--json"],
    { encoding: "utf8" },
  ).trim();
  return JSON.parse(raw || "{}");
}

function latestPublishedVersion() {
  return execFileSync("npm", ["view", packageName, "version"], { encoding: "utf8" }).trim();
}

const version = latestPublishedVersion();
const published = publishedDependencies(version);
const declared = manifest.dependencies ?? {};

const drift = [];
for (const [name, range] of Object.entries(declared)) {
  if (!(name in published)) drift.push(`${name}: declared ${range} here, absent from ${version}`);
  else if (published[name] !== range) drift.push(`${name}: declared ${range} here, ${published[name]} in ${version}`);
}
for (const name of Object.keys(published)) {
  if (!(name in declared)) drift.push(`${name}: ${published[name]} in ${version}, not declared here`);
}

if (drift.length > 0) {
  console.error(`${packageName}@${version} is published with a different runtime dependency set:`);
  for (const line of drift) console.error(`  ${line}`);
  console.error(
    "\nEverything is bundled into dist/index.cjs, so the published binary runs the versions above\n" +
      "rather than the ones in package.json. Publish a release to close the gap:\n" +
      "  npm version <minor> && git push --follow-tags",
  );
  process.exit(1);
}

console.log(
  `${packageName}@${version} runtime dependencies match package.json: ` +
    Object.entries(declared)
      .map(([name, range]) => `${name}@${range}`)
      .join(", "),
);