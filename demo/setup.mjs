import {
  AGENT_NAME,
  AGENT_TASK,
  SENSITIVE_ACTIONS,
  SOURCES_V1,
  callTools,
  resolveDemoDataDir,
} from "./common.mjs";

const dataDir = resolveDemoDataDir();

await callTools(
  [
    {
      name: "remember",
      arguments: {
        content: JSON.stringify({
          type: "agent_created",
          agent: AGENT_NAME,
          createdBy: "owner",
          task: AGENT_TASK,
          status: "active",
        }),
        tags: ["demo", "identity"],
      },
    },
    {
      name: "remember",
      arguments: {
        content: JSON.stringify({
          type: "policy_created",
          agent: AGENT_NAME,
          actor: "owner",
          ownerSignature: true,
          policyVersion: 1,
          task: AGENT_TASK,
          allowedSources: SOURCES_V1,
          deniedActions: SENSITIVE_ACTIONS,
          status: "active",
        }),
        tags: ["demo", "policy"],
      },
    },
  ],
  { dataDir, clientName: "vmcp-demo-setup" }
);

console.log("DEMO SETUP COMPLETE");
console.log(`Sandbox: ${dataDir}`);
console.log(`Agent: ${AGENT_NAME}`);
console.log(`Task: ${AGENT_TASK}`);
console.log("Policy: v1 ACTIVE");
console.log("Trusted sources:");
for (const source of SOURCES_V1) {
  console.log(`  - ${source.name} (${source.topic})`);
}
console.log(`Sensitive actions (require owner authority): ${SENSITIVE_ACTIONS.join(", ")}`);
