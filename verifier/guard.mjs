#!/usr/bin/env node
/**
 * guard.mjs — fail-closed pre-action gate.
 *
 * Verifies the full memory chain BEFORE an agent acts. If the chain does not
 * validate, it refuses, loudly, with a non-zero exit code — so any wrapper
 * (shell script, agent loop, CI step) can make "verified context" a hard
 * precondition for action:
 *
 *   node verifier/guard.mjs && ./do-the-consequential-thing.sh
 *
 * Honest scope: this gate detects alteration of the recorded context; it does
 * not validate that the content is correct, and it cannot stop an attacker
 * who controls this machine from bypassing the gate itself. It turns silent
 * tampering into a visible, machine-readable refusal.
 *
 * Env: VMCP_DATA_DIR selects the database (defaults to ~/.verifiable-memory-mcp).
 * Exit codes: 0 = chain verified · 2 = integrity failure (refuse) · 1 = error.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function rpcOnce(requests) {
  return new Promise((resolve, reject) => {
    const server = spawn("node", [join(ROOT, "dist", "index.js")], {
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const responses = new Map();
    let buf = "";
    server.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) responses.set(msg.id, msg);
        } catch { /* not JSON */ }
        if (responses.size >= requests.filter((r) => r.id !== undefined).length) {
          server.kill();
          resolve(responses);
          return;
        }
      }
    });
    server.on("error", reject);
    setTimeout(() => { server.kill(); reject(new Error("timeout talking to MCP server")); }, 15_000);
    for (const r of requests) server.stdin.write(JSON.stringify(r) + "\n");
  });
}

const responses = await rpcOnce([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "guard", version: "0.1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "chain", arguments: {} } },
]).catch((err) => {
  console.error(`GUARD ERROR: ${err.message}`);
  process.exit(1);
});

const res = responses.get(2);
if (!res || res.error) {
  console.error(`GUARD ERROR: chain call failed: ${JSON.stringify(res?.error ?? "no response")}`);
  process.exit(1);
}

const chain = JSON.parse(res.result.content[0].text);

if (chain.valid) {
  console.log(`✔ CONTEXT VERIFIED — ${chain.totalChecked}/${chain.totalEntries} entries, chain intact.`);
  console.log("  Proceeding is allowed.");
  process.exit(0);
} else {
  console.error(`✗ REFUSING TO ACT — memory integrity check FAILED at entry ${chain.failedAt}.`);
  console.error(`  Checked ${chain.totalChecked} entries; the recorded context can no longer be trusted.`);
  console.error("  This agent does not act on context it cannot verify. Halting.");
  process.exit(2);
}
