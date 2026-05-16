export interface MemoryEntry {
  id: string;
  createdAt: string;
  content: string;
  tags: string[];
  contentHash: string;
  prevHash: string | null;
  entryHash: string;
}

export interface VerifyResult {
  id: string;
  valid: boolean;
  storedHash: string;
  computedHash: string;
  reason: string;
}

export interface ExportBundle {
  format: "verifiable-memory-bundle";
  version: "0.1";
  exportedAt: string;
  entries: MemoryEntry[];
}

export type ToolName = "remember" | "recall" | "verify" | "chain" | "timeline" | "export";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type ToolResponse = CallToolResult;
