/**
 * Exercises the 2026-07-28 protocol era with the official v2 client over real
 * stdio. Set VMCP_SERVER_ENTRY to exercise an installed npm tarball instead of
 * the local build.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as LegacyStdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Database from "better-sqlite3";

const serverEntry = process.env.VMCP_SERVER_ENTRY ?? resolve("dist/index.js");
const expectedTools = [
  "append_if_verified_head",
  "chain",
  "export",
  "read_verified_snapshot",
  "recall",
  "remember",
  "timeline",
  "verify",
].sort();

describe("MCP 2026-07-28 stdio compatibility", () => {
  let tempDir: string | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let legacyClient: LegacyClient | undefined;
  let legacyTransport: LegacyStdioClientTransport | undefined;

  afterEach(async () => {
    try {
      await client?.close();
    } catch {}
    try {
      await transport?.close();
    } catch {}
    try {
      await legacyClient?.close();
    } catch {}
    try {
      await legacyTransport?.close();
    } catch {}
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    client = undefined;
    transport = undefined;
    legacyClient = undefined;
    legacyTransport = undefined;
    tempDir = undefined;
  });

  it("discovers the modern era and executes the same eight tools over real stdio", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vmcp-mcp-modern-"));
    const fakeKeychainPath = join(tempDir, "fake-keychain.json");
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", resolve("test/support/register-fake-keyring.mjs"), serverEntry],
      cwd: process.env.VMCP_SERVER_CWD ?? process.cwd(),
      env: {
        ...process.env,
        VMCP_DATA_DIR: tempDir,
        VMCP_SKIP_STATE_ROOT: "true",
        VMCP_TEST_FAKE_KEYCHAIN_PATH: fakeKeychainPath,
      },
      stderr: "pipe",
    });
    client = new Client(
      { name: "vmcp-modern-compat-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );

    await client.connect(transport);
    expect(client.getProtocolEra()).toBe("modern");

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(expectedTools);

    legacyTransport = new LegacyStdioClientTransport({
      command: process.execPath,
      args: ["--import", resolve("test/support/register-fake-keyring.mjs"), serverEntry],
      cwd: process.env.VMCP_SERVER_CWD ?? process.cwd(),
      env: {
        ...process.env,
        VMCP_DATA_DIR: tempDir,
        VMCP_SKIP_STATE_ROOT: "true",
        VMCP_TEST_FAKE_KEYCHAIN_PATH: join(tempDir, "fake-keychain.json"),
      },
      stderr: "pipe",
    });
    legacyClient = new LegacyClient({ name: "vmcp-legacy-contract-test", version: "1.0.0" });
    await legacyClient.connect(legacyTransport);
    const legacyListed = await legacyClient.listTools();
    const contractProjection = (tool: (typeof listed.tools)[number]) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    });
    expect(legacyListed.tools.map(contractProjection)).toEqual(listed.tools.map(contractProjection));

    const invalidArguments = await client.callTool({
      name: "remember",
      arguments: {},
    });
    expect(invalidArguments.isError).toBe(true);
    expect((invalidArguments.content[0] as { text: string }).text).toContain("Input validation error");

    await expect(
      client.callTool({ name: "unknown_tool", arguments: {} }),
    ).rejects.toThrow(/Tool unknown_tool not found/);

    const emptySnapshot = await client.callTool({
      name: "read_verified_snapshot",
      arguments: {},
    });
    expect(emptySnapshot.isError).toBeFalsy();
    expect(JSON.parse((emptySnapshot.content[0] as { text: string }).text).status).toBe("verified");

    const appended = await client.callTool({
      name: "append_if_verified_head",
      arguments: { expectedHead: null, content: "modern append", tags: ["compat"] },
    });
    expect(appended.isError).toBeFalsy();
    const appendedPayload = JSON.parse((appended.content[0] as { text: string }).text);
    expect(appendedPayload.status).toBe("appended");

    const staleAppend = await client.callTool({
      name: "append_if_verified_head",
      arguments: { expectedHead: null, content: "must not be written" },
    });
    expect(staleAppend.isError).toBe(true);
    const staleAppendPayload = JSON.parse((staleAppend.content[0] as { text: string }).text);
    expect(staleAppendPayload.status).toBe("conflict");

    const afterConflict = await client.callTool({
      name: "read_verified_snapshot",
      arguments: { expectedSnapshotHead: appendedPayload.newHead },
    });
    expect(afterConflict.isError).toBeFalsy();
    const afterConflictPayload = JSON.parse((afterConflict.content[0] as { text: string }).text);
    expect(afterConflictPayload.entries).toHaveLength(1);
    expect(afterConflictPayload.entries[0].content).toBe("modern append");
    expect(afterConflictPayload.ledgerPosition).toBe(appendedPayload.newHead);

    const chain = await client.callTool({ name: "chain", arguments: {} });
    expect(chain.isError).toBeFalsy();
    expect(JSON.parse((chain.content[0] as { text: string }).text).valid).toBe(true);

    const timeline = await client.callTool({ name: "timeline", arguments: { includeContent: true } });
    expect(timeline.isError).toBeFalsy();
    expect(JSON.parse((timeline.content[0] as { text: string }).text).entries).toHaveLength(1);

    const exported = await client.callTool({ name: "export", arguments: {} });
    expect(exported.isError).toBeFalsy();
    expect(JSON.parse((exported.content[0] as { text: string }).text).entries).toHaveLength(1);

    const remembered = await client.callTool({
      name: "remember",
      arguments: { content: "modern era round trip", tags: ["compat", "2026"] },
    });
    expect(remembered.isError).toBeFalsy();
    expect(remembered.content[0]?.type).toBe("text");
    const rememberedPayload = JSON.parse((remembered.content[0] as { text: string }).text);
    expect(rememberedPayload.status).toBe("remembered");

    // Mutate the actual SQLite row after the tool call and verify that the
    // package still reports content tampering over the negotiated modern era.
    const db = new Database(join(tempDir, "memory.db"));
    db.prepare("UPDATE entries SET content = ? WHERE id = ?").run(
      "altered after storage",
      rememberedPayload.id,
    );
    db.close();

    const verified = await client.callTool({
      name: "verify",
      arguments: { id: rememberedPayload.id },
    });
    expect(verified.isError).toBeFalsy();
    const verifiedPayload = JSON.parse((verified.content[0] as { text: string }).text);
    expect(verifiedPayload.valid).toBe(false);
    expect(verifiedPayload.checks.contentIntegrity.passed).toBe(false);

    const recalled = await client.callTool({
      name: "recall",
      arguments: { query: "altered after storage" },
    });
    expect(recalled.isError).toBeFalsy();
    const recalledPayload = JSON.parse((recalled.content[0] as { text: string }).text);
    expect(recalledPayload.entries).toHaveLength(1);
    expect(recalledPayload.entries[0].content).toBe("altered after storage");
    expect(recalledPayload.entries[0].integrity).toBe("content_mismatch");
  });
});
