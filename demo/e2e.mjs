import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_DIR } from "./common.mjs";

const env = { ...process.env, VMCP_DATA_DIR: DEMO_DIR };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function runStep(label, command, args, expectedCodes = [0]) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (!expectedCodes.includes(code ?? 0)) {
        reject(new Error(`${label} exited with code ${code}; expected ${expectedCodes.join(", ")}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

// Caso A: ciclo normal de investigación con memoria sana y policy v1
await runStep("reset demo sandbox", "bash", ["demo/reset.sh"]);
await runStep("seed demo memory (case A)", process.execPath, ["demo/setup.mjs"]);
await runStep("agent cycle 1 - case A: research with policy v1 -> EXECUTE", process.execPath, [
  "demo/agent-loop.mjs",
  "--once",
]);

// Caso B: el owner habilita una nueva fuente confiable via MCP (policy v2)
await runStep("owner authorizes a new trusted source (case B)", process.execPath, [
  "demo/authorized-source-update.mjs",
]);
await runStep(
  "agent cycle 2 - case B: research with new source from policy v2 -> EXECUTE",
  process.execPath,
  ["demo/agent-loop.mjs", "--once"]
);

// Caso C: contenido externo intenta una acción sensible (prompt injection)
await runStep("external content requests sensitive action (case C)", process.execPath, [
  "demo/prompt-injection.mjs",
]);
await runStep(
  "agent cycle 3 - case C: unsigned sensitive request -> WAIT_FOR_OWNER",
  process.execPath,
  ["demo/agent-loop.mjs", "--once"],
  [3]
);

// El owner aprueba y la cadena sigue sana; el agente vuelve a investigar
await runStep("owner approves the pending request (case C continued)", process.execPath, [
  "demo/owner-approve.mjs",
]);
await runStep(
  "agent cycle 4 - case C continued: owner approved -> back to EXECUTE",
  process.execPath,
  ["demo/agent-loop.mjs", "--once"]
);

// Caso D: tamper real fuera del MCP
await runStep("tamper sandbox database directly (case D)", "python3", ["demo/tamper.py"]);
await runStep(
  "agent cycle 5 - case D: broken chain -> STOP_BY_INTEGRITY, agent stops before research",
  process.execPath,
  ["demo/agent-loop.mjs", "--once"],
  [2]
);
await runStep("export tampered bundle from sandbox", process.execPath, ["demo/export.mjs"]);

console.log("\nDEMO E2E READY");
console.log(`Sandbox: ${DEMO_DIR}`);
console.log("State: demo/state.json (used by demo/dashboard.html)");
console.log("Next: open verifier/index.html and load the exported bundle for the browser-side proof.");
