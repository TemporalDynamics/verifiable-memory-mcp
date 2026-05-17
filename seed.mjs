#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "dist/index.js");

const entries = [
  { content: "[PROJECT: MCP] verifiable-memory-mcp is a public project for local-first tamper-evident memory for AI agents.", tags: ["project", "mcp"] },
  { content: "[RULE: PUBLIC] Do not mention EPI, WIT, LTC, PPA, patent, context_hash, answer_hash, input_hash, privacySealState or forensic accountability in the public README.", tags: ["rule", "ip"] },
  { content: "[PROJECT: ECOSIGN] EcoSign is public and can support reputation, but should not expose private EPI architecture.", tags: ["project", "ecosign"] },
  { content: "[STRATEGY] Public repos should feed reputation, not leak internal architecture.", tags: ["strategy"] },
  { content: "[POSITIONING] The public message is: AI agents do not just need more memory — they need memory they can verify.", tags: ["strategy", "positioning"] },
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
