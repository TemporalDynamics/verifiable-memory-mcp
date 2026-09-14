#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { remember } from "./tools/remember.js";
import { recall } from "./tools/recall.js";
import { verify } from "./tools/verify.js";
import { chainData } from "./tools/chain.js";
import { timeline } from "./tools/timeline.js";
import { exportEntries } from "./tools/export.js";
import { appendIfVerifiedHead } from "./tools/append-if-verified-head.js";
import { readVerifiedSnapshotTool } from "./tools/read-verified-snapshot.js";
import { VERSION } from "./version.js";

const server = new Server(
  { name: "verifiable-memory-mcp", version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
          includeContent: { type: "boolean", description: "Return full content (default false, truncates at 120 chars)" },
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
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "remember": {
        const { content, tags } = args as { content: string; tags?: string[] };
        return remember({ content, tags });
      }
      case "recall": {
        const { query, limit } = args as { query: string; limit?: number };
        return recall({ query, limit });
      }
      case "verify": {
        const { id } = args as { id: string };
        return verify({ id });
      }
      case "chain": {
        const { limit } = args as { limit?: number };
        return chainData({ limit });
      }
      case "timeline": {
        const { tag, limit, includeContent } = args as { tag?: string; limit?: number; includeContent?: boolean };
        return timeline({ tag, limit, includeContent });
      }
      case "export": {
        const { ids, limit } = args as { ids?: string[]; limit?: number };
        return exportEntries({ ids, limit });
      }
      case "append_if_verified_head": {
        const { expectedHead, content, tags } = args as {
          expectedHead: string | null;
          content: string;
          tags?: string[];
        };
        return appendIfVerifiedHead({ expectedHead, content, tags });
      }
      case "read_verified_snapshot": {
        return readVerifiedSnapshotTool();
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the stdio server alive for long-lived MCP clients until stdin closes.
  process.stdin.resume();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
