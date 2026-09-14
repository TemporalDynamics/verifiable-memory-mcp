/**
 * Guards the published npm package surface: only what is needed to install
 * and run this package should ever ship. Runs `npm pack --dry-run --json`
 * against the real package.json/files field and asserts on the actual
 * result — never publishes, never writes a tarball to disk.
 *
 * Uses a positive allowlist (what is permitted) rather than a list of
 * forbidden names — an allowlist stays meaningful and safe to read even if
 * this file is ever made public on its own, since it says nothing about
 * what it is guarding against, only what belongs.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every path this package is allowed to ship, and nothing else. Extend this
// list deliberately when a new file genuinely needs to be published — an
// addition here should always be a conscious, reviewed decision.
const ALLOWED_EXACT_FILES = new Set(["LICENSE", "README.md", "package.json"]);
const ALLOWED_PREFIXES = ["dist/"];

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
  "dist/tools/read-verified-snapshot.js",
  "dist/tools/read-verified-snapshot.d.ts",
]);

function packedFilePaths(): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: repoRoot, encoding: "utf-8" });
  const [pkg] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  return pkg.files.map((f) => f.path);
}

function isAllowed(path: string): boolean {
  return ALLOWED_EXACT_FILES.has(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

describe("npm package surface", () => {
  it("ships only files on the explicit allowlist", () => {
    const files = packedFilePaths();
    const unexpected = files.filter((f) => !isAllowed(f));
    expect(unexpected).toEqual([]);
  });

  it("dist/tools/ contains only the known, published MCP tools", () => {
    const files = packedFilePaths();
    const toolFiles = files.filter((f) => f.startsWith("dist/tools/"));
    const unexpected = toolFiles.filter((f) => !ALLOWED_TOOL_FILES.has(f));
    expect(unexpected).toEqual([]);
    // Also catch the allowlist itself going stale (a tool file removed but
    // never taken out of ALLOWED_TOOL_FILES would otherwise pass silently).
    const missing = [...ALLOWED_TOOL_FILES].filter((f) => !toolFiles.includes(f));
    expect(missing).toEqual([]);
  });

  it("no sourcemaps ship (would make dist trivially reversible to annotated source)", () => {
    const files = packedFilePaths();
    expect(files.filter((f) => f.endsWith(".map"))).toEqual([]);
  });

  it("no test, source, or local development files ship", () => {
    const files = packedFilePaths();
    const disallowedPrefixes = ["src/", "test/", "demo/", "docs/", "verifier/", "sandbox/", ".vercel/"];
    const offenders = files.filter((f) => disallowedPrefixes.some((prefix) => f.startsWith(prefix)));
    expect(offenders).toEqual([]);
  });

  it("package.json is not private:true (this package is meant to be published)", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    expect(pkg.private).not.toBe(true);
  });
});
