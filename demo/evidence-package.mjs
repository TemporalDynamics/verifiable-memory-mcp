import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_NAME, SENSITIVE_ACTIONS, callTools, resolveDemoDataDir, textContent } from "./common.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "evidence");

function sha256(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function padCycle(cycle) {
  return String(cycle).padStart(3, "0");
}

function buildAuthoritySummary(state) {
  return {
    owner: state.owner ?? "demo-owner",
    flowCreator: state.flowCreator ?? "demo-owner",
    policyVersion: state.policyVersion ?? null,
    ownerReview: state.ownerReview ?? null,
  };
}

function buildPolicySummary(state) {
  return {
    policyStatus: state.policyStatus ?? "UNKNOWN",
    policyVersion: state.policyVersion ?? null,
    sensitiveActions: state.sensitiveActions ?? SENSITIVE_ACTIONS,
  };
}

function buildLedgerSummary(state) {
  return {
    events: state.events ?? [],
    cycles: state.cycles ?? [],
    research: state.research ?? null,
  };
}

function buildAssetsIndex(_state) {
  return {
    entries: [],
    note: "This demo artifact stores memory and run evidence inline. External assets can be indexed here by future workflows.",
  };
}

function artifactType(decision, cycle) {
  if (decision === "STOP_BY_INTEGRITY") return "incident";
  if (decision === "WAIT_FOR_OWNER") return "owner_review";
  return "run_snapshot";
}

function lifecycleValue(decision) {
  if (decision === "STOP_BY_INTEGRITY") return "INCIDENT";
  if (decision === "WAIT_FOR_OWNER") return "OWNER_REVIEW";
  return "SNAPSHOT";
}

function packageStatus(decision, memory) {
  if (memory === "TAMPERED" || decision === "STOP_BY_INTEGRITY") return "TAMPERED";
  if (decision === "WAIT_FOR_OWNER") return "WAIT_FOR_OWNER";
  return "VALID";
}

function reportFor(manifest, state) {
  const lines = [
    `# Evidence report`,
    ``,
    `Agent: ${manifest.agent}`,
    `Cycle: ${manifest.cycle}`,
    `Decision: ${manifest.decision}`,
    `Memory: ${manifest.memory}`,
    `Status: ${manifest.status}`,
    `Created at: ${manifest.createdAt}`,
    ``,
    `## Summary`,
    state.reason ?? "No reason recorded.",
  ];

  if (state.ownerReview) {
    lines.push(
      ``,
      `## Owner review`,
      `Action requested: ${state.ownerReview.action}`,
      `Request source: ${state.ownerReview.requestSource}`,
      `Reason: ${state.ownerReview.reason}`
    );
  }

  if (state.research?.brief) {
    lines.push(``, `## Research brief`, state.research.brief);
  }

  if (manifest.failedEntry) {
    lines.push(
      ``,
      `## Integrity failure`,
      `Failed entry: ${manifest.failedEntry}`,
      `The agent stopped before selecting sources because the memory chain no longer verified.`
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function createEvidencePackage({
  state,
  cycle,
  decision,
  memory,
  failedEntry = null,
  label = null,
  dataDir = resolveDemoDataDir(),
}) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const { results } = await callTools(
    [{ name: "export", arguments: {} }],
    { dataDir, clientName: "vmcp-demo-eco-export" }
  );
  const bundleText = textContent(results[0]);
  const bundleHash = sha256(bundleText);
  const createdAt = new Date().toISOString();
  const status = packageStatus(decision, memory);
  const atype = artifactType(decision, cycle);
  const lcycle = lifecycleValue(decision);
  const filename = `${padCycle(cycle)}_${decision}.eco`;
  const manifest = {
    agent: state.agent ?? AGENT_NAME,
    task: state.task ?? null,
    cycle,
    decision,
    memory,
    status,
    failedEntry,
    createdAt,
    label: label ?? `cycle_${padCycle(cycle)}_${decision}`,
  };

  let bundle = null;
  try {
    bundle = JSON.parse(bundleText);
  } catch {
    bundle = null;
  }

  const report = reportFor(manifest, state);
  const eco = {
    eco_version: "eco.v0.2",
    format: "eco.evidence-artifact",
    version: "0.1",
    origin_app: "verifiable-memory-mcp",
    artifact_id: `${padCycle(cycle)}_${decision}_${bundleHash.slice(0, 12)}`,
    artifact_type: atype,
    lifecycle: lcycle,
    manifest,
    authority_summary: buildAuthoritySummary(state),
    policy_summary: buildPolicySummary(state),
    ledger_summary: buildLedgerSummary(state),
    assets_index: buildAssetsIndex(state),
    verification: {
      integrity: status === "TAMPERED" ? "TAMPERED" : "VALID",
      lifecycle: lcycle,
      failedEntry,
      bundleHash,
    },
    anchor: {
      algorithm: "sha256",
      bundleHash,
    },
    bundle,
    bundleText,
    report,
  };

  const ecoText = JSON.stringify(eco, null, 2);
  const ecoHash = sha256(ecoText);
  eco.packageHash = {
    algorithm: "sha256",
    value: ecoHash,
  };
  const finalText = JSON.stringify(eco, null, 2);

  const filePath = join(EVIDENCE_DIR, filename);
  const latestPath = join(EVIDENCE_DIR, "latest.eco");
  writeFileSync(filePath, finalText, "utf-8");
  writeFileSync(latestPath, finalText, "utf-8");

  const metadata = {
    filename,
    path: filePath,
    latestPath,
    url: `/evidence/${filename}`,
    latestUrl: "/evidence/latest.eco",
    verifierUrl: `/verifier/index.html?eco=/evidence/${filename}`,
    latestVerifierUrl: "/verifier/index.html?eco=/evidence/latest.eco",
    anchorHash: bundleHash,
    packageHash: sha256(finalText),
    status,
    decision,
    memory,
    cycle,
    failedEntry,
    createdAt,
    lifecycle: lcycle,
    integrity: status === "TAMPERED" ? "TAMPERED" : "VALID",
  };

  writeFileSync(join(EVIDENCE_DIR, "latest.json"), JSON.stringify(metadata, null, 2), "utf-8");
  return metadata;
}
