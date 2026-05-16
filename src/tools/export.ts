import { getEntriesByIds, getChain } from "../db.js";
import { ToolResponse, ExportBundle } from "../types.js";

export function exportEntries(args: { ids?: string[] }): ToolResponse {
  const entries = args.ids && args.ids.length > 0
    ? getEntriesByIds(args.ids)
    : getChain(1000);

  const bundle: ExportBundle = {
    format: "verifiable-memory-bundle",
    version: "0.1",
    exportedAt: new Date().toISOString(),
    entries,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(bundle, null, 2),
      },
    ],
  };
}
