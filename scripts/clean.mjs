/**
 * Removes ONLY dist/, resolved from this script's own location — never from
 * process.cwd() — so this is safe to invoke from anywhere. No globbing, no
 * variable path input.
 */
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");

rmSync(distDir, { recursive: true, force: true });
// stderr, not stdout: some callers (e.g. `npm pack --json`, via the prepack
// lifecycle this script runs under) parse this process's stdout as data.
console.error(`clean: removed ${distDir}`);
