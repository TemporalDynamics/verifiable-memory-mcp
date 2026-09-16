import { insertEntryIfVerifiedHead } from "../db.js";
import { ToolResponse } from "../types.js";

/**
 * append_if_verified_head — a verified compare-and-swap append. See
 * db.ts:insertEntryIfVerifiedHead for the transactional guarantees. This
 * wrapper only shapes the MCP response; it adds no logic of its own.
 *
 * Never exposes keychain internals or stack traces — only the discriminated
 * ConditionalAppendResult fields.
 */
export function appendIfVerifiedHead(args: {
  expectedHead: string | null;
  content: string;
  tags?: string[];
}): ToolResponse {
  const result = insertEntryIfVerifiedHead(args);

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}
