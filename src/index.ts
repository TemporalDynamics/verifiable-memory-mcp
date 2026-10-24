#!/usr/bin/env node
import { McpServer, fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { remember } from "./tools/remember.js";
import { recall } from "./tools/recall.js";
import { verify } from "./tools/verify.js";
import { chainData } from "./tools/chain.js";
import { timeline } from "./tools/timeline.js";
import { exportEntries } from "./tools/export.js";
import { appendIfVerifiedHead } from "./tools/append-if-verified-head.js";
import { readVerifiedSnapshotTool } from "./tools/read-verified-snapshot.js";
import { VERSION } from "./version.js";

type ToolName =
  | "remember"
  | "recall"
  | "verify"
  | "chain"
  | "timeline"
  | "export"
  | "append_if_verified_head"
  | "read_verified_snapshot";

interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: JsonSchemaType;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

// Keep the wire-visible JSON Schemas identical to the v1 server contract.
// fromJsonSchema adapts those schemas to the v2 registration API without
// changing tool names, argument names, required fields, or descriptions.
const tools: ToolDefinition[] = [
  {
    name: "remember",
    description: "Store a new memory entry (append-only, tamper-evident)",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content to store" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization",
        },
      },
      required: ["content"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "recall",
    description: "Search stored memories by text content",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "verify",
    description: "Verify that a memory entry has not been tampered with (recalculates hash and compares)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory entry ID to verify" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "chain",
    description: "View the full hash chain of all memory entries for audit",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries (default 100)" },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "timeline",
    description: "List memories in chronological order, optionally filtered by tag",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag" },
        limit: { type: "number", description: "Max results (default 50)" },
        includeContent: {
          type: "boolean",
          description: "Return full content (default false, truncates at 120 chars)",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "export",
    description: "Export memory entries as a portable, verifiable JSON bundle",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Specific entry IDs to export (optional, exports all if omitted)",
        },
        limit: { type: "number", description: "Max entries when exporting all (default 10000)" },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "append_if_verified_head",
    description:
      "Append a new memory entry only if the chain's verified current head matches expectedHead " +
      "(pass null only for a genuinely empty chain). Verifies the full chain and an external " +
      "witness stored outside SQLite before writing, inside one transaction. The witness detects " +
      "rewrites confined to the database file; an attacker controlling the OS keychain or the host " +
      "itself can compromise both. Content and its position in the chain are covered by the hash " +
      "chain; tags are not authenticated and must not be used for security decisions.",
    inputSchema: {
      type: "object",
      properties: {
        expectedHead: {
          type: ["string", "null"],
          description: "The entryHash the caller believes is the current head, or null for an empty chain",
        },
        content: { type: "string", description: "The memory content to store" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization",
        },
      },
      required: ["expectedHead", "content"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "read_verified_snapshot",
    description:
      "Return the full chain, structurally verified against an external witness stored outside " +
      "SQLite, as of one coherent moment. Never writes or repairs anything; fails closed (no entries " +
      "returned) if the chain or the witness do not check out. This snapshot is coherent as of the " +
      "position it reports (ledgerPosition), not a claim about being the state 'as of now' by the " +
      "time a caller acts on it — pass ledgerPosition as expectedHead to append_if_verified_head " +
      "afterward so a write in between is rejected rather than silently overwritten. Returned entries " +
      "include only what the hash chain covers (content, contentHash, prevHash, entryHash, " +
      "createdAt) — tags and entry ids are not part of this projection and are not authenticated.",
    inputSchema: {
      type: "object",
      properties: {
        afterSequence: {
          type: ["number", "null"],
          description: "Optional 0-based sequence index to paginate after. If omitted or null, returns from genesis.",
        },
        limit: {
          type: "number",
          description: "Optional maximum number of entries to return (default 1000, must be positive safe integer).",
        },
        expectedSnapshotHead: {
          type: ["string", "null"],
          description: "Optional expected head entryHash to pin the snapshot. Returns snapshot_conflict if the head changed.",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

async function callTool(name: ToolName, args: Record<string, unknown> = {}) {
  try {
    switch (name) {
      case "remember":
        return remember(args as { content: string; tags?: string[] });
      case "recall":
        return recall(args as { query: string; limit?: number });
      case "verify":
        return verify(args as { id: string });
      case "chain":
        return chainData(args as { limit?: number });
      case "timeline":
        return timeline(args as { tag?: string; limit?: number; includeContent?: boolean });
      case "export":
        return exportEntries(args as { ids?: string[]; limit?: number });
      case "append_if_verified_head":
        return appendIfVerifiedHead(args as { expectedHead: string | null; content: string; tags?: string[] });
      case "read_verified_snapshot":
        return readVerifiedSnapshotTool(args as {
          afterSequence?: number | null;
          limit?: number;
          expectedSnapshotHead?: string | null;
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
}

function createServer() {
  const server = new McpServer(
    { name: "verifiable-memory-mcp", version: VERSION },
    { capabilities: { tools: {} } },
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
        annotations: tool.annotations,
      },
      (args) => callTool(tool.name, args as Record<string, unknown>),
    );
  }

  return server;
}

// This SDK-owned entry point selects a legacy 2025-era instance for old
// initialize clients and a modern 2026-07-28 instance for server/discover
// clients. Both instances register the same eight tool contracts above.
serveStdio(createServer, {
  onerror: (error) => console.error("MCP stdio error:", error),
});
