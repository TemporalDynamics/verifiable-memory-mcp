import { searchEntries, entryCount } from "../db.js";
import { ToolResponse } from "../types.js";

export function recall(args: { query: string; limit?: number }): ToolResponse {
  const limit = args.limit ?? 20;
  const results = searchEntries(args.query, limit);

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
            entries: results.map((e) => ({
              id: e.id,
              createdAt: e.createdAt,
              content: e.content,
              tags: e.tags,
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
