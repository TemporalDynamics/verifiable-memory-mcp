import { getEntry } from "../db.js";
import { hashContent, hashEntry, buildEntryCanonical } from "../hashing.js";
import { ToolResponse } from "../types.js";

export function verify(args: { id: string }): ToolResponse {
  const entry = getEntry(args.id);
  if (!entry) {
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "not_found", id: args.id }, null, 2) }],
    };
  }

  const recomputedContentHash = hashContent(entry.content);
  const contentValid = recomputedContentHash === entry.contentHash;

  const recomputedCanonical = buildEntryCanonical(entry.contentHash, entry.prevHash, entry.createdAt);
  const recomputedEntryHash = hashEntry(recomputedCanonical);
  const chainValid = recomputedEntryHash === entry.entryHash;

  const allOk = contentValid && chainValid;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: entry.id,
            valid: allOk,
            createdAt: entry.createdAt,
            checks: {
              contentIntegrity: {
                passed: contentValid,
                stored: entry.contentHash,
                computed: recomputedContentHash,
              },
              chainIntegrity: {
                passed: chainValid,
                stored: entry.entryHash,
                computed: recomputedEntryHash,
              },
            },
            summary: allOk
              ? "Entry is intact and chain-verified"
              : "Entry has been tampered with",
          },
          null,
          2
        ),
      },
    ],
  };
}
