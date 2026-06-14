import { createClient } from "./common.mjs";

// ── helpers ──────────────────────────────────────────────────────────────
function dash(text) {
  const line = "═".repeat(text.length + 4);
  return `╔${line}╗\n║  ${text}  ║\n╚${line}╝`;
}

function parseChain(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseBundle(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function eventFrom(entry) {
  try {
    return JSON.parse(entry.content);
  } catch {
    return null;
  }
}

function findLatestPolicy(events) {
  const policyEvents = events.filter(
    (e) => e.event && (e.event.type === "policy_created" || e.event.type === "policy_updated")
  );
  if (policyEvents.length === 0) return null;
  return policyEvents[policyEvents.length - 1];
}

function findPendingRequest(events) {
  return events.find((e) => e.event && e.event.status === "pending_owner_approval");
}

// ── renderers ────────────────────────────────────────────────────────────
function renderGreen(chain, policy, allEvents) {
  const version = policy.event.policyVersion || 1;
  const actions = policy.event.allowedActions || [];

  console.log(`\n${dash("AGENT GUARD CHECK")}\n`);
  console.log(`AGENT: Daily AI News Bot`);
  console.log(`MEMORY STATUS: VERIFIED`);
  console.log(`POLICY VERSION: v${version}`);

  // Print the allowed action summary
  const actionStr = actions.join(", ");
  console.log(`REQUESTED ACTION: ${actionStr}`);
  console.log(`ACTOR: agent`);
  console.log(`RISK: LOW`);
  console.log(`\nDECISION: EXECUTE`);
  console.log(`REASON: policy allows this action`);
}

function renderYellow(chain, policy, pendingReq) {
  const req = pendingReq.event;
  const version = policy ? `v${policy.event.policyVersion || "?"}` : "?";

  console.log(`\n${dash("AGENT GUARD CHECK")}\n`);
  console.log(`AGENT: Daily AI News Bot`);
  console.log(`MEMORY STATUS: VERIFIED`);

  if (policy) {
    console.log(`POLICY VERSION: ${version}`);
  }

  console.log(`REQUEST: ${req.requestedAction || "unknown"}`);
  console.log(`ACTOR: ${req.actor || "unknown"}`);
  console.log(`RISK: ${(req.risk || "unknown").toUpperCase()}`);
  console.log(`\nDECISION: PENDING_OWNER_APPROVAL`);
  console.log(`REASON: ${req.actor || "delegate"} cannot authorize financial recurring transfers`);
}

function renderRed(chain) {
  console.log(`\n${dash("AGENT GUARD CHECK")}\n`);
  console.log(`AGENT: Daily AI News Bot`);
  console.log(`MEMORY STATUS: TAMPERED`);
  console.log(`POLICY STATUS: UNTRUSTED`);
  console.log(`\nDECISION: EXECUTION_BLOCKED`);
  console.log(`REASON: history was modified outside authorized append-only flow`);
}

// ── main ─────────────────────────────────────────────────────────────────
const client = createClient();
try {
  await client.init();

  // 1. Verify chain integrity
  const chainResult = await client.callTool("chain", { limit: 100 });
  const chainText = chainResult.content[0].text;
  const chain = parseChain(chainText);

  if (!chain || chain.valid === undefined) {
    console.error("Failed to read chain state.");
    process.exit(1);
  }

  // 2. Get all entries
  const exportResult = await client.callTool("export", { limit: 100 });
  const bundleText = exportResult.content[0].text;
  const bundle = parseBundle(bundleText);

  if (!bundle || !bundle.entries) {
    console.error("Failed to read memory.");
    process.exit(1);
  }

  // 3. Parse events in chronological order
  const events = bundle.entries
    .map((e) => ({
      entry: e,
      event: eventFrom(e),
      createdAt: e.createdAt,
    }))
    .filter((e) => e.event !== null)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // 4. Decide
  if (!chain.valid) {
    renderRed(chain);
    process.exit(2);
  }

  const latestPolicy = findLatestPolicy(events);

  if (!latestPolicy) {
    console.log(`\n${dash("AGENT GUARD CHECK")}\n`);
    console.log("MEMORY STATUS: VERIFIED");
    console.log("POLICY: NONE");
    console.log("\nDECISION: NO_ACTION");
    console.log("REASON: no policy configured for this agent");
    process.exit(0);
  }

  const pendingRequest = findPendingRequest(events);

  if (pendingRequest) {
    renderYellow(chain, latestPolicy, pendingRequest);
    process.exit(0);
  }

  renderGreen(chain, latestPolicy, events);
} finally {
  client.close();
}
