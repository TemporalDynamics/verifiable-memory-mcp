/**
 * readVerifiedSnapshot / read_verified_snapshot — read-only, structurally
 * verified view of the chain.
 *
 * Keychain access is mocked via vi.doMock("@napi-rs/keyring", ...) (same
 * seam as test/state-root.test.ts and test/conditional-append.test.ts) —
 * the real personal keychain is never touched. Chain tampering is
 * exercised the way an attacker would do it: raw SQL through a second
 * better-sqlite3 connection to the same file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";

let dir: string;
let dbPath: string;
let credentials: Map<string, string>;
let failNextSetPassword: boolean;

let mod: {
  insertEntryIfVerifiedHead: (a: { expectedHead: string | null; content: string; tags?: string[] }) => any;
  readVerifiedSnapshot: () => any;
};
let snapshotTool: () => any;

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

async function loadModules(): Promise<void> {
  vi.resetModules();
  vi.doMock("@napi-rs/keyring", () => ({
    Entry: class MockEntry {
      constructor(
        private readonly service: string,
        private readonly username: string
      ) {}

      setPassword(password: string): void {
        if (failNextSetPassword) {
          failNextSetPassword = false;
          throw new Error("simulated keychain write failure");
        }
        credentials.set(this.key(), password);
      }

      getPassword(): string | null {
        return credentials.get(this.key()) ?? null;
      }

      deletePassword(): boolean {
        return credentials.delete(this.key());
      }

      private key(): string {
        return `${this.service}:${this.username}`;
      }
    },
  }));

  const [db, snapshot] = await Promise.all([import("../src/db.js"), import("../src/tools/read-verified-snapshot.js")]);
  mod = { insertEntryIfVerifiedHead: db.insertEntryIfVerifiedHead, readVerifiedSnapshot: db.readVerifiedSnapshot };
  snapshotTool = snapshot.readVerifiedSnapshotTool;
}

/** Simulates direct tampering of one row's content, leaving content_hash/entry_hash stale. */
function tamperContentInPlace(id: string, newContent: string): void {
  const raw = new Database(dbPath);
  raw.prepare("UPDATE entries SET content = ? WHERE id = ?").run(newContent, id);
  raw.close();
}

/** Breaks prev_hash linkage directly, without touching content/entry_hash — the row's own hash still self-verifies, but the chain doesn't connect. */
function breakPrevHashLinkage(id: string): void {
  const raw = new Database(dbPath);
  raw.prepare("UPDATE entries SET prev_hash = ? WHERE id = ?").run("0".repeat(64), id);
  raw.close();
}

/** Rewrites one row's content and every downstream hash so the WHOLE chain is internally self-consistent again, ending at a NEW head — the witness (never touched here) still holds the OLD head. */
function rewriteChainFrom(tamperId: string, newContent: string): void {
  const raw = new Database(dbPath);
  const rows = raw
    .prepare("SELECT rowid, id, content, prev_hash, created_at FROM entries ORDER BY created_epoch ASC, rowid ASC")
    .all() as Array<{ rowid: number; id: string; content: string; prev_hash: string | null; created_at: string }>;

  const idx = rows.findIndex((r) => r.id === tamperId);
  if (idx === -1) throw new Error("row not found");

  let prevHash = rows[idx]!.prev_hash;
  for (let i = idx; i < rows.length; i++) {
    const row = rows[i]!;
    const content = i === idx ? newContent : row.content;
    const contentHash = sha256(content);
    const canonical = JSON.stringify({ contentHash, prevHash, createdAt: row.created_at });
    const entryHash = sha256(canonical);
    raw
      .prepare("UPDATE entries SET content = ?, content_hash = ?, prev_hash = ?, entry_hash = ? WHERE rowid = ?")
      .run(content, contentHash, prevHash, entryHash, row.rowid);
    prevHash = entryHash;
  }
  raw.close();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vmcp-read-verified-snapshot-test-"));
  dbPath = join(dir, "memory.db");
  credentials = new Map();
  failNextSetPassword = false;
  process.env.VMCP_DATA_DIR = dir;
  delete process.env.VMCP_SKIP_STATE_ROOT;
  await loadModules();
});

afterEach(() => {
  vi.doUnmock("@napi-rs/keyring");
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

describe("readVerifiedSnapshot — empty chain", () => {
  it("1. empty chain, no witness: verified/empty_chain, ledgerPosition null", () => {
    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("verified");
    expect(result.ledgerPosition).toBeNull();
    expect(result.entries).toEqual([]);
    expect(result.chainLength).toBe(0);
    expect(result.witnessStatus).toBe("empty_chain");
  });

  it("2. empty chain but a witness is already present: blocks (witness_unexpected_when_empty)", () => {
    // Simulate a witness left behind with no matching entries (this
    // codebase never deletes rows, so this state is itself suspicious).
    // The witness key format depends on the account name derived from
    // DB_PATH, which this test doesn't know ahead of time — seed it via a
    // real append, then wipe only the entries table, leaving the witness.
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "will be wiped" });
    const raw = new Database(dbPath);
    raw.prepare("DELETE FROM entries").run();
    raw.close();

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("witness_unexpected_when_empty");
  });
});

describe("readVerifiedSnapshot — valid chain", () => {
  it("3. valid chain: returns entries genesis -> head, in order", () => {
    const a = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "genesis" });
    const b = mod.insertEntryIfVerifiedHead({ expectedHead: a.newHead, content: "second" });
    mod.insertEntryIfVerifiedHead({ expectedHead: b.newHead, content: "third" });

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((e: any) => e.content)).toEqual(["genesis", "second", "third"]);
    expect(result.chainLength).toBe(3);
  });

  it("4. ledgerPosition matches the last entry's entryHash", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    const last = mod.insertEntryIfVerifiedHead({ expectedHead: mod.readVerifiedSnapshot().ledgerPosition, content: "two" });

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledgerPosition).toBe(last.newHead);
    expect(result.entries[result.entries.length - 1].entryHash).toBe(last.newHead);
  });
});

describe("readVerifiedSnapshot — tampering is caught, never returns partial data", () => {
  it("5. content altered in place: chain_broken, no entries returned", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "original" });
    const row = new Database(dbPath).prepare("SELECT id FROM entries LIMIT 1").get() as { id: string };
    tamperContentInPlace(row.id, "tampered");

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("chain_broken");
    expect((result as any).entries).toBeUndefined();
  });

  it("6. prevHash linkage altered: chain_broken", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    const first = new Database(dbPath).prepare("SELECT id FROM entries ORDER BY rowid ASC LIMIT 1").get() as { id: string };
    const head1 = mod.readVerifiedSnapshot().ledgerPosition;
    mod.insertEntryIfVerifiedHead({ expectedHead: head1, content: "two" });
    breakPrevHashLinkage(first.id);

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.integrityStatus).toBe("chain_broken");
  });

  it("7. history fully rewritten to stay self-consistent, witness still holds the old head: witness_mismatch", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "original" });
    const row = new Database(dbPath).prepare("SELECT id FROM entries LIMIT 1").get() as { id: string };
    rewriteChainFrom(row.id, "rewritten, internally consistent");

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.integrityStatus).toBe("witness_mismatch");
  });

  it("8. witness missing with a non-empty chain: blocks (witness_missing)", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    credentials.clear();

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.integrityStatus).toBe("witness_missing");
  });

  it("9. witness unavailable (keychain read throws): blocks (witness_unavailable)", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    const originalGet = credentials.get.bind(credentials);
    credentials.get = () => {
      throw new Error("simulated keychain unavailable");
    };

    const result = mod.readVerifiedSnapshot();
    credentials.get = originalGet;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.integrityStatus).toBe("witness_unavailable");
  });

  it("10. on any failure, no entries are returned at all (not even a partial/truncated list)", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    credentials.clear();

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "entries")).toBe(false);
  });
});

describe("readVerifiedSnapshot — projection excludes unauthenticated fields", () => {
  it("11. tags, id, and created_epoch/rowid never appear on a VerifiedEntry", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "has tags", tags: ["a", "b"] });

    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.entries[0];
    expect(Object.keys(entry).sort()).toEqual(["content", "contentHash", "createdAt", "entryHash", "prevHash"].sort());
    expect(entry.tags).toBeUndefined();
    expect(entry.id).toBeUndefined();
    expect((entry as any).created_epoch).toBeUndefined();
    expect((entry as any).rowid).toBeUndefined();
  });
});

describe("readVerifiedSnapshot + append_if_verified_head — intended usage pattern", () => {
  it("12. a snapshot's ledgerPosition (P0), a concurrent append (P1), then a CAS with the stale P0: conflict", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "base" });
    const snapshot0 = mod.readVerifiedSnapshot();
    expect(snapshot0.ok).toBe(true);
    const p0 = snapshot0.ledgerPosition;

    // A "concurrent" write lands, advancing the head to P1.
    mod.insertEntryIfVerifiedHead({ expectedHead: p0, content: "advances to P1" });

    // A caller still holding the stale P0 tries to CAS against it.
    const stale = mod.insertEntryIfVerifiedHead({ expectedHead: p0, content: "should not land" });
    expect(stale.ok).toBe(false);
    expect(stale.status).toBe("conflict");
  });

  it("13. a snapshot read while stuck in the SQLite-commit-to-witness window fails closed", () => {
    failNextSetPassword = true;
    const stuck = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "commits despite witness failure" });
    expect(stuck.status).toBe("committed_but_witness_unconfirmed");

    // DB really has the new entry; the witness was never updated — a
    // snapshot read here must fail closed, not report a false "verified".
    const result = mod.readVerifiedSnapshot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.integrityStatus).toBe("witness_missing");
  });
});

describe("readVerifiedSnapshot — no regression to append_if_verified_head", () => {
  it("14. a normal CAS append still works exactly as before, after the shared-verification refactor", () => {
    const first = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    expect(first.ok).toBe(true);
    const second = mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "two" });
    expect(second.ok).toBe(true);
    expect(second.previousHead).toBe(first.newHead);
  });
});

describe("read_verified_snapshot — MCP tool wiring", () => {
  it("15. the tool never exposes stack traces or keychain internals, on success or failure", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });

    const ok = snapshotTool();
    const okText = JSON.stringify(JSON.parse(ok.content[0].text));
    expect(ok.isError).toBeFalsy();
    expect(okText).not.toMatch(/at Object\.|\.ts:\d+:\d+|node_modules|Entry\(|getPassword|setPassword/);

    credentials.clear();
    const failed = snapshotTool();
    const failedText = JSON.stringify(JSON.parse(failed.content[0].text));
    expect(failed.isError).toBe(true);
    expect(failedText).not.toMatch(/at Object\.|\.ts:\d+:\d+|node_modules|Entry\(|getPassword|setPassword/);
  });
});
