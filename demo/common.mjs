import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DEMO_DIR = env.VMCP_DEMO_DIR || "/tmp/vmcp-agent-demo";

function findServer() {
  const candidates = [join(ROOT, "dist", "index.js"), join(ROOT, "src", "index.ts")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function createClient() {
  const serverPath = findServer();
  if (!serverPath) {
    console.error("Server not found. Run 'npm run build' first.");
    process.exit(1);
  }

  const server = spawn("node", [serverPath], {
    env: { ...env, VMCP_DATA_DIR: DEMO_DIR },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const buf = [];
  server.stderr.on("data", (d) => buf.push(d.toString()));
  function getStderr() { return buf.join("").slice(0, 2000); }

  const pending = new Map();
  let nextId = 1;
  let lineBuf = "";

  server.stdout.on("data", (chunk) => {
    lineBuf += chunk.toString();
    let nl;
    while ((nl = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, nl).trim();
      lineBuf = lineBuf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {}
    }
  });

  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 15_000);
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  function notify(method, params) {
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async function callTool(name, args) {
    const res = await rpc("tools/call", { name, arguments: args });
    if (res.error) {
      throw new Error(`${name} error: ${res.error.message || JSON.stringify(res.error)}`);
    }
    return res.result;
  }

  let initialized = false;

  async function init() {
    if (initialized) return;
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vmcp-demo", version: "0.1.0" },
    });
    notify("notifications/initialized", {});
    initialized = true;
  }

  function close() {
    server.kill();
    pending.clear();
  }

  return { init, callTool, close, getStderr };
}

export { DEMO_DIR };
