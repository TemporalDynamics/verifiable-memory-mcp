/**
 * src/index.ts used to hardcode its own MCP server version ("0.1.2")
 * independently of package.json's version. This asserts the two can never
 * diverge again: src/version.ts is generated from package.json by
 * scripts/sync-version.mjs (run by both `build` and `dev`), and index.ts
 * imports VERSION from it rather than declaring a literal.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
}, 60_000);

describe("server version stays in sync with package.json", () => {
  it("dist/version.js's exported VERSION matches package.json's version", async () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    const versionModule = (await import(join(repoRoot, "dist", "version.js"))) as { VERSION: string };
    expect(versionModule.VERSION).toBe(pkg.version);
  });

  it("the built server references VERSION, never an inlined literal semver", () => {
    const distIndex = readFileSync(join(repoRoot, "dist", "index.js"), "utf-8");
    expect(distIndex).toMatch(/version:\s*VERSION\b/);
    expect(distIndex).not.toMatch(/version:\s*["'`]\d+\.\d+\.\d+["'`]/);
  });
});
