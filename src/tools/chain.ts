import { getChain } from "../db.js";
import { hashEntry, hashContent, buildEntryCanonical } from "../hashing.js";
import { ToolResponse, MemoryEntry } from "../types.js";

export function chainData(args: { limit?: number }): ToolResponse {
  const limit = args.limit ?? 100;
  const entries = getChain(limit);

  const validated = validateChain(entries);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: "ok",
            chainLength: entries.length,
            valid: validated.valid,
            totalChecked: validated.checked,
            failedAt: validated.failedAt,
            entries: entries.map((e) => ({
              id: e.id,
              createdAt: e.createdAt,
              contentHash: e.contentHash,
              prevHash: e.prevHash,
              entryHash: e.entryHash,
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

function validateChain(entries: MemoryEntry[]): { valid: boolean; checked: number; failedAt: string | null } {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    const recomputedContentHash = hashContent(entry.content);
    if (recomputedContentHash !== entry.contentHash) {
      return { valid: false, checked: i + 1, failedAt: entry.id };
    }

    const canonical = buildEntryCanonical(entry.contentHash, entry.prevHash, entry.createdAt);
    const recomputedEntryHash = hashEntry(canonical);
    if (recomputedEntryHash !== entry.entryHash) {
      return { valid: false, checked: i + 1, failedAt: entry.id };
    }

    if (i > 0) {
      const prevEntry = entries[i - 1];
      if (entry.prevHash !== prevEntry.entryHash) {
        return { valid: false, checked: i + 1, failedAt: entry.id };
      }
    }
  }

  return { valid: true, checked: entries.length, failedAt: null };
}
