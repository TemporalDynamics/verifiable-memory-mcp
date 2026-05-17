#!/usr/bin/env node
// Example seed script for verifiable-memory-mcp.
// Copy this to seed.mjs and customize your entries.
// seed.mjs is gitignored so you can keep your own data private.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "dist/index.js");

const entries = [
  { content: "My first memory — hello world!", tags: ["example"] },
  { content: "Important note: this is a tamper-evident memory store.", tags: ["example", "note"] },
  { content: "[PROJECT: demo] Add your own project memories here.", tags: ["example", "project"] },
];

console.log(`Seeding ${entries.length} entries...\n`);

for (const entry of entries) {
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "remember", arguments: { content: entry.content, tags: entry.tags } },
  });

  const proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "inherit"] });
  proc.stdin.write(req + "\n");
  proc.stdin.end();

  const out = await new Promise((r) => {
    let data = "";
    proc.stdout.on("data", (c) => { data += c; });
    proc.on("close", () => r(data));
  });

  const parsed = JSON.parse(out);
  const result = JSON.parse(parsed.result?.content?.[0]?.text ?? "{}");
  console.log(`  ✓ ${result.id}  ${entry.content.slice(0, 70)}`);
}

console.log("\nDone. Verify with: node dist/index.js < <(echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"chain\",\"arguments\":{}}}')");
