import {
  AGENT_NAME,
  callTools,
  pendingOwnerRequest,
  readMemoryState,
  resolveDemoDataDir,
} from "./common.mjs";

const dataDir = resolveDemoDataDir();

const { events } = await readMemoryState(dataDir, "vmcp-demo-owner-read");
const pending = pendingOwnerRequest(events);

if (!pending) {
  console.log("NOTHING TO APPROVE");
  console.log("There is no pending owner-review request.");
  process.exit(1);
}

await callTools(
  [
    {
      name: "remember",
      arguments: {
        content: JSON.stringify({
          type: "owner_approval",
          agent: AGENT_NAME,
          actor: "owner",
          ownerSignature: true,
          action: pending.action,
          requestSource: pending.source ?? pending.actor ?? "unknown",
          decision: "approved",
        }),
        tags: ["demo", "owner-review"],
      },
    },
  ],
  { dataDir, clientName: "vmcp-demo-owner-approve" }
);

console.log("OWNER APPROVAL RECORDED");
console.log(`Sandbox: ${dataDir}`);
console.log(`Action: ${pending.action}`);
console.log(`Requested by: ${pending.source ?? pending.actor ?? "unknown"}`);
console.log("Decision: approved");
console.log("This event is append-only and does not edit the original request.");
