/**
 * Runs ONCE, before any test file loads, in a single process — guarantees
 * src/version.ts exists and dist/ is freshly built before anything (a
 * fresh checkout has neither) without racing any individual test file's
 * own use of dist/. See vitest.config.ts's `fileParallelism: false`: no
 * two test files ever run at the same time in this suite, so a test that
 * itself rebuilds dist/ (test/build-hygiene.test.ts) can never race a test
 * that reads it (test/conditional-append-concurrency.test.ts and others).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export default function setup(): void {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
}
