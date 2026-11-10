import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

let dir: string;
let credentials: Map<string, string>;
let stateRootReadUnavailable: boolean;
let previousSkipStateRoot: string | undefined;

let tools: {
  remember: (a: { content: string; tags?: string[] }) => any;
  verify: (a: { id: string }) => any;
};

function parse(res: any): any {
  return JSON.parse(res.content[0].text);
}

async function loadTools(): Promise<void> {
  vi.resetModules();
  vi.doMock("@napi-rs/keyring", () => ({
    Entry: class MockEntry {
      constructor(
        private readonly service: string,
        private readonly username: string
      ) {}

      setPassword(password: string): void {
        credentials.set(this.key(), password);
      }

      getPassword(): string | null {
        if (stateRootReadUnavailable) throw new Error("test keychain read unavailable");
        return credentials.get(this.key()) ?? null;
      }

      deletePassword(): boolean {
        return credentials.delete(this.key());
      }

      private key(): string {
        return `${this.service}:${this.username}`;
      }
    },
  }));

  const [remember, verify] = await Promise.all([
    import("../src/tools/remember.js"),
    import("../src/tools/verify.js"),
  ]);

  tools = {
    remember: remember.remember,
    verify: verify.verify,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vmcp-state-root-test-"));
  credentials = new Map();
  stateRootReadUnavailable = false;
  previousSkipStateRoot = process.env.VMCP_SKIP_STATE_ROOT;
  process.env.VMCP_DATA_DIR = dir;
  delete process.env.VMCP_SKIP_STATE_ROOT;
  await loadTools();
});

afterEach(() => {
  vi.doUnmock("@napi-rs/keyring");
  vi.resetModules();
  if (previousSkipStateRoot === undefined) {
    delete process.env.VMCP_SKIP_STATE_ROOT;
  } else {
    process.env.VMCP_SKIP_STATE_ROOT = previousSkipStateRoot;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("State Root keychain anchor", () => {
  it("stores the latest entry hash outside SQLite and verifies it", () => {
    const first = parse(tools.remember({ content: "genesis" }));
    const second = parse(tools.remember({ content: "next state" }));

    const verified = parse(tools.verify({ id: first.id }));
    expect(verified.valid).toBe(true);
    expect(verified.verificationStatus).toBe("verified");
    expect(verified.stateRootVerified).toBe(true);
    expect(verified.checks.contentIntegrity.passed).toBe(true);
    expect(verified.checks.entryHashIntegrity.passed).toBe(true);
    expect(verified.checks.chainIntegrity).toMatchObject({ passed: true, scope: "entire_chain" });
    expect(verified.checks.stateRoot.status).toBe("verified");
    expect(verified.checks.stateRoot.dbRoot).toBe(second.entryHash);
    expect(verified.checks.stateRoot.keychainRoot).toBe(second.entryHash);
  });

  it("fails verification when SQLite has entries but the keychain root is missing", () => {
    const entry = parse(tools.remember({ content: "anchored state" }));
    credentials.clear();

    const verified = parse(tools.verify({ id: entry.id }));
    expect(verified.valid).toBe(false);
    expect(verified.verificationStatus).toBe("verification_incomplete");
    expect(verified.stateRootVerified).toBe(false);
    expect(verified.checks.chainIntegrity.passed).toBe(true);
    expect(verified.checks.stateRoot.status).toBe("missing");
    expect(verified.summary).toContain("State Root status is missing");
  });

  it("reports a conflicting State Root as an integrity failure", () => {
    const entry = parse(tools.remember({ content: "trusted state" }));
    for (const key of credentials.keys()) {
      credentials.set(key, "deadbeef");
    }

    const verified = parse(tools.verify({ id: entry.id }));
    expect(verified.valid).toBe(false);
    expect(verified.verificationStatus).toBe("integrity_failure");
    expect(verified.stateRootVerified).toBe(false);
    expect(verified.checks.chainIntegrity.passed).toBe(true);
    expect(verified.checks.stateRoot.status).toBe("mismatch");
    expect(verified.checks.stateRoot.dbRoot).toBe(entry.entryHash);
    expect(verified.checks.stateRoot.keychainRoot).toBe("deadbeef");
    expect(verified.summary).toContain("State Root does not match");
  });

  it("keeps a matching witness result separate from a broken entry and chain", () => {
    const entry = parse(tools.remember({ content: "original content" }));
    const db = new Database(join(dir, "memory.db"));
    db.prepare("UPDATE entries SET content = ? WHERE id = ?").run("altered content", entry.id);
    db.close();

    const verified = parse(tools.verify({ id: entry.id }));
    expect(verified.valid).toBe(false);
    expect(verified.verificationStatus).toBe("integrity_failure");
    expect(verified.checks.contentIntegrity.passed).toBe(false);
    expect(verified.checks.entryHashIntegrity.passed).toBe(true);
    expect(verified.checks.chainIntegrity.passed).toBe(false);
    expect(verified.stateRootVerified).toBe(true);
    expect(verified.checks.stateRoot.status).toBe("verified");
  });

  it("reports an unavailable witness as incomplete, not as proven tampering", () => {
    const entry = parse(tools.remember({ content: "state with unreadable witness" }));
    stateRootReadUnavailable = true;

    const verified = parse(tools.verify({ id: entry.id }));
    expect(verified.valid).toBe(false);
    expect(verified.verificationStatus).toBe("verification_incomplete");
    expect(verified.stateRootVerified).toBe(false);
    expect(verified.checks.contentIntegrity.passed).toBe(true);
    expect(verified.checks.entryHashIntegrity.passed).toBe(true);
    expect(verified.checks.chainIntegrity.passed).toBe(true);
    expect(verified.checks.stateRoot).toMatchObject({ passed: false, status: "unavailable" });
    expect(verified.summary).toContain("Verification incomplete");
  });

  it("returns not_found without implying any integrity or witness result", () => {
    const result = parse(tools.verify({ id: "mem_missing" }));
    expect(result).toEqual({ verificationStatus: "not_found", id: "mem_missing" });
  });
});
