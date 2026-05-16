import { randomUUID } from "node:crypto";
import { MemoryEntry, ToolResponse } from "../types.js";
import { hashContent, hashEntry, buildEntryCanonical } from "../hashing.js";
import { insertEntry, getLatestEntry } from "../db.js";

export function remember(args: { content: string; tags?: string[] }): ToolResponse {
  const tags = args.tags ?? [];
  const createdAt = new Date().toISOString();
  const prevEntry = getLatestEntry();
  const prevHash = prevEntry?.entryHash ?? null;
  const contentHash = hashContent(args.content);
  const canonical = buildEntryCanonical(contentHash, prevHash, createdAt);
  const entryHash = hashEntry(canonical);

  const entry: MemoryEntry = {
    id: `mem_${randomUUID().slice(0, 8)}`,
    createdAt,
    content: args.content,
    tags,
    contentHash,
    prevHash,
    entryHash,
  };

  insertEntry(entry);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: "remembered",
            id: entry.id,
            contentHash,
            prevHash,
            entryHash,
            length: args.content.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
