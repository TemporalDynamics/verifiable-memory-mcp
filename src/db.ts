import Database from "better-sqlite3";
import { Entry } from "@napi-rs/keyring";
import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { MemoryEntry, ConditionalAppendResult, ConditionalAppendIntegrityStatus } from "./types.js";
import { sha256, hashContent, hashEntry, buildEntryCanonical } from "./hashing.js";

const DB_DIR = process.env.VMCP_DATA_DIR ?? path.join(os.homedir(), ".verifiable-memory-mcp");
const DB_PATH = path.join(DB_DIR, "memory.db");
const SERVICE_NAME = "verifiable-memory-mcp";
const ACCOUNT_NAME = `state-root-${sha256(DB_PATH).slice(0, 16)}`;
const SKIP_STATE_ROOT = "VMCP_SKIP_STATE_ROOT";

let db: Database.Database;
let stateRootUnavailable = false;
const warnedStateRootActions = new Set<string>();

export interface StateRootCheck {
  stateRootVerified: boolean;
  status: "verified" | "missing" | "mismatch" | "skipped" | "unavailable" | "empty";
  dbRoot: string | null;
  keychainRoot: string | null;
  accountName: string;
  message?: string;
}

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    // Generic hygiene, independent of any one caller: without this, a
    // second process contending for the write lock (e.g. two
    // insertEntryIfVerifiedHead callers, see below) gets an immediate
    // SQLITE_BUSY instead of a short, bounded wait.
    db.pragma("busy_timeout = 5000");
    migrate(db);
  }
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      prev_hash TEXT,
      entry_hash TEXT NOT NULL UNIQUE,
      created_epoch INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_tags ON entries(tags);
    CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_epoch);
    CREATE INDEX IF NOT EXISTS idx_entries_content ON entries(content);
  `);
}

export function insertEntryAtomic(buildEntry: (prevHash: string | null) => MemoryEntry): MemoryEntry {
  const database = getDb();
  const insert = database.prepare(`
    INSERT INTO entries (id, created_at, content, tags, content_hash, prev_hash, entry_hash, created_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getLatest = database.prepare(
    "SELECT * FROM entries ORDER BY created_epoch DESC, rowid DESC LIMIT 1"
  );

  const run = database.transaction(() => {
    const latestRow = getLatest.get() as Record<string, unknown> | undefined;
    const prevHash = latestRow ? (latestRow.entry_hash as string) : null;
    const entry = buildEntry(prevHash);
    insert.run(
      entry.id,
      entry.createdAt,
      entry.content,
      JSON.stringify(entry.tags),
      entry.contentHash,
      entry.prevHash,
      entry.entryHash,
      new Date(entry.createdAt).getTime()
    );
    return entry;
  });

  const entry = run();
  persistStateRoot(entry.entryHash);
  return entry;
}

/**
 * insertEntryIfVerifiedHead — a verified, compare-and-swap append.
 *
 * Unlike insertEntryAtomic (which trusts the DB's own last-row pointer),
 * this function re-derives the current head from first principles, inside
 * the SAME write transaction as the insert it may perform:
 *
 *   1. Walk the ENTIRE chain (verifyChainStructurally) recomputing every
 *      row's content_hash/entry_hash and checking prev_hash linkage.
 *      Checking only the head hash would miss a row in the MIDDLE of the
 *      chain whose stored `content` was altered in place while that row's
 *      own content_hash/entry_hash were left untouched — the head hash
 *      would still validate against the (unchanged) latest row's own
 *      fields, silently passing over the tampered row. Full verification is
 *      O(n) in the number of entries; this is a deliberate, documented
 *      trade-off in exchange for not producing exactly that false negative.
 *   2. Compare the freshly re-derived head against the external witness
 *      (OS keychain) — a chain that was tampered with AND fully rewritten
 *      forward to stay internally self-consistent is still caught here,
 *      as long as the witness itself was not also altered.
 *   3. Only then compare `expectedHead` against this verified head.
 *
 * All three steps run inside one `BEGIN IMMEDIATE` transaction (see
 * `.immediate()` below) — the write lock is held from before the first read
 * to after the insert, so no other writer can change what "the current
 * head" means between steps 1-3 and the actual INSERT.
 *
 * THREAT MODEL, stated precisely (do not overstate this elsewhere): the
 * witness is stored outside SQLite and detects rewrites confined to the
 * database file, under the threat model documented here. It is a second,
 * independent surface an attacker must also alter to hide a rewrite — not
 * a claim that doing so is impossible. An attacker with sufficient control
 * of the user account, the OS keychain, or the operating system can
 * compromise both surfaces. This function narrows the class of undetected
 * tampering (a DB-only rewrite); it does not eliminate every attacker
 * capable of controlling the whole host.
 *
 * SQLite and the OS keychain are never one atomic operation (see
 * persistStateRoot/verifyStateRoot above — the existing code already has
 * this same boundary). This function does not pretend otherwise: it
 * reports `committed_but_witness_unconfirmed` rather than silently
 * returning either "appended" or "integrity_failure" when SQLite committed
 * but the keychain update afterward did not.
 *
 * Deliberately does NOT honor VMCP_SKIP_STATE_ROOT (unlike
 * insertEntryAtomic/verifyStateRoot): that flag exists so the existing,
 * less-strict `remember` path keeps working where a keychain isn't
 * available. This function's entire purpose is to be the stricter,
 * verified path — an operator who wants the unverified behavior already
 * has `remember`.
 *
 * WHAT THE HASH CHAIN COVERS, exactly (do not present this as covering
 * every stored field): entry_hash is derived from content_hash, prev_hash,
 * and created_at (see buildEntryCanonical in hashing.ts). `tags`, `id`, and
 * the storage-only `created_epoch`/rowid are NOT part of that derivation —
 * altering them in place is not detected by verifyChainStructurally. `tags`
 * in particular are unauthenticated metadata in this schema (v0.2.1+
 * insertEntryIfVerifiedHead) and must never be used for security or
 * authorization decisions. A caller that needs stronger guarantees over
 * data it considers authoritative should encode that data inside `content`
 * itself, which the hash chain does cover.
 */
export function insertEntryIfVerifiedHead(input: {
  readonly expectedHead: string | null;
  readonly content: string;
  readonly tags?: string[];
}): ConditionalAppendResult {
  const invalid = validateConditionalAppendInput(input.expectedHead, input.content, input.tags);
  if (invalid) {
    return { ok: false, status: "integrity_failure", integrityStatus: invalid, committed: false };
  }
  const tags = input.tags ?? [];
  const database = getDb();

  const insert = database.prepare(`
    INSERT INTO entries (id, created_at, content, tags, content_hash, prev_hash, entry_hash, created_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  interface TxResult {
    entry: MemoryEntry;
    sequence: number;
    previousHead: string | null;
  }

  const txn = database.transaction((): TxResult => {
    const observedHead = verifyChainStructurally(database);

    const witnessFailure = verifyWitnessAgainst(observedHead);
    if (witnessFailure) throw new IntegrityFailureSignal(witnessFailure);

    if (input.expectedHead !== observedHead) {
      throw new ConflictSignal(input.expectedHead, observedHead);
    }

    const id = `mem_${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    const contentHash = hashContent(input.content);
    const canonical = buildEntryCanonical(contentHash, observedHead, createdAt);
    const entryHash = hashEntry(canonical);

    const info = insert.run(
      id,
      createdAt,
      input.content,
      JSON.stringify(tags),
      contentHash,
      observedHead,
      entryHash,
      new Date(createdAt).getTime()
    );

    return {
      entry: { id, createdAt, content: input.content, tags, contentHash, prevHash: observedHead, entryHash },
      sequence: Number(info.lastInsertRowid),
      previousHead: observedHead,
    };
  });

  let txResult: TxResult;
  try {
    txResult = txn.immediate();
  } catch (error) {
    if (error instanceof ConflictSignal) {
      return { ok: false, status: "conflict", expectedHead: error.expectedHead, observedHead: error.observedHead, committed: false };
    }
    if (error instanceof IntegrityFailureSignal) {
      return { ok: false, status: "integrity_failure", integrityStatus: error.integrityStatus, committed: false };
    }
    throw error;
  }

  // SQLite has committed — everything from here on is about confirming that
  // externally, never about whether the write itself happened (it did).
  try {
    stateRootEntry().setPassword(txResult.entry.entryHash);
    stateRootUnavailable = false;
  } catch (error) {
    warnStateRootFailure("write", error);
    return {
      ok: false,
      status: "committed_but_witness_unconfirmed",
      previousHead: txResult.previousHead,
      newHead: txResult.entry.entryHash,
      committed: true,
    };
  }

  return {
    ok: true,
    status: "appended",
    previousHead: txResult.previousHead,
    newHead: txResult.entry.entryHash,
    sequence: txResult.sequence,
    witnessStatus: "confirmed",
  };
}

class ConflictSignal extends Error {
  constructor(
    public readonly expectedHead: string | null,
    public readonly observedHead: string | null
  ) {
    super("conditional_append_conflict");
  }
}

class IntegrityFailureSignal extends Error {
  constructor(public readonly integrityStatus: ConditionalAppendIntegrityStatus) {
    super("conditional_append_integrity_failure");
  }
}

/** Lowercase hex, 64 characters — the exact shape sha256(...).digest("hex") always produces in this codebase. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

function validateConditionalAppendInput(expectedHead: unknown, content: unknown, tags: unknown): ConditionalAppendIntegrityStatus | null {
  if (expectedHead !== null && (typeof expectedHead !== "string" || !SHA256_HEX.test(expectedHead))) {
    return "invalid_expected_head";
  }
  if (typeof content !== "string" || content.length === 0) return "invalid_content";
  if (tags !== undefined) {
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) return "invalid_tags";
  }
  return null;
}

/**
 * Recomputes every entry's content_hash and entry_hash from its own stored
 * fields, and checks prev_hash linkage, from genesis to head — never trusts
 * a cached "latest" pointer. Returns the verified head's entry_hash, or
 * null for a genuinely empty chain. Throws IntegrityFailureSignal("chain_broken")
 * on the first row that doesn't check out.
 */
function verifyChainStructurally(database: Database.Database): string | null {
  const rows = database
    .prepare("SELECT content, content_hash, prev_hash, entry_hash, created_at FROM entries ORDER BY created_epoch ASC, rowid ASC")
    .all() as Array<{
    content: string;
    content_hash: string;
    prev_hash: string | null;
    entry_hash: string;
    created_at: string;
  }>;

  let expectedPrev: string | null = null;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) throw new IntegrityFailureSignal("chain_broken");
    if (hashContent(row.content) !== row.content_hash) throw new IntegrityFailureSignal("chain_broken");
    const recomputedEntryHash = hashEntry(buildEntryCanonical(row.content_hash, row.prev_hash, row.created_at));
    if (recomputedEntryHash !== row.entry_hash) throw new IntegrityFailureSignal("chain_broken");
    expectedPrev = row.entry_hash;
  }
  return expectedPrev;
}

/**
 * Checks the freshly re-derived `observedHead` against the external
 * witness. Returns null when the witness confirms it, or the specific
 * failure reason otherwise. Absence or indeterminacy of the witness is
 * NEVER treated as success — an unreadable keychain blocks exactly like a
 * mismatched one.
 */
function verifyWitnessAgainst(observedHead: string | null): ConditionalAppendIntegrityStatus | null {
  let keychainRoot: string | null;
  try {
    keychainRoot = stateRootEntry().getPassword();
  } catch (error) {
    warnStateRootFailure("read", error);
    return "witness_unavailable";
  }

  if (observedHead === null) {
    // An empty chain with a witness already present is itself suspicious —
    // it implies entries existed and were removed (this codebase never
    // deletes rows) without the witness being cleared to match.
    return keychainRoot !== null ? "witness_unexpected_when_empty" : null;
  }
  if (keychainRoot === null) return "witness_missing";
  if (keychainRoot !== observedHead) return "witness_mismatch";
  return null;
}

export function verifyStateRoot(): StateRootCheck {
  const latest = getLatestEntry();
  const dbRoot = latest?.entryHash ?? null;

  if (isStateRootSkipped()) {
    return {
      stateRootVerified: false,
      status: "skipped",
      dbRoot,
      keychainRoot: null,
      accountName: ACCOUNT_NAME,
      message: `${SKIP_STATE_ROOT}=true; State Root verification skipped`,
    };
  }

  if (!dbRoot) {
    return {
      stateRootVerified: true,
      status: "empty",
      dbRoot,
      keychainRoot: null,
      accountName: ACCOUNT_NAME,
      message: "No entries to compare against a State Root",
    };
  }

  if (stateRootUnavailable) {
    return {
      stateRootVerified: false,
      status: "unavailable",
      dbRoot,
      keychainRoot: null,
      accountName: ACCOUNT_NAME,
      message: "OS keychain is unavailable; continuing without blocking MCP",
    };
  }

  let keychainRoot: string | null;
  try {
    keychainRoot = stateRootEntry().getPassword();
    stateRootUnavailable = false;
  } catch (error) {
    warnStateRootFailure("read", error);
    return {
      stateRootVerified: false,
      status: "unavailable",
      dbRoot,
      keychainRoot: null,
      accountName: ACCOUNT_NAME,
      message: "OS keychain is unavailable; continuing without blocking MCP",
    };
  }

  if (!keychainRoot) {
    return {
      stateRootVerified: false,
      status: "missing",
      dbRoot,
      keychainRoot: null,
      accountName: ACCOUNT_NAME,
      message: "INTEGRITY ERROR: DB has entries but no State Root exists in OS keychain",
    };
  }

  if (keychainRoot !== dbRoot) {
    return {
      stateRootVerified: false,
      status: "mismatch",
      dbRoot,
      keychainRoot,
      accountName: ACCOUNT_NAME,
      message: "TAMPERING DETECTED: DB latest entryHash does not match OS keychain State Root",
    };
  }

  return {
    stateRootVerified: true,
    status: "verified",
    dbRoot,
    keychainRoot,
    accountName: ACCOUNT_NAME,
  };
}

function persistStateRoot(entryHash: string): void {
  if (isStateRootSkipped()) return;

  try {
    stateRootEntry().setPassword(entryHash);
    stateRootUnavailable = false;
  } catch (error) {
    warnStateRootFailure("write", error);
  }
}

function stateRootEntry(): Entry {
  return new Entry(SERVICE_NAME, ACCOUNT_NAME);
}

function isStateRootSkipped(): boolean {
  return process.env[SKIP_STATE_ROOT]?.toLowerCase() === "true";
}

function warnStateRootFailure(action: "read" | "write", error: unknown): void {
  stateRootUnavailable = true;
  if (warnedStateRootActions.has(action)) return;
  warnedStateRootActions.add(action);
  console.warn(
    `[verifiable-memory-mcp] State Root ${action} failed (${formatError(error)}). ` +
      `Continuing without blocking MCP. Set ${SKIP_STATE_ROOT}=true to silence this warning.`
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getEntry(id: string): MemoryEntry | undefined {
  const database = getDb();
  const row = database.prepare("SELECT * FROM entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToEntry(row);
}

export function searchEntries(query: string, limit = 20): MemoryEntry[] {
  const database = getDb();
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  const rows = database.prepare(
    "SELECT * FROM entries WHERE content LIKE ? ESCAPE '\\' ORDER BY created_epoch DESC, rowid DESC LIMIT ?"
  ).all(`%${escaped}%`, limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function searchEntriesFlexible(query: string, limit = 20): MemoryEntry[] {
  const database = getDb();
  const words = query
    .toLowerCase()
    .split(/[\s,;:.!?¿¡()]+/)
    .map(w => w.replace(/[%_\\]/g, "\\$&"))
    .filter(w => w.length > 0);

  if (words.length === 0) return [];

  const conditions = words.flatMap(w => ["content LIKE ? ESCAPE '\\'", "tags LIKE ? ESCAPE '\\'"]);
  const params: string[] = words.flatMap(w => [`%${w}%`, `%${w}%`]);

  const rows = database.prepare(
    `SELECT DISTINCT * FROM entries WHERE ${conditions.join(" OR ")} ORDER BY created_epoch DESC, rowid DESC LIMIT ?`
  ).all(...params, limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getLatestEntry(): MemoryEntry | undefined {
  const database = getDb();
  const row = database.prepare(
    "SELECT * FROM entries ORDER BY created_epoch DESC, rowid DESC LIMIT 1"
  ).get() as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToEntry(row);
}

export function getChain(limit = 100): MemoryEntry[] {
  const database = getDb();
  const rows = database.prepare(
    "SELECT * FROM entries ORDER BY created_epoch ASC, rowid ASC LIMIT ?"
  ).all(limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getTimeline(tag?: string, limit = 50): MemoryEntry[] {
  const database = getDb();
  let rows: Record<string, unknown>[];
  if (tag) {
    const escapedTag = tag.replace(/[%_\\]/g, "\\$&");
    rows = database.prepare(
      "SELECT * FROM entries WHERE tags LIKE ? ESCAPE '\\' ORDER BY created_epoch DESC, rowid DESC LIMIT ?"
    ).all(`%"${escapedTag}"%`, limit) as Record<string, unknown>[];
  } else {
    rows = database.prepare(
      "SELECT * FROM entries ORDER BY created_epoch DESC, rowid DESC LIMIT ?"
    ).all(limit) as Record<string, unknown>[];
  }
  return rows.map(rowToEntry);
}

export function getEntriesByIds(ids: string[]): MemoryEntry[] {
  const database = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = database.prepare(
    `SELECT * FROM entries WHERE id IN (${placeholders}) ORDER BY created_epoch ASC, rowid ASC`
  ).all(...ids) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function entryCount(): number {
  const database = getDb();
  const row = database.prepare("SELECT COUNT(*) as count FROM entries").get() as { count: number };
  return row.count;
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    content: row.content as string,
    tags: JSON.parse(row.tags as string),
    contentHash: row.content_hash as string,
    prevHash: row.prev_hash as string | null,
    entryHash: row.entry_hash as string,
  };
}
