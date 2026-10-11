import { searchEntries, searchEntriesFlexible, entryCount } from "../db.js";
import { hashContent, hashEntry, buildEntryCanonical } from "../hashing.js";
import { MemoryEntry, ToolResponse } from "../types.js";

export type RecallIntegrity = "valid" | "content_mismatch" | "hash_mismatch";

/**
 * Per-entry check only: the stored content against its contentHash, and the
 * entryHash against (contentHash, prevHash, createdAt) as stored. It does not
 * detect deleted or reordered entries, nor the state root — use `chain` and
 * `verify` for that. Entries are never filtered out; the caller decides.
 */
function entryIntegrity(e: MemoryEntry): RecallIntegrity {
  if (hashContent(e.content) !== e.contentHash) return "content_mismatch";
  const recomputed = hashEntry(buildEntryCanonical(e.contentHash, e.prevHash, e.createdAt));
  return recomputed === e.entryHash ? "valid" : "hash_mismatch";
}

export function recall(args: { query: string; limit?: number }): ToolResponse {
  const limit = args.limit ?? 20;

  let results = searchEntries(args.query, limit);

  if (results.length === 0) {
    results = searchEntriesFlexible(args.query, limit);
  }

  const entries = results.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    content: e.content,
    tags: e.tags,
    entryHash: e.entryHash,
    integrity: entryIntegrity(e),
  }));
  const compromised = entries.filter((e) => e.integrity !== "valid").length;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: results.length > 0 ? "found" : "not_found",
            query: args.query,
            count: results.length,
            totalEntries: entryCount(),
            compromisedCount: compromised,
            entries,
          },
          null,
          2
        ),
      },
    ],
  };
}
