import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DEFAULT_DEMO_DIR = "/tmp/vmcp-agent-demo";
const REAL_DATA_DIR = resolve(homedir(), ".verifiable-memory-mcp");
const SERVER_PATH = findServer();

function findServer() {
  const candidates = [join(ROOT, "dist", "index.js"), join(ROOT, "src", "index.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Server not found. Run 'npm run build' first.");
}

export function resolveDemoDataDir(options = {}) {
  const {
    dataDir = env.VMCP_DATA_DIR || env.VMCP_DEMO_DIR || DEFAULT_DEMO_DIR,
    allowRealData = false,
  } = options;
  const resolved = resolve(dataDir);
  if (!allowRealData && resolved === REAL_DATA_DIR) {
    throw new Error(
      `Refusing to use real memory at ${REAL_DATA_DIR}. Set VMCP_DATA_DIR to a sandbox path.`
    );
  }
  return resolved;
}

function createEnvelope(toolCalls, clientName) {
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: clientName, version: "0.1.0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  ];

  let nextId = 2;
  for (const call of toolCalls) {
    requests.push({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name: call.name, arguments: call.arguments ?? {} },
    });
  }

  return requests;
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function runToolBatch(toolCalls, options = {}) {
  const {
    dataDir = resolveDemoDataDir(options),
    clientName = "vmcp-demo",
    timeoutMs = 15_000,
    allowRealData = false,
  } = options;
  const sandboxDir = resolveDemoDataDir({ dataDir, allowRealData });
  const requests = createEnvelope(toolCalls, clientName);

  return new Promise((resolvePromise, rejectPromise) => {
    const payload = `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`;
    const script = `cat <<'__VMCP__' | VMCP_DATA_DIR=${shellEscape(sandboxDir)} node ${shellEscape(SERVER_PATH)}
${payload}__VMCP__`;
    const server = spawn("bash", ["-lc", script], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout = [];
    const stderr = [];
    const responses = new Map();
    let buffer = "";
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      server.kill();
      finish(rejectPromise, new Error(`RPC timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    server.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout.push(text);
      buffer += text;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined) responses.set(message.id, message);
        } catch {
          // Ignore non-JSON lines; stdio transport is expected to stay clean.
        }
      }
    });

    server.stderr.on("data", (chunk) => {
      stderr.push(chunk.toString());
    });
    server.on("error", (error) => finish(rejectPromise, error));

    server.on("close", (code) => {
      const missing = requests.filter((request) => request.id !== undefined && !responses.has(request.id));
      if (code !== 0) {
        finish(
          rejectPromise,
          new Error(
            `MCP server exited with code ${code}. stderr:\n${stderr.join("").slice(0, 4000)}`
          )
        );
        return;
      }
      if (missing.length > 0) {
        finish(
          rejectPromise,
          new Error(
            `Missing ${missing.length} MCP response(s). stdout:\n${stdout.join("").slice(0, 4000)}\n` +
            `stderr:\n${stderr.join("").slice(0, 4000)}`
          )
        );
        return;
      }
      finish(resolvePromise, { responses, stdout: stdout.join(""), stderr: stderr.join(""), dataDir: sandboxDir });
    });

  });
}

export async function callTools(toolCalls, options = {}) {
  const session = await runToolBatch(toolCalls, options);
  const results = [];
  for (let index = 0; index < toolCalls.length; index += 1) {
    const response = session.responses.get(index + 2);
    if (!response) {
      throw new Error(`Missing tool response for ${toolCalls[index].name}`);
    }
    if (response.error) {
      throw new Error(`${toolCalls[index].name} error: ${JSON.stringify(response.error)}`);
    }
    results.push(response.result);
  }
  return { ...session, results };
}

export function textContent(result) {
  return result?.content?.[0]?.text ?? "";
}

export const DEMO_DIR = DEFAULT_DEMO_DIR;
