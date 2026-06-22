import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

async function callLocalTool(name, args = {}) {
  process.env.VMCP_DATA_DIR = process.env.VMCP_DATA_DIR || DEFAULT_DEMO_DIR;
  switch (name) {
    case "remember": {
      const { remember } = await import(pathToFileURL(join(ROOT, "dist", "tools", "remember.js")));
      return remember(args);
    }
    case "recall": {
      const { recall } = await import(pathToFileURL(join(ROOT, "dist", "tools", "recall.js")));
      return recall(args);
    }
    case "verify": {
      const { verify } = await import(pathToFileURL(join(ROOT, "dist", "tools", "verify.js")));
      return verify(args);
    }
    case "chain": {
      const { chainData } = await import(pathToFileURL(join(ROOT, "dist", "tools", "chain.js")));
      return chainData(args);
    }
    case "timeline": {
      const { timeline } = await import(pathToFileURL(join(ROOT, "dist", "tools", "timeline.js")));
      return timeline(args);
    }
    case "export": {
      const { exportEntries } = await import(pathToFileURL(join(ROOT, "dist", "tools", "export.js")));
      return exportEntries(args);
    }
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
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

  process.env.VMCP_DATA_DIR = sandboxDir;
  const responses = new Map();
  responses.set(1, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "verifiable-memory-mcp", version: "0.1.2" },
    },
  });

  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    try {
      responses.set(index + 2, {
        jsonrpc: "2.0",
        id: index + 2,
        result: await callLocalTool(call.name, call.arguments ?? {}),
      });
    } catch (error) {
      responses.set(index + 2, {
        jsonrpc: "2.0",
        id: index + 2,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return { responses, stdout: "", stderr: "", dataDir: sandboxDir };
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
