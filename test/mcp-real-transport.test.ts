/**
 * Real MCP stdio transport test.
 *
 * Spawns the BUILT dist/index.js as a genuine separate process over real stdio MCP,
 * using Client and StdioClientTransport from @modelcontextprotocol/sdk.
 *
 * Uses register-fake-keyring.mjs so that the real personal OS keychain is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const registerFakeKeyring = join(repoRoot, "test/support/register-fake-keyring.mjs");
const serverScript = join(repoRoot, "dist/index.js");

let tempDir: string;
let fakeKeychainPath: string;
let client: Client;
let transport: StdioClientTransport;

function parseText(result: any): any {
  expect(result.content).toBeDefined();
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text);
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "vmcp-mcp-transport-test-"));
  fakeKeychainPath = join(tempDir, "fake-keychain.json");

  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", registerFakeKeyring, serverScript],
    env: {
      ...process.env,
      VMCP_DATA_DIR: tempDir,
      VMCP_TEST_FAKE_KEYCHAIN_PATH: fakeKeychainPath,
    },
  });

  client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
});

afterEach(async () => {
  try {
    await client.close();
  } catch {}
  try {
    await transport.close();
  } catch {}
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Real MCP stdio transport — full protocol verification", () => {
  it("advertises all 8 tools with correct schemas over MCP protocol", async () => {
    const list = await client.listTools();
    const toolNames = list.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      "append_if_verified_head",
      "chain",
      "export",
      "read_verified_snapshot",
      "recall",
      "remember",
      "timeline",
      "verify",
    ].sort());

    const snapshotTool = list.tools.find((t) => t.name === "read_verified_snapshot");
    expect(snapshotTool).toBeDefined();
    expect(snapshotTool?.inputSchema.properties).toHaveProperty("afterSequence");
    expect(snapshotTool?.inputSchema.properties).toHaveProperty("limit");
    expect(snapshotTool?.inputSchema.properties).toHaveProperty("expectedSnapshotHead");

    const appendTool = list.tools.find((t) => t.name === "append_if_verified_head");
    expect(appendTool).toBeDefined();
    expect(appendTool?.inputSchema.properties).toHaveProperty("expectedHead");
    expect(appendTool?.inputSchema.properties).toHaveProperty("content");
    expect(appendTool?.inputSchema.properties).toHaveProperty("tags");
  });

  it("executes read_verified_snapshot, append_if_verified_head, CAS conflicts, and pagination over stdio transport", async () => {
    // 1. Initial snapshot on empty ledger
    const initialRaw = await client.callTool({ name: "read_verified_snapshot", arguments: {} });
    const initial = parseText(initialRaw);
    expect(initialRaw.isError).toBeFalsy();
    expect(initial.ok).toBe(true);
    expect(initial.status).toBe("verified");
    expect(initial.historyId).toBeNull();
    expect(initial.ledgerPosition).toBeNull();
    expect(initial.entries).toEqual([]);
    expect(initial.chainLength).toBe(0);

    // 2. Genesis append
    const append1Raw = await client.callTool({
      name: "append_if_verified_head",
      arguments: { expectedHead: null, content: "first entry via MCP stdio" },
    });
    const append1 = parseText(append1Raw);
    expect(append1Raw.isError).toBeFalsy();
    expect(append1.ok).toBe(true);
    expect(append1.status).toBe("appended");
    expect(append1.sequence).toBe(0);
    expect(append1.previousHead).toBeNull();
    expect(append1.newHead).toMatch(/^[0-9a-f]{64}$/);

    const head1 = append1.newHead;

    // 3. Stale CAS append attempt produces conflict
    const staleRaw = await client.callTool({
      name: "append_if_verified_head",
      arguments: { expectedHead: null, content: "stale genesis append" },
    });
    const stale = parseText(staleRaw);
    expect(staleRaw.isError).toBe(true);
    expect(stale.ok).toBe(false);
    expect(stale.status).toBe("conflict");
    expect(stale.expectedHead).toBeNull();
    expect(stale.observedHead).toBe(head1);

    // 4. Second append advancing to head2
    const append2Raw = await client.callTool({
      name: "append_if_verified_head",
      arguments: { expectedHead: head1, content: "second entry via MCP stdio" },
    });
    const append2 = parseText(append2Raw);
    expect(append2.ok).toBe(true);
    expect(append2.sequence).toBe(1);
    expect(append2.previousHead).toBe(head1);
    const head2 = append2.newHead;

    // 5. Third append advancing to head3
    const append3Raw = await client.callTool({
      name: "append_if_verified_head",
      arguments: { expectedHead: head2, content: "third entry via MCP stdio" },
    });
    const append3 = parseText(append3Raw);
    expect(append3.ok).toBe(true);
    expect(append3.sequence).toBe(2);
    const head3 = append3.newHead;

    // 6. Paginated read page 1
    const p1Raw = await client.callTool({
      name: "read_verified_snapshot",
      arguments: { limit: 2, expectedSnapshotHead: head3 },
    });
    const p1 = parseText(p1Raw);
    expect(p1.ok).toBe(true);
    expect(p1.historyId).toBe(head1);
    expect(p1.ledgerPosition).toBe(head3);
    expect(p1.chainLength).toBe(3);
    expect(p1.entries.length).toBe(2);
    expect(p1.entries[0].sequence).toBe(0);
    expect(p1.entries[1].sequence).toBe(1);
    expect(p1.nextSequence).toBe(1);

    // 7. Paginated read page 2
    const p2Raw = await client.callTool({
      name: "read_verified_snapshot",
      arguments: { afterSequence: p1.nextSequence, limit: 2, expectedSnapshotHead: head3 },
    });
    const p2 = parseText(p2Raw);
    expect(p2.ok).toBe(true);
    expect(p2.entries.length).toBe(1);
    expect(p2.entries[0].sequence).toBe(2);
    expect(p2.nextSequence).toBeNull();

    // 8. Snapshot conflict when pinning to stale snapshot head
    const conflictRaw = await client.callTool({
      name: "read_verified_snapshot",
      arguments: { expectedSnapshotHead: head1 },
    });
    const conflict = parseText(conflictRaw);
    expect(conflictRaw.isError).toBe(true);
    expect(conflict.ok).toBe(false);
    expect(conflict.status).toBe("snapshot_conflict");
    expect(conflict.expectedSnapshotHead).toBe(head1);
    expect(conflict.observedHead).toBe(head3);

    // 9. Snapshot conflict when pinning expectedSnapshotHead: null on non-empty ledger
    const nullConflictRaw = await client.callTool({
      name: "read_verified_snapshot",
      arguments: { expectedSnapshotHead: null },
    });
    const nullConflict = parseText(nullConflictRaw);
    expect(nullConflictRaw.isError).toBe(true);
    expect(nullConflict.ok).toBe(false);
    expect(nullConflict.status).toBe("snapshot_conflict");
    expect(nullConflict.expectedSnapshotHead).toBeNull();
    expect(nullConflict.observedHead).toBe(head3);
  });

  it("maintains compatibility of all six pre-existing public tools over stdio transport", async () => {
    // 1. remember
    const rememberRaw = await client.callTool({
      name: "remember",
      arguments: { content: "historical note", tags: ["archive", "test"] },
    });
    const rem = parseText(rememberRaw);
    expect(rememberRaw.isError).toBeFalsy();
    expect(rem.status).toBe("remembered");
    expect(rem.id).toMatch(/^mem_/);
    const id = rem.id;

    // 2. recall
    const recallRaw = await client.callTool({
      name: "recall",
      arguments: { query: "historical", limit: 5 },
    });
    const rec = parseText(recallRaw);
    expect(recallRaw.isError).toBeFalsy();
    expect(rec.status).toBe("found");
    expect(rec.entries.length).toBeGreaterThanOrEqual(1);

    // 3. verify
    const verifyRaw = await client.callTool({
      name: "verify",
      arguments: { id },
    });
    const ver = parseText(verifyRaw);
    expect(verifyRaw.isError).toBeFalsy();
    expect(ver.valid).toBe(true);

    // 4. chain
    const chainRaw = await client.callTool({
      name: "chain",
      arguments: { limit: 10 },
    });
    const ch = parseText(chainRaw);
    expect(chainRaw.isError).toBeFalsy();
    expect(ch.valid).toBe(true);
    expect(ch.entries.length).toBeGreaterThanOrEqual(1);

    // 5. timeline
    const timelineRaw = await client.callTool({
      name: "timeline",
      arguments: { limit: 10, includeContent: true },
    });
    const tl = parseText(timelineRaw);
    expect(timelineRaw.isError).toBeFalsy();
    expect(tl.entries.length).toBeGreaterThanOrEqual(1);

    // 6. export
    const exportRaw = await client.callTool({
      name: "export",
      arguments: { limit: 10 },
    });
    const exp = parseText(exportRaw);
    expect(exportRaw.isError).toBeFalsy();
    expect(exp.format).toBe("verifiable-memory-bundle");
    expect(exp.entries.length).toBeGreaterThanOrEqual(1);
  });
});
