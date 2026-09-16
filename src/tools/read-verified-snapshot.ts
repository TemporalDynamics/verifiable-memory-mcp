import { readVerifiedSnapshot } from "../db.js";
import { ReadVerifiedSnapshotQuery, ToolResponse } from "../types.js";

/**
 * read_verified_snapshot — a read-only, structurally verified view of the
 * chain. See db.ts:readVerifiedSnapshot for the transactional guarantees
 * and temporal semantics. This wrapper only shapes the MCP response; it
 * adds no logic of its own.
 *
 * Never exposes keychain internals or stack traces — only the discriminated
 * ReadVerifiedSnapshotResult fields.
 */
export function readVerifiedSnapshotTool(query?: ReadVerifiedSnapshotQuery): ToolResponse {
  const result = readVerifiedSnapshot(query);

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}
