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

const server = new Server(
  { name: "verifiable-memory-mcp", version: "0.1.0" },
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
    },
    {
      name: "timeline",
      description: "List memories in chronological order, optionally filtered by tag",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Filter by tag" },
          limit: { type: "number", description: "Max results (default 50)" },
        },
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
        const { tag, limit } = args as { tag?: string; limit?: number };
        return timeline({ tag, limit });
      }
      case "export": {
        const { ids, limit } = args as { ids?: string[]; limit?: number };
        return exportEntries({ ids, limit });
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
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
