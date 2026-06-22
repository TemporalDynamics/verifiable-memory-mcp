#!/usr/bin/env node
/**
 * Telegram control bot for the public demo.
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * Optional:
 *   VMCP_DATA_DIR=/tmp/transparent-agent-demo
 *   DEMO_PUBLIC_BASE_URL=http://192.168.1.23:4190
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const DATA_DIR = process.env.VMCP_DATA_DIR ?? "/tmp/transparent-agent-demo";
const PUBLIC_BASE_URL = (process.env.DEMO_PUBLIC_BASE_URL ?? "http://localhost:4190").replace(/\/$/, "");

if (!TOKEN || !CHAT_ID) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before running demo:telegram.");
  process.exit(1);
}

const COMMANDS = {
  "/ready": {
    label: "Reset and seed demo",
    steps: [
      ["bash", ["demo/reset.sh"], [0]],
      [process.execPath, ["demo/setup.mjs"], [0]],
    ],
  },
  "/cycle": {
    label: "Run next agent cycle",
    steps: [[process.execPath, ["demo/agent-loop.mjs", "--once"], [0, 2, 3]]],
  },
  "/owner_update": {
    label: "Owner appends trusted source",
    steps: [[process.execPath, ["demo/authorized-source-update.mjs"], [0]]],
  },
  "/prompt_injection": {
    label: "Record external prompt injection",
    steps: [[process.execPath, ["demo/prompt-injection.mjs"], [0]]],
  },
  "/approve": {
    label: "Approve pending owner request",
    steps: [[process.execPath, ["demo/owner-approve.mjs"], [0, 1]]],
  },
  "/reject": {
    label: "Reject pending owner request",
    steps: [[process.execPath, ["demo/owner-reject.mjs"], [0, 1]]],
  },
  "/tamper": {
    label: "Tamper SQLite directly",
    steps: [["python3", ["demo/tamper.py"], [0]]],
  },
  "/export": {
    label: "Export latest evidence",
    steps: [[process.execPath, ["demo/export.mjs"], [0]]],
  },
};

function apiUrl(method) {
  return `https://api.telegram.org/bot${TOKEN}/${method}`;
}

async function sendMessage(text) {
  await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 3900), disable_web_page_preview: true }),
  });
}

function runStep(command, args, expectedCodes) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, VMCP_DATA_DIR: DATA_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("close", (code) => {
      resolve({
        ok: expectedCodes.includes(code ?? 0),
        code,
        output: output.trim(),
      });
    });
  });
}

async function runCommand(command) {
  const spec = COMMANDS[command];
  if (!spec) return helpText();

  const chunks = [`${spec.label}`, `Sandbox: ${DATA_DIR}`];
  for (const [cmd, args, expected] of spec.steps) {
    const result = await runStep(cmd, args, expected);
    chunks.push(`$ ${cmd} ${args.join(" ")}`);
    chunks.push(result.output || `(exit ${result.code})`);
    if (!result.ok) {
      chunks.push(`Unexpected exit code: ${result.code}`);
      break;
    }
  }
  chunks.push(evidenceLinks());
  return chunks.join("\n\n");
}

function evidenceLinks() {
  const latest = join(ROOT, "demo", "evidence", "latest.json");
  if (!existsSync(latest)) return "No .eco package yet. Run /ready or /cycle.";
  const meta = JSON.parse(readFileSync(latest, "utf-8"));
  return [
    `Latest ECO artifact: ${meta.filename}`,
    `Integrity: ${meta.integrity ?? meta.status}`,
    `Lifecycle: ${meta.lifecycle ?? "SNAPSHOT"}`,
    `Verifier: ${PUBLIC_BASE_URL}/verifier/index.html?eco=/evidence/latest.eco`,
  ].join("\n");
}

function statusText() {
  const statePath = join(ROOT, "demo", "state.json");
  if (!existsSync(statePath)) return "No state yet. Run /ready.";
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  return [
    `Status: ${state.status}`,
    `Memory: ${state.memory}`,
    `Decision: ${state.decision}`,
    `Step: ${state.currentStep}`,
    `Reason: ${state.reason}`,
    "",
    evidenceLinks(),
  ].join("\n");
}

function helpText() {
  return [
    "VMCP demo controls",
    "",
    "/ready - reset sandbox and seed Agent Charter",
    "/cycle - run next agent cycle",
    "/owner_update - append trusted source",
    "/prompt_injection - record external sensitive request",
    "/approve - approve pending request",
    "/reject - reject pending request",
    "/tamper - edit SQLite outside append-only flow",
    "/export - export latest .eco",
    "/eco - show latest .eco verifier link",
    "/evidence - alias for /eco",
    "/status - show current dashboard state",
    "/help - show commands",
  ].join("\n");
}

async function poll() {
  let offset = 0;
  await sendMessage(`VMCP demo bot ready.\n\n${helpText()}`);
  while (true) {
    const res = await fetch(apiUrl("getUpdates"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message"] }),
    });
    const body = await res.json();
    for (const update of body.result ?? []) {
      offset = update.update_id + 1;
      const message = update.message;
      if (!message || String(message.chat.id) !== String(CHAT_ID)) continue;
      const command = String(message.text ?? "").trim().split(/\s+/)[0];
      if (command === "/help" || command === "/start") {
        await sendMessage(helpText());
      } else if (command === "/status") {
        await sendMessage(statusText());
      } else if (["/eco", "/verifier", "/evidence"].includes(command)) {
        await sendMessage(evidenceLinks());
      } else {
        await sendMessage(await runCommand(command));
      }
    }
  }
}

poll().catch((error) => {
  console.error(error);
  process.exit(1);
});
