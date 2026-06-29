import Database from "better-sqlite3";
import { Entry } from "@napi-rs/keyring";
import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";
import { MemoryEntry } from "./types.js";
import { sha256 } from "./hashing.js";

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
