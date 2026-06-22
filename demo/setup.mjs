import {
  AGENT_NAME,
  AGENT_TASK,
  SENSITIVE_ACTIONS,
  SOURCES_V1,
  callTools,
  resolveDemoDataDir,
  textContent,
} from "./common.mjs";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidencePackage } from "./evidence-package.mjs";

const dataDir = resolveDemoDataDir();
const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, "state.json");
const createdAt = new Date().toISOString();
const charterContent = {
  type: "agent_charter",
  agent: AGENT_NAME,
  createdBy: "owner",
  createdAt,
  task: AGENT_TASK,
  doctrine: [
    "I always verify memory before acting.",
    "I only trust append-only updates.",
    "I separate external content from owner instructions.",
    "I write evidence for every action.",
    "If integrity fails, I stop.",
  ],
  status: "trusted_genesis_entry",
};

const setupSession = await callTools(
  [
    {
      name: "remember",
      arguments: {
        content: JSON.stringify(charterContent),
        tags: ["demo", "identity", "charter", "genesis"],
      },
    },
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

const charterReceipt = JSON.parse(textContent(setupSession.results[0]));
const initialState = {
  agent: AGENT_NAME,
  task: AGENT_TASK,
  sandbox: dataDir,
  status: "READY",
  memory: "VERIFIED",
  policyStatus: "TRUSTED",
  policyVersion: 1,
  decision: "IDLE",
  currentStep: "waiting for next cycle",
  reason: "setup complete — policy v1 active; run the first agent cycle to begin",
  ownerReview: null,
  research: null,
  charter: {
    title: "Agent Charter",
    entryId: charterReceipt.id,
    content: charterContent,
    contentHash: charterReceipt.contentHash,
    prevHash: charterReceipt.prevHash,
    entryHash: charterReceipt.entryHash,
    status: "trusted_genesis_entry",
  },
  operatingMemory: {
    policy: {
      allowedActions: ["research_sources", "write_evidence", "summarize_findings"],
      sensitiveActions: SENSITIVE_ACTIONS,
      reviewRequiredFor: ["external_sensitive_instruction"],
      stopOn: ["memory_integrity_failure", "unauthorized_history_mutation"],
    },
    ledger: {
      description: "Append-only record of agent actions, sources, findings, decisions, and closures.",
      tickets: [],
    },
    authority: {
      owner: "demo-owner",
      flowCreator: "demo-owner",
      policyVersion: 1,
      lastApprovedUpdate: null,
    },
  },
  evidencePackage: null,
  evidencePackages: [],
  lastTelegramAlert: null,
  updatedAt: createdAt,
  cycles: [],
  events: [
    {
      cycle: 0,
      at: createdAt,
      type: "setup_complete",
      label: "Setup complete: agent charter created, policy v1 active, memory verified",
    },
  ],
};

const evidencePackage = await createEvidencePackage({
  state: initialState,
  cycle: 0,
  decision: "IDLE",
  memory: "VERIFIED",
  label: "setup_READY",
  dataDir,
});
initialState.evidencePackage = evidencePackage;
initialState.evidencePackages = [evidencePackage];

writeFileSync(STATE_PATH, JSON.stringify(initialState, null, 2));

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
