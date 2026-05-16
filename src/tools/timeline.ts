import { getTimeline } from "../db.js";
import { ToolResponse } from "../types.js";

export function timeline(args: { tag?: string; limit?: number }): ToolResponse {
  const limit = args.limit ?? 50;
  const entries = getTimeline(args.tag, limit);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: "ok",
            tag: args.tag ?? null,
            count: entries.length,
            entries: entries.map((e) => ({
              id: e.id,
              createdAt: e.createdAt,
              content: e.content.length > 120 ? e.content.slice(0, 120) + "..." : e.content,
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
