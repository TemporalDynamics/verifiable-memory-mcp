import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Several tests (build-hygiene, package-surface, version-sync,
    // conditional-append-concurrency) read and/or rebuild the shared dist/
    // directory via real `npm run build` / `npm pack` invocations. Vitest
    // runs test FILES in parallel by default — with that on, one file's
    // `rm -rf dist` (mid-rebuild) can race another file's read of dist/,
    // intermittently and unpredictably. Disabling file parallelism makes
    // every test file run strictly one after another: simple, explicit,
    // and correct regardless of which files touch dist/ in the future,
    // rather than relying on knowing exactly which tests to serialize by
    // hand.
    fileParallelism: false,
  },
});
