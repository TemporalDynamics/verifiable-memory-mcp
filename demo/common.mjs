import { DEMO_DIR, callTools, resolveDemoDataDir, textContent } from "./mcp-client.mjs";

export { DEMO_DIR, callTools, resolveDemoDataDir, textContent };

export const AGENT_NAME = "ai-infrastructure-research-agent";

export const AGENT_TASK =
  "Monitor news about AI agents, secure digital infrastructure, quantum-safe readiness, and verifiable memory.";

// Caso C / D: acción sensible que requiere firma del owner sin importar la policy.
export const SENSITIVE_ACTION = "approve_wire_transfer";

// Acciones que SIEMPRE requieren autoridad del owner (ownerSignature === true),
// independientemente de si la policy las permite.
export const SENSITIVE_ACTIONS = [
  "approve_wire_transfer",
  "export_customer_records",
  "delete_audit_log",
];

// Fuentes "confiables" (mock/local) que la policy v1 habilita para el agente.
export const SOURCES_V1 = [
  {
    name: "IBM Quantum",
    url: "https://example.local/ibm-quantum",
    topic: "quantum-safe infrastructure",
    addedInVersion: 1,
    finding: "New guidance on migrating cryptographic infrastructure to quantum-safe algorithms.",
  },
  {
    name: "Anthropic",
    url: "https://example.local/anthropic-safety",
    topic: "agent safety and oversight",
    addedInVersion: 1,
    finding: "Updated research on agent oversight and constitutional safeguards for autonomous systems.",
  },
  {
    name: "arXiv AI Agents",
    url: "https://example.local/arxiv-agents",
    topic: "AI agents and verifiable memory",
    addedInVersion: 1,
    finding: "New paper proposes tamper-evident memory logs as a foundation for agent auditability.",
  },
];

// Fuente nueva que el owner habilita en la policy v2 (Caso B).
export const SOURCE_V2_ADDITION = {
  name: "Microsoft Azure AI",
  url: "https://example.local/azure-ai-updates",
  topic: "agent infrastructure",
  addedInVersion: 2,
  finding: "New Azure AI Agent Service update adds built-in audit trails for autonomous workflows.",
};

export function parseBundle(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseChain(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseEvent(entry) {
  try {
    return JSON.parse(entry.content);
  } catch {
    return null;
  }
}

export function sortByCreatedAt(entries) {
  return [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Lee chain + export y devuelve { chain, bundle, events, items } con `events` ordenados por fecha. */
export async function readMemoryState(dataDir, clientName) {
  const session = await callTools(
    [
      { name: "chain", arguments: { limit: 200 } },
      { name: "export", arguments: { limit: 200 } },
    ],
    { dataDir, clientName }
  );

  const chain = parseChain(textContent(session.results[0]));
  const bundle = parseBundle(textContent(session.results[1]));

  const items = (bundle?.entries ?? [])
    .map((entry) => ({ entry, event: parseEvent(entry) }))
    .filter((item) => item.event !== null);

  const sorted = items.sort((a, b) => new Date(a.entry.createdAt) - new Date(b.entry.createdAt));

  return {
    chain,
    bundle,
    events: sorted.map((item) => item.event),
    items: sorted,
  };
}

export function latestPolicy(events) {
  const policies = events.filter(
    (event) => event.type === "policy_created" || event.type === "policy_updated"
  );
  return policies.at(-1) ?? null;
}

/**
 * Devuelve la última `action_requested` sensible que todavía no fue resuelta
 * por el owner (sin `owner_approval`/`owner_rejection` posterior). `null` si
 * no hay ninguna pendiente.
 */
export function pendingOwnerRequest(events) {
  const requests = events.filter(
    (event) => event.type === "action_requested" && SENSITIVE_ACTIONS.includes(event.action)
  );
  const last = requests.at(-1);
  if (!last) return null;

  const lastIndex = events.lastIndexOf(last);
  const resolved = events
    .slice(lastIndex + 1)
    .some((event) => event.type === "owner_approval" || event.type === "owner_rejection");

  return resolved ? null : last;
}

/**
 * Motor de evaluación: las tres condiciones (memory integrity, policy validity,
 * owner authority). Devuelve un objeto de estado listo para imprimir / volcar a
 * demo/state.json. No ejecuta nada por sí mismo — `agent-loop.mjs` decide qué
 * hacer según `decision`.
 */
export function evaluateCycle({ chain, policy, events }) {
  if (!chain || chain.valid === undefined) {
    return {
      memory: "UNKNOWN",
      decision: "STOP_BY_INTEGRITY",
      currentStep: "stopped before source selection",
      reason: "unable to read memory chain",
    };
  }

  if (!chain.valid) {
    return {
      memory: "TAMPERED",
      policyStatus: "UNTRUSTED",
      decision: "STOP_BY_INTEGRITY",
      currentStep: "stopped before source selection",
      reason: `chain failed at ${chain.failedAt}`,
    };
  }

  if (!policy) {
    return {
      memory: "VERIFIED",
      decision: "WAIT_FOR_OWNER",
      currentStep: "waiting for owner: no active policy",
      reason: "no active policy configured",
    };
  }

  const pending = pendingOwnerRequest(events ?? []);
  if (pending) {
    const requestSource = pending.source ?? pending.actor ?? "unknown";
    return {
      memory: "VERIFIED",
      policyVersion: policy.policyVersion ?? null,
      decision: "WAIT_FOR_OWNER",
      currentStep: "waiting for owner approval",
      ownerReview: {
        action: pending.action,
        requestSource,
        reason: "external content requested a sensitive action without owner authorization",
      },
      reason: "sensitive action requires owner authorization",
    };
  }

  return {
    memory: "VERIFIED",
    policyVersion: policy.policyVersion ?? null,
    decision: "EXECUTE",
    currentStep: "selecting trusted sources",
    task: policy.task ?? AGENT_TASK,
    sources: policy.allowedSources ?? [],
    reason: `policy v${policy.policyVersion ?? "?"} active — agent proceeds with research`,
  };
}
