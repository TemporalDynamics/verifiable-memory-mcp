/**
 * `tsc` alone never deletes files it didn't itself just produce — a module
 * removed from src/ can leave its old compiled output sitting in dist/
 * indefinitely, and that stale file would still be picked up by
 * `npm pack`. `npm run build` now runs `npm run clean` (scripts/clean.mjs)
 * first specifically to prevent this. This test proves it, rather than
 * just asserting the scripts exist.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");
const decoyPath = join(distDir, "__build_hygiene_decoy__.js");

describe("build hygiene — dist/ never retains stale files across a build", () => {
  it("a leftover file in dist/ does not survive `npm run build`, and does not reach npm pack", () => {
    mkdirSync(distDir, { recursive: true });
    writeFileSync(decoyPath, "// temporary decoy file, removed by the next build\n");
    expect(existsSync(decoyPath)).toBe(true);

    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });

    expect(existsSync(decoyPath)).toBe(false);

    const packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: repoRoot, encoding: "utf-8" });
    const [pkg] = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
    const paths = pkg.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("__build_hygiene_decoy__"))).toBe(false);
  }, 60_000);
});
