import { describe, it, expect } from "vitest";
import { sha256, hashContent, hashEntry, buildEntryCanonical } from "../src/hashing.js";

describe("hashing", () => {
  it("sha256 matches the known NIST vector for 'abc'", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashContent is deterministic and utf-8 aware", () => {
    const a = hashContent("decisión — ñ 中文 ✓");
    const b = hashContent("decisión — ñ 中文 ✓");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent("decisión — ñ 中文 ✗")).not.toBe(a);
  });

  it("buildEntryCanonical produces the exact key order the verifier depends on", () => {
    const canonical = buildEntryCanonical("aa", "bb", "2026-06-12T00:00:00.000Z");
    expect(canonical).toBe(
      '{"contentHash":"aa","prevHash":"bb","createdAt":"2026-06-12T00:00:00.000Z"}'
    );
  });

  it("buildEntryCanonical serializes a null prevHash as JSON null (first entry)", () => {
    const canonical = buildEntryCanonical("aa", null, "2026-06-12T00:00:00.000Z");
    expect(canonical).toBe(
      '{"contentHash":"aa","prevHash":null,"createdAt":"2026-06-12T00:00:00.000Z"}'
    );
  });

  it("hashEntry differs when any canonical component changes", () => {
    const base = hashEntry(buildEntryCanonical("aa", "bb", "t1"));
    expect(hashEntry(buildEntryCanonical("ab", "bb", "t1"))).not.toBe(base);
    expect(hashEntry(buildEntryCanonical("aa", "bc", "t1"))).not.toBe(base);
    expect(hashEntry(buildEntryCanonical("aa", "bb", "t2"))).not.toBe(base);
  });
});
