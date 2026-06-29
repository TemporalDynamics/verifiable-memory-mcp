/**
 * Integration tests over the real SQLite layer and the MCP tools.
 *
 * Each test gets a fresh database: VMCP_DATA_DIR points to a new temp dir and
 * vi.resetModules() drops the module-level connection cache in db.ts before
 * the dynamic imports re-evaluate it.
 *
 * Tampering is exercised the way an attacker would do it: a second
 * better-sqlite3 connection writing directly to the file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

let dir: string;
let tools: {
  remember: (a: { content: string; tags?: string[] }) => any;
  recall: (a: { query: string; limit?: number }) => any;
  verify: (a: { id: string }) => any;
  chainData: (a: { limit?: number }) => any;
  timeline: (a: { tag?: string; limit?: number; includeContent?: boolean }) => any;
  exportEntries: (a: { ids?: string[]; limit?: number }) => any;
};
let previousSkipStateRoot: string | undefined;

function parse(res: any): any {
  return JSON.parse(res.content[0].text);
}

function rawDb(): InstanceType<typeof Database> {
  return new Database(join(dir, "memory.db"));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vmcp-test-"));
  previousSkipStateRoot = process.env.VMCP_SKIP_STATE_ROOT;
  process.env.VMCP_DATA_DIR = dir;
  process.env.VMCP_SKIP_STATE_ROOT = "true";
  vi.resetModules();
  const [remember, recall, verify, chain, timeline, exp] = await Promise.all([
    import("../src/tools/remember.js"),
    import("../src/tools/recall.js"),
    import("../src/tools/verify.js"),
    import("../src/tools/chain.js"),
    import("../src/tools/timeline.js"),
    import("../src/tools/export.js"),
  ]);
  tools = {
    remember: remember.remember,
    recall: recall.recall,
    verify: verify.verify,
    chainData: chain.chainData,
    timeline: timeline.timeline,
    exportEntries: exp.exportEntries,
  };
});

afterEach(() => {
  vi.useRealTimers();
  if (previousSkipStateRoot === undefined) {
    delete process.env.VMCP_SKIP_STATE_ROOT;
  } else {
    process.env.VMCP_SKIP_STATE_ROOT = previousSkipStateRoot;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("append and chain linkage", () => {
  it("first entry has prevHash null and verifies clean", () => {
    const r = parse(tools.remember({ content: "primera decisión" }));
    expect(r.status).toBe("remembered");
    expect(r.prevHash).toBeNull();

    const v = parse(tools.verify({ id: r.id }));
    expect(v.valid).toBe(true);
    expect(v.checks.contentIntegrity.passed).toBe(true);
    expect(v.checks.chainIntegrity.passed).toBe(true);
  });

  it("each entry links to the previous one and the full chain validates", () => {
    const ids: string[] = [];
    let prevEntryHash: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r = parse(tools.remember({ content: `entrada ${i}` }));
      expect(r.prevHash).toBe(prevEntryHash);
      prevEntryHash = r.entryHash;
      ids.push(r.id);
    }
    const c = parse(tools.chainData({}));
    expect(c.valid).toBe(true);
    expect(c.totalChecked).toBe(5);
    expect(c.failedAt).toBeNull();
    expect(c.entries.map((e: any) => e.id)).toEqual(ids);
  });

  it("keeps a deterministic, valid chain when entries share the same millisecond", () => {
    vi.useFakeTimers({ now: new Date("2026-06-12T12:00:00.000Z") });
    const a = parse(tools.remember({ content: "misma-ms A" }));
    const b = parse(tools.remember({ content: "misma-ms B" }));
    const c = parse(tools.remember({ content: "misma-ms C" }));

    // Same timestamp for all three; linkage must still follow insertion order.
    expect(b.prevHash).toBe(a.entryHash);
    expect(c.prevHash).toBe(b.entryHash);

    const chain = parse(tools.chainData({}));
    expect(chain.valid).toBe(true);
    expect(chain.entries.map((e: any) => e.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("tamper detection (direct writes to the SQLite file)", () => {
  it("detects an edited content and points at the tampered entry", () => {
    const a = parse(tools.remember({ content: "transferir a cuenta 4471" }));
    const b = parse(tools.remember({ content: "aprobación humana ok" }));

    const db = rawDb();
    db.prepare("UPDATE entries SET content = ? WHERE id = ?")
      .run("transferir a cuenta 8856", a.id);
    db.close();

    const v = parse(tools.verify({ id: a.id }));
    expect(v.valid).toBe(false);
    expect(v.checks.contentIntegrity.passed).toBe(false);

    const c = parse(tools.chainData({}));
    expect(c.valid).toBe(false);
    expect(c.failedAt).toBe(a.id);

    // The untouched entry still verifies on its own.
    expect(parse(tools.verify({ id: b.id })).valid).toBe(true);
  });

  it("detects a deleted entry through the broken link", () => {
    parse(tools.remember({ content: "uno" }));
    const b = parse(tools.remember({ content: "dos" }));
    const c = parse(tools.remember({ content: "tres" }));

    const db = rawDb();
    db.prepare("DELETE FROM entries WHERE id = ?").run(b.id);
    db.close();

    const chain = parse(tools.chainData({}));
    expect(chain.valid).toBe(false);
    expect(chain.failedAt).toBe(c.id); // c.prevHash ya no enlaza con su antecesor
  });

  it("detects reordering even when timestamps are swapped to match", () => {
    const a = parse(tools.remember({ content: "uno" }));
    const b = parse(tools.remember({ content: "dos" }));

    const db = rawDb();
    const rows = db
      .prepare("SELECT id, created_epoch, created_at FROM entries ORDER BY rowid ASC")
      .all() as { id: string; created_epoch: number; created_at: string }[];
    // El atacante intercambia los timestamps para invertir el orden aparente.
    db.prepare("UPDATE entries SET created_epoch = ?, created_at = ? WHERE id = ?")
      .run(rows[1].created_epoch + 1000, rows[1].created_at, rows[0].id);
    db.close();

    const chain = parse(tools.chainData({}));
    expect(chain.valid).toBe(false);
    expect([a.id, b.id]).toContain(chain.failedAt);
  });

  it("detects metadata tampering (createdAt) via the entry hash", () => {
    const a = parse(tools.remember({ content: "con timestamp íntegro" }));

    const db = rawDb();
    db.prepare("UPDATE entries SET created_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", a.id);
    db.close();

    const v = parse(tools.verify({ id: a.id }));
    expect(v.valid).toBe(false);
    expect(v.checks.contentIntegrity.passed).toBe(true); // el contenido no cambió
    expect(v.checks.chainIntegrity.passed).toBe(false); // el sello sí
  });
});

describe("export bundle", () => {
  it("exports a bundle whose every entry re-validates from scratch", async () => {
    for (let i = 0; i < 4; i++) {
      parse(tools.remember({ content: `evento ${i} — ñ ✓`, tags: ["demo"] }));
    }
    const bundle = parse(tools.exportEntries({}));
    expect(bundle.format).toBe("verifiable-memory-bundle");
    expect(bundle.entries).toHaveLength(4);

    const { hashContent, hashEntry, buildEntryCanonical } = await import("../src/hashing.js");
    let prev: string | null = null;
    for (const e of bundle.entries) {
      expect(hashContent(e.content)).toBe(e.contentHash);
      expect(hashEntry(buildEntryCanonical(e.contentHash, e.prevHash, e.createdAt))).toBe(e.entryHash);
      expect(e.prevHash).toBe(prev);
      prev = e.entryHash;
    }
  });
});

describe("timeline tag filter", () => {
  it("matches exact tags and not supersets", () => {
    parse(tools.remember({ content: "x", tags: ["ai"] }));
    parse(tools.remember({ content: "y", tags: ["ai-ops"] }));

    const t = parse(tools.timeline({ tag: "ai" }));
    expect(t.count).toBe(1);
    expect(t.entries[0].tags).toEqual(["ai"]);
  });

  it("does not let % or _ in a tag act as LIKE wildcards", () => {
    parse(tools.remember({ content: "literal", tags: ["100%"] }));
    parse(tools.remember({ content: "wildcard-bait", tags: ["100x"] }));
    parse(tools.remember({ content: "underscore", tags: ["a_b"] }));
    parse(tools.remember({ content: "underscore-bait", tags: ["axb"] }));

    const pct = parse(tools.timeline({ tag: "100%" }));
    expect(pct.count).toBe(1);
    expect(pct.entries[0].tags).toEqual(["100%"]);

    const und = parse(tools.timeline({ tag: "a_b" }));
    expect(und.count).toBe(1);
    expect(und.entries[0].tags).toEqual(["a_b"]);
  });

  it("truncates content at 120 chars unless includeContent", () => {
    const long = "x".repeat(200);
    parse(tools.remember({ content: long, tags: ["long"] }));

    const short = parse(tools.timeline({ tag: "long" }));
    expect(short.entries[0].content).toBe("x".repeat(120) + "...");

    const full = parse(tools.timeline({ tag: "long", includeContent: true }));
    expect(full.entries[0].content).toBe(long);
  });
});

describe("recall", () => {
  it("escapes LIKE wildcards in the query", () => {
    parse(tools.remember({ content: "progreso 100% completado" }));
    parse(tools.remember({ content: "progreso 100x completado" }));

    const r = parse(tools.recall({ query: "100%" }));
    expect(r.count).toBe(1);
    expect(r.entries[0].content).toContain("100%");
  });

  it("finds unicode content", () => {
    parse(tools.remember({ content: "contraparte 中文 firma ✓" }));
    const r = parse(tools.recall({ query: "中文" }));
    expect(r.status).toBe("found");
    expect(r.count).toBe(1);
  });

  it("falls back to word-level search when the exact phrase misses", () => {
    parse(tools.remember({ content: "la transferencia fue aprobada", tags: ["pagos"] }));
    const r = parse(tools.recall({ query: "aprobada transferencia" }));
    expect(r.status).toBe("found");
    expect(r.count).toBe(1);
  });

  it("reports not_found honestly", () => {
    parse(tools.remember({ content: "algo" }));
    const r = parse(tools.recall({ query: "inexistente-zzz" }));
    expect(r.status).toBe("not_found");
    expect(r.count).toBe(0);
  });
});
