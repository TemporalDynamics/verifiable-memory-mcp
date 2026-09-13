/**
 * Real cross-process concurrency test for insertEntryIfVerifiedHead.
 *
 * The unit tests in conditional-append.test.ts exercise the CAS logic
 * itself sequentially (Node is single-threaded, so within one process two
 * calls can never truly overlap). This test instead validates the
 * operational claim: that BEGIN IMMEDIATE actually excludes a second,
 * independent OS process from the same write, not just a second call
 * within the same process.
 *
 * Two real child processes are spawned, both racing to append against the
 * same expectedHead over the same SQLite file. Neither touches the real
 * personal OS keychain: each worker process registers a Node module loader
 * (test/support/fake-keyring-loader.mjs) that redirects @napi-rs/keyring to
 * a file-backed fake (test/support/fake-keyring.mjs), so both processes
 * observe the same simulated witness. This redirection happens entirely
 * from the worker's own entry script via node:module's `register()` — no
 * production code path is touched or aware of it; there is no test-only
 * branch inside src/**.
 *
 * Runs against the BUILT dist/db.js (a fresh `npm run build` in beforeAll),
 * so this exercises exactly what would ship, not a TS-transform-time copy.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = join(repoRoot, "test/support/conditional-append-worker.mjs");

interface WorkerResult {
  ok: boolean;
  status: string;
  newHead?: string;
  [key: string]: unknown;
}

function runWorker(dataDir: string, keychainPath: string, expectedHead: string | null, content: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, expectedHead ?? "null", content], {
      env: { ...process.env, VMCP_DATA_DIR: dataDir, VMCP_TEST_FAKE_KEYCHAIN_PATH: keychainPath },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited with code ${code}\nstderr: ${stderr}\nstdout: ${stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`worker produced non-JSON stdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

let dir: string;
let dataDir: string;
let keychainPath: string;

beforeAll(() => {
  // Guarantees the worker processes run the exact code this change made,
  // not a stale prior build.
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
}, 60_000);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vmcp-concurrency-test-"));
  dataDir = join(dir, "data");
  keychainPath = join(dir, "fake-keychain.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function rowCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  const { n } = db.prepare("SELECT COUNT(*) as n FROM entries").get() as { n: number };
  db.close();
  return n;
}

describe("insertEntryIfVerifiedHead — real cross-process concurrency", () => {
  it(
    "two independent OS processes racing on the same expectedHead: exactly one is appended, the loser fails closed " +
      "(conflict, or integrity_failure/witness_mismatch if it lands in the commit-to-witness window), exactly one new " +
      "row exists, and — once both processes have exited and the winner's witness write has settled — the chain and " +
      "witness agree, and a retry with the stale expectedHead deterministically gets a conflict",
    async () => {
      const base = await runWorker(dataDir, keychainPath, null, "base");
      expect(base.ok).toBe(true);

      const [resultA, resultB] = await Promise.all([
        runWorker(dataDir, keychainPath, base.newHead!, "racer A"),
        runWorker(dataDir, keychainPath, base.newHead!, "racer B"),
      ]);

      const outcomes = [resultA, resultB];
      const winners = outcomes.filter((o) => o.ok);
      const losers = outcomes.filter((o) => !o.ok);

      // Exactly one winner — BEGIN IMMEDIATE guarantees at most one writer
      // ever observes a given head as current. Never two.
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);

      // The loser's outcome depends on exactly when it evaluated relative to
      // the winner's SQLite-commit-to-witness-update window (see db.ts's
      // insertEntryIfVerifiedHead docstring): "conflict" if it ran after the
      // window closed, "integrity_failure"/"witness_mismatch" if it ran
      // inside it. Both are safe (nothing written); this test does not
      // depend on scheduling luck by asserting only one of them.
      const loser = losers[0]!;
      const loserOutcomeIsSafe =
        loser.status === "conflict" ||
        (loser.status === "integrity_failure" && loser.integrityStatus === "witness_mismatch");
      expect(loserOutcomeIsSafe, `unexpected loser outcome: ${JSON.stringify(loser)}`).toBe(true);

      const dbPath = join(dataDir, "memory.db");
      // base + exactly one racer — the losing racer wrote nothing, regardless
      // of which of the two safe outcomes it received.
      expect(rowCount(dbPath)).toBe(2);

      // By the time both worker PROCESSES have exited, the winner's own
      // witness-write attempt (synchronous, before it prints its result and
      // exits) has definitely already run — so the window is closed and the
      // system is settled: DB head and witness must agree now.
      const db = new Database(dbPath, { readonly: true });
      const latest = db
        .prepare("SELECT entry_hash FROM entries ORDER BY created_epoch DESC, rowid DESC LIMIT 1")
        .get() as { entry_hash: string };
      db.close();
      expect(latest.entry_hash).toBe(winners[0]!.newHead);

      const witnessStore = JSON.parse(readFileSync(keychainPath, "utf-8")) as Record<string, string>;
      expect(Object.values(witnessStore)).toContain(winners[0]!.newHead);

      // Settled state, verified behaviorally: a retry with the now-stale
      // expectedHead must deterministically get "conflict" — never
      // witness_mismatch (the window is closed) and never a second success.
      const retry = await runWorker(dataDir, keychainPath, base.newHead!, "retry with stale head");
      expect(retry.ok).toBe(false);
      expect(retry.status).toBe("conflict");
      expect(rowCount(dbPath)).toBe(2); // still exactly one additional entry beyond base
    },
    30_000
  );
});
