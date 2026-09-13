/**
 * Guards the published npm package surface. Runs `npm pack --dry-run --json`
 * against the real package.json/.npmignore and asserts on what would
 * actually ship — never publishes, never writes a tarball to disk.
 *
 * Motivation: a private, unpublished fork of this repo once accumulated
 * private-vocabulary modules and MCP tool registrations directly inside
 * tracked/compiled files (never reached npm or GitHub, caught and reverted
 * before publishing — see the private incident this guards against). This
 * test exists so that if anything with that shape is ever reintroduced
 * here, by anyone, it fails CI before a human has to notice by reading a
 * diff.
 *
 * Meaningful primarily AFTER `npm run build` — `dist/` must exist for the
 * dist-side assertions to have anything to check.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Vocabulary that must never appear in a path shipped by this PUBLIC
// package. Deliberately broad (word-boundary, case-insensitive) — the goal
// is a loud false positive on a legitimate future filename over a silent
// miss.
const FORBIDDEN_PATH_VOCAB = [
  /\bepi\b/i,
  /\bmandate\b/i,
  /\bband\b/i,
  /\bcrossing\b/i,
  /\bcustody\b/i,
  /\bapproval\b/i,
  /\bcapability\b/i,
  /semantic.?state/i,
  /\badmission\b/i,
  /\bauthority\b/i,
];

// The only dist/tools/* files this package is allowed to ship. Extend this
// list deliberately when a new PUBLIC tool is added — an addition here
// should always be a conscious decision, not a side effect of some other
// change.
const ALLOWED_TOOL_FILES = new Set([
  "dist/tools/chain.js",
  "dist/tools/chain.d.ts",
  "dist/tools/recall.js",
  "dist/tools/recall.d.ts",
  "dist/tools/remember.js",
  "dist/tools/remember.d.ts",
  "dist/tools/timeline.js",
  "dist/tools/timeline.d.ts",
  "dist/tools/verify.js",
  "dist/tools/verify.d.ts",
  "dist/tools/export.js",
  "dist/tools/export.d.ts",
  "dist/tools/append-if-verified-head.js",
  "dist/tools/append-if-verified-head.d.ts",
]);

function packedFilePaths(): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: repoRoot, encoding: "utf-8" });
  const [pkg] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  return pkg.files.map((f) => f.path);
}

describe("npm package surface", () => {
  it("never packs a path matching private-runtime vocabulary", () => {
    const files = packedFilePaths();
    const offenders = files.filter((f) => FORBIDDEN_PATH_VOCAB.some((pattern) => pattern.test(f)));
    expect(offenders).toEqual([]);
  });

  it("dist/tools/ contains only the known-legitimate public MCP tools", () => {
    const files = packedFilePaths();
    const toolFiles = files.filter((f) => f.startsWith("dist/tools/"));
    const unexpected = toolFiles.filter((f) => !ALLOWED_TOOL_FILES.has(f));
    expect(unexpected).toEqual([]);
  });

  it("no sourcemaps ship (would make dist trivially reversible to annotated source)", () => {
    const files = packedFilePaths();
    expect(files.filter((f) => f.endsWith(".map"))).toEqual([]);
  });

  it("package.json is not private:true (this package is meant to be published)", () => {
    // Read from disk directly, not from the tarball listing (a "files"
    // entry doesn't carry package.json's own content) — this asserts the
    // source of truth npm pack would actually read.
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    expect(pkg.private).not.toBe(true);
  });
});
