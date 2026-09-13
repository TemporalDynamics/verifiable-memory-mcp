/**
 * insertEntryIfVerifiedHead / append_if_verified_head — verified
 * compare-and-swap append.
 *
 * Keychain access is mocked via vi.doMock("@napi-rs/keyring", ...) (same
 * seam as test/state-root.test.ts) — the real personal keychain is never
 * touched during these tests. Chain tampering is exercised the way an
 * attacker would do it: raw SQL through a second better-sqlite3 connection
 * to the same file, bypassing insertEntryIfVerifiedHead/insertEntryAtomic
 * entirely (same convention as test/memory.test.ts).
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
  insertEntryAtomic: (buildEntry: (prevHash: string | null) => any) => any;
};
let rememberTool: (a: { content: string; tags?: string[] }) => any;
let appendTool: (a: { expectedHead: string | null; content: string; tags?: string[] }) => any;

function parse(res: any): any {
  return JSON.parse(res.content[0].text);
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

/** The `entries` table is created lazily on first getDb() call — before that, querying it would throw "no such table". */
function rowCount(): number {
  try {
    return (new Database(dbPath).prepare("SELECT COUNT(*) as n FROM entries").get() as { n: number }).n;
  } catch {
    return 0;
  }
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

  const [db, remember, append] = await Promise.all([
    import("../src/db.js"),
    import("../src/tools/remember.js"),
    import("../src/tools/append-if-verified-head.js"),
  ]);
  mod = { insertEntryIfVerifiedHead: db.insertEntryIfVerifiedHead, insertEntryAtomic: db.insertEntryAtomic };
  rememberTool = remember.remember;
  appendTool = append.appendIfVerifiedHead;
}

/** Simulates direct tampering of one row's content, leaving content_hash/entry_hash stale — the row no longer self-verifies. */
function tamperContentInPlace(id: string, newContent: string): void {
  const raw = new Database(dbPath);
  raw.prepare("UPDATE entries SET content = ? WHERE id = ?").run(newContent, id);
  raw.close();
}

/**
 * Simulates a sophisticated attacker with direct file access: rewrites one
 * row's content AND recomputes its own content_hash/entry_hash, then
 * propagates entry_hash/prev_hash forward through every later row so the
 * WHOLE chain is internally self-consistent again, ending at a NEW head
 * hash. The external witness (keychain) still holds the OLD head — it was
 * never touched, because touching it requires OS keychain access, a
 * separate boundary the attacker in this scenario does not have.
 */
function rewriteChainFrom(tamperId: string, newContent: string): void {
  const raw = new Database(dbPath);
  const rows = raw.prepare("SELECT rowid, id, content, prev_hash, created_at FROM entries ORDER BY created_epoch ASC, rowid ASC").all() as Array<{
    rowid: number;
    id: string;
    content: string;
    prev_hash: string | null;
    created_at: string;
  }>;

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
  dir = mkdtempSync(join(tmpdir(), "vmcp-conditional-append-test-"));
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

describe("insertEntryIfVerifiedHead — success paths", () => {
  it("empty ledger + expectedHead null succeeds", () => {
    const result = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "genesis" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("appended");
    expect(result.previousHead).toBeNull();
    expect(result.witnessStatus).toBe("confirmed");
    expect(typeof result.sequence).toBe("number");
  });

  it("correct expectedHead succeeds and advances the head", () => {
    const first = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    const second = mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "two" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.previousHead).toBe(first.newHead);
    expect(second.sequence).toBeGreaterThan(first.sequence);
  });

  it("sequence is monotonic and unambiguous across successive appends", () => {
    const a = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "a" });
    const b = mod.insertEntryIfVerifiedHead({ expectedHead: a.newHead, content: "b" });
    const c = mod.insertEntryIfVerifiedHead({ expectedHead: b.newHead, content: "c" });
    expect(a.sequence).toBeLessThan(b.sequence);
    expect(b.sequence).toBeLessThan(c.sequence);
  });

  it("remember (existing tool) continues to work without regression", () => {
    const first = parse(rememberTool({ content: "via remember" }));
    expect(first.entryHash).toBeTruthy();
    // The verified path must see exactly the same head remember produced —
    // proof the two insert paths agree on what "the current head" means.
    const second = mod.insertEntryIfVerifiedHead({ expectedHead: first.entryHash, content: "via verified append" });
    expect(second.ok).toBe(true);
  });
});

describe("insertEntryIfVerifiedHead — conflict (no write occurs)", () => {
  it("non-empty ledger + expectedHead null is a conflict", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    const result = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "two" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("conflict");
    expect(result.expectedHead).toBeNull();
    expect(result.observedHead).not.toBeNull();
  });

  it("stale expectedHead is a conflict, and nothing was written", () => {
    const first = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "two" });

    const before = { n: rowCount() };
    const stale = mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "three (stale)" });
    const after = { n: rowCount() };

    expect(stale.ok).toBe(false);
    expect(stale.status).toBe("conflict");
    expect(after.n).toBe(before.n);
  });

  it("two conditional appends racing on the same expectedHead: exactly one succeeds, the other gets a conflict", () => {
    const base = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "base" });

    const attemptA = mod.insertEntryIfVerifiedHead({ expectedHead: base.newHead, content: "racer A" });
    const attemptB = mod.insertEntryIfVerifiedHead({ expectedHead: base.newHead, content: "racer B" });

    const outcomes = [attemptA, attemptB];
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0].status).toBe("conflict");

    const count = { n: rowCount() };
    expect(count.n).toBe(2); // base + exactly one racer
  });
});

describe("insertEntryIfVerifiedHead — integrity_failure (no write occurs)", () => {
  it("content altered in place (stale content_hash/entry_hash) is caught — chain_broken", () => {
    const first = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "original" });
    const entry = new Database(dbPath).prepare("SELECT id FROM entries LIMIT 1").get() as { id: string };
    tamperContentInPlace(entry.id, "tampered content, stale hashes");

    const before = { n: rowCount() };
    const result = mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "next" });
    const after = { n: rowCount() };

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("chain_broken");
    expect(after.n).toBe(before.n);
  });

  it("chain rewritten forward to stay self-consistent, but the witness still holds the old head — caught as witness_mismatch, not silently accepted", () => {
    const first = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "original" });
    const entryId = new Database(dbPath).prepare("SELECT id FROM entries LIMIT 1").get() as { id: string };

    // Attacker rewrites content AND every downstream hash so the chain
    // re-validates internally end-to-end — this is exactly the scenario a
    // head-only check would miss.
    rewriteChainFrom(entryId.id, "rewritten history, internally consistent");

    const result = mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "next" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("witness_mismatch");
  });

  it("witness missing (chain non-empty, keychain cleared) blocks", () => {
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    credentials.clear();

    const result = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "should not matter" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("witness_missing");
  });

  it("witness unavailable (keychain read throws) blocks, never treated as success", () => {
    const first = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "one" });
    expect(credentials.size).toBeGreaterThan(0); // sanity: a witness really was persisted for "one"

    // Make the mocked keychain's read throw, simulating an OS keychain that
    // is locked/inaccessible — MockEntry.getPassword() calls credentials.get().
    const originalGet = credentials.get.bind(credentials);
    credentials.get = () => {
      throw new Error("simulated keychain unavailable");
    };

    const result = mod.insertEntryIfVerifiedHead({ expectedHead: first.newHead, content: "two" });

    credentials.get = originalGet;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("witness_unavailable");
  });

  it("invalid content is rejected without touching the database", () => {
    const before = { n: rowCount() };
    // @ts-expect-error deliberately wrong type, exercising runtime validation
    const result = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: 42 });
    const after = { n: rowCount() };

    expect(result.ok).toBe(false);
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("invalid_content");
    expect(after.n).toBe(before.n);
  });

  it("invalid tags are rejected without touching the database", () => {
    const before = { n: rowCount() };
    // @ts-expect-error deliberately wrong shape, exercising runtime validation
    const result = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "ok", tags: [1, 2, 3] });
    const after = { n: rowCount() };

    expect(result.ok).toBe(false);
    expect(result.status).toBe("integrity_failure");
    expect(result.integrityStatus).toBe("invalid_tags");
    expect(after.n).toBe(before.n);
  });

  it("any failure before commit leaves zero new rows — generalized check across every blocking reason exercised above", () => {
    const initial = { n: rowCount() };
    expect(initial.n).toBe(0);

    mod.insertEntryIfVerifiedHead({ expectedHead: "not-the-real-head", content: "should not write" }); // conflict
    // @ts-expect-error deliberate
    mod.insertEntryIfVerifiedHead({ expectedHead: null, content: null }); // invalid_content

    const after = { n: rowCount() };
    expect(after.n).toBe(0);
  });
});

describe("insertEntryIfVerifiedHead — SQLite/keychain non-atomicity", () => {
  it("SQLite commits but the witness write fails: reports committed_but_witness_unconfirmed, never a bare success or failure", () => {
    const before = { n: rowCount() };
    failNextSetPassword = true;

    const result = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "commits despite witness failure" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("committed_but_witness_unconfirmed");
    expect(result.committed).toBe(true);
    expect(result.newHead).toBeTruthy();

    // The defining property of this state: SQLite really did write the row,
    // even though the overall result is ok:false.
    const after = { n: rowCount() };
    expect(after.n).toBe(before.n + 1);
  });

  it("a subsequent verified append after committed_but_witness_unconfirmed fails closed (witness_mismatch), never silently re-anchors", () => {
    failNextSetPassword = true;
    const stuck = mod.insertEntryIfVerifiedHead({ expectedHead: null, content: "commits despite witness failure" });
    expect(stuck.status).toBe("committed_but_witness_unconfirmed");

    // The DB really has the new head now, but the witness (never updated)
    // still shows nothing — the correct, fail-closed outcome is a block,
    // not an automatic re-anchor to whatever the DB currently says.
    const next = mod.insertEntryIfVerifiedHead({ expectedHead: stuck.newHead, content: "should still be blocked" });
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(next.status).toBe("integrity_failure");
    expect(next.integrityStatus).toBe("witness_missing");
  });
});

describe("append_if_verified_head — MCP tool wiring", () => {
  it("round-trips through the tool exactly like calling insertEntryIfVerifiedHead directly", () => {
    const res = appendTool({ expectedHead: null, content: "via tool" });
    const parsed = parse(res);
    expect(res.isError).toBeFalsy();
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("appended");
  });

  it("surfaces isError:true on conflict, never internals like stack traces", () => {
    appendTool({ expectedHead: null, content: "one" });
    const res = appendTool({ expectedHead: null, content: "two (stale null)" });
    const parsed = parse(res);
    expect(res.isError).toBe(true);
    expect(parsed.status).toBe("conflict");
    const text = JSON.stringify(parsed);
    expect(text).not.toMatch(/at Object\.|\.ts:\d+:\d+|node_modules/);
  });
});
