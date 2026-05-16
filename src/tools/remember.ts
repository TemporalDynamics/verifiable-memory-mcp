import { randomUUID } from "node:crypto";
import { ToolResponse } from "../types.js";
import { hashContent, hashEntry, buildEntryCanonical } from "../hashing.js";
import { insertEntryAtomic } from "../db.js";

export function remember(args: { content: string; tags?: string[] }): ToolResponse {
  const tags = args.tags ?? [];
  const id = `mem_${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  const entry = insertEntryAtomic((prevHash) => {
    const contentHash = hashContent(args.content);
    const canonical = buildEntryCanonical(contentHash, prevHash, createdAt);
    const entryHash = hashEntry(canonical);
    return { id, createdAt, content: args.content, tags, contentHash, prevHash, entryHash };
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: "remembered",
            id: entry.id,
            contentHash: entry.contentHash,
            prevHash: entry.prevHash,
            entryHash: entry.entryHash,
            length: args.content.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
