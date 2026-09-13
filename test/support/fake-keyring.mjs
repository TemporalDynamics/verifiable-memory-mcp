/**
 * TEST ONLY. A file-backed fake for @napi-rs/keyring's Entry class, so that
 * multiple independent OS processes can share the same simulated "OS
 * keychain" state (an in-memory Map, like the seam used elsewhere in this
 * test suite, cannot be shared across process boundaries).
 *
 * Refuses to run unless VMCP_TEST_FAKE_KEYCHAIN_PATH is set (see
 * fake-keyring-loader.mjs) — this is a deliberate guard against this file
 * ever being loaded silently outside an explicit test harness.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STORE_PATH = process.env.VMCP_TEST_FAKE_KEYCHAIN_PATH;
if (!STORE_PATH) {
  throw new Error(
    "fake-keyring.mjs loaded without VMCP_TEST_FAKE_KEYCHAIN_PATH set — refusing to run " +
      "rather than risk ever touching a real keychain silently."
  );
}

function readStore() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(store) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store));
}

export class Entry {
  constructor(service, account) {
    this.key = `${service}:${account}`;
  }

  setPassword(password) {
    const store = readStore();
    store[this.key] = password;
    writeStore(store);
  }

  getPassword() {
    const store = readStore();
    return Object.prototype.hasOwnProperty.call(store, this.key) ? store[this.key] : null;
  }

  deletePassword() {
    const store = readStore();
    if (!(this.key in store)) return false;
    delete store[this.key];
    writeStore(store);
    return true;
  }
}
