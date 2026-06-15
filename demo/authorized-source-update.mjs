import {
  AGENT_NAME,
  SENSITIVE_ACTIONS,
  SOURCE_V2_ADDITION,
  callTools,
  latestPolicy,
  readMemoryState,
  resolveDemoDataDir,
} from "./common.mjs";

const dataDir = resolveDemoDataDir();

const { events } = await readMemoryState(dataDir, "vmcp-demo-policy-read");
const policy = latestPolicy(events);
const prevVersion = policy?.policyVersion ?? 0;
const newVersion = prevVersion + 1;
const prevSources = policy?.allowedSources ?? [];

// Caso B: el owner agrega una nueva fuente confiable a través del MCP
// (append-only). No edita la policy anterior, solo agrega un evento nuevo.
await callTools(
  [
    {
      name: "remember",
      arguments: {
        content: JSON.stringify({
          type: "policy_updated",
          agent: AGENT_NAME,
          actor: "owner",
          ownerSignature: true,
          policyVersion: newVersion,
          previousPolicyVersion: prevVersion,
          task: policy?.task,
          allowedSources: [...prevSources, SOURCE_V2_ADDITION],
          deniedActions: SENSITIVE_ACTIONS,
          status: "active",
        }),
        tags: ["demo", "policy"],
      },
    },
  ],
  { dataDir, clientName: "vmcp-demo-policy-update" }
);

console.log("AUTHORIZED SOURCE UPDATE");
console.log(`Sandbox: ${dataDir}`);
console.log("Actor: owner");
console.log(`Previous policy: v${prevVersion} -> v${newVersion}`);
console.log(`Added trusted source: ${SOURCE_V2_ADDITION.name} (${SOURCE_V2_ADDITION.topic})`);
console.log("This event is append-only and does not edit any previous entry.");
