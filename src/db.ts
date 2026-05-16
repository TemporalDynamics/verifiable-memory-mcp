import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import { MemoryEntry } from "./types.js";

const DB_DIR = path.join(os.homedir(), ".verifiable-memory-mcp");
const DB_PATH = path.join(DB_DIR, "memory.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
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

export function insertEntry(entry: MemoryEntry): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO entries (id, created_at, content, tags, content_hash, prev_hash, entry_hash, created_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.id,
    entry.createdAt,
    entry.content,
    JSON.stringify(entry.tags),
    entry.contentHash,
    entry.prevHash,
    entry.entryHash,
    new Date(entry.createdAt).getTime()
  );
}

export function getEntry(id: string): MemoryEntry | undefined {
  const database = getDb();
  const row = database.prepare("SELECT * FROM entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToEntry(row);
}

export function searchEntries(query: string, limit = 20): MemoryEntry[] {
  const database = getDb();
  const rows = database.prepare(
    "SELECT * FROM entries WHERE content LIKE ? ORDER BY created_epoch DESC LIMIT ?"
  ).all(`%${query}%`, limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getLatestEntry(): MemoryEntry | undefined {
  const database = getDb();
  const row = database.prepare(
    "SELECT * FROM entries ORDER BY created_epoch DESC LIMIT 1"
  ).get() as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToEntry(row);
}

export function getChain(limit = 100): MemoryEntry[] {
  const database = getDb();
  const rows = database.prepare(
    "SELECT * FROM entries ORDER BY created_epoch ASC LIMIT ?"
  ).all(limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getTimeline(tag?: string, limit = 50): MemoryEntry[] {
  const database = getDb();
  let rows: Record<string, unknown>[];
  if (tag) {
    rows = database.prepare(
      "SELECT * FROM entries WHERE tags LIKE ? ORDER BY created_epoch DESC LIMIT ?"
    ).all(`%"${tag}"%`, limit) as Record<string, unknown>[];
  } else {
    rows = database.prepare(
      "SELECT * FROM entries ORDER BY created_epoch DESC LIMIT ?"
    ).all(limit) as Record<string, unknown>[];
  }
  return rows.map(rowToEntry);
}

export function getEntriesByIds(ids: string[]): MemoryEntry[] {
  const database = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = database.prepare(
    `SELECT * FROM entries WHERE id IN (${placeholders}) ORDER BY created_epoch ASC`
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
