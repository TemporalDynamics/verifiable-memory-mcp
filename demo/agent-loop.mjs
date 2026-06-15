#!/usr/bin/env node
/**
 * agent-loop.mjs — runtime loop for the "Live Research Agent" demo.
 *
 * Each cycle checks three conditions before doing anything:
 *   1. MEMORY INTEGRITY  — is the hash chain intact?
 *   2. POLICY VALIDITY   — is there an active policy (task + trusted sources)?
 *   3. OWNER AUTHORITY   — is there a sensitive request waiting on the owner?
 *
 * Decisions: EXECUTE | WAIT_FOR_OWNER | STOP_BY_INTEGRITY
 *
 * - EXECUTE: the agent selects its trusted sources from the active policy,
 *   "visits" each one (mocked, local, deterministic), and writes a short
 *   research brief. Every step is appended as evidence.
 * - WAIT_FOR_OWNER: a sensitive action was requested without owner
 *   authorization. The agent holds, does not research, and waits.
 * - STOP_BY_INTEGRITY: the memory chain is broken. The agent stops before
 *   selecting any source, writes nothing new, and sends a Telegram alert.
 *
 * Usage:
 *   node demo/agent-loop.mjs            # run forever, one cycle every 30s
 *   node demo/agent-loop.mjs --once      # run a single cycle and exit
 *   node demo/agent-loop.mjs --cycles=3  # run N cycles then exit
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_NAME,
  callTools,
  evaluateCycle,
  latestPolicy,
  readMemoryState,
  resolveDemoDataDir,
} from "./common.mjs";
import { sendIntegrityStopAlert, sendOwnerReviewAlert } from "./telegram-alert.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, "state.json");

const args = process.argv.slice(2);
const once = args.includes("--once");
const cyclesArg = args.find((arg) => arg.startsWith("--cycles="));
const intervalArg = args.find((arg) => arg.startsWith("--interval-ms="));
const maxCycles = cyclesArg ? Number(cyclesArg.split("=")[1]) : once ? 1 : Infinity;
const intervalMs = intervalArg ? Number(intervalArg.split("=")[1]) : 30_000;

const dataDir = resolveDemoDataDir();

const STATUS_BY_DECISION = {
  EXECUTE: "RUNNING",
  WAIT_FOR_OWNER: "WAITING",
  STOP_BY_INTEGRITY: "STOPPED",
};

const EXIT_BY_DECISION = {
  EXECUTE: 0,
  WAIT_FOR_OWNER: 3,
  STOP_BY_INTEGRITY: 2,
};

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function dash(text) {
  const line = "═".repeat(text.length + 4);
  return `╔${line}╗\n║  ${text}  ║\n╚${line}╝`;
}

function printCycle(cycleNumber, result) {
  console.log(`\n${dash(`AGENT CYCLE ${cycleNumber}`)}\n`);
  console.log(`AGENT: ${AGENT_NAME}`);
  console.log(`SANDBOX: ${dataDir}`);
  console.log(`MEMORY: ${result.memory}`);
  if (result.policyStatus) console.log(`POLICY STATUS: ${result.policyStatus}`);
  if (result.policyVersion !== undefined) console.log(`POLICY: v${result.policyVersion}`);
  console.log(`DECISION: ${result.decision}`);
  console.log(`CURRENT STEP: ${result.currentStep}`);
  console.log(`REASON: ${result.reason}`);
}

async function runResearch(cycleNumber, result) {
  const sources = result.sources ?? [];
  const calls = [];
  const sourceLog = [];

  for (const source of sources) {
    const reason =
      source.addedInVersion > 1
        ? `owner authorized trusted source in policy v${source.addedInVersion}`
        : `trusted source for ${source.topic}`;

    calls.push({
      name: "remember",
      arguments: {
        content: JSON.stringify({
          type: "source_selected",
          agent: AGENT_NAME,
          cycle: cycleNumber,
          source: source.name,
          url: source.url,
          reason,
        }),
        tags: ["demo", "research", "source"],
      },
    });

    calls.push({
      name: "remember",
      arguments: {
        content: JSON.stringify({
          type: "source_visited",
          agent: AGENT_NAME,
          cycle: cycleNumber,
          source: source.name,
          url: source.url,
          result: "relevant_update_found",
          finding: source.finding,
        }),
        tags: ["demo", "research", "source"],
      },
    });

    sourceLog.push({ name: source.name, url: source.url, reason, finding: source.finding });
    console.log(`SOURCE: ${source.name} — ${reason}`);
    console.log(`  -> ${source.finding}`);
  }

  const sourcesUsed = sources.map((s) => s.name);
  const summary =
    sourcesUsed.length > 0
      ? `Reviewed ${sourcesUsed.length} source(s): ${sourcesUsed.join(", ")}. ` +
        sources.map((s) => s.finding).join(" ")
      : "No trusted sources configured.";

  calls.push({
    name: "remember",
    arguments: {
      content: JSON.stringify({
        type: "brief_generated",
        agent: AGENT_NAME,
        cycle: cycleNumber,
        summary,
        sourcesUsed,
      }),
      tags: ["demo", "research", "brief"],
    },
  });

  await callTools(calls, { dataDir, clientName: "vmcp-agent-loop" });

  console.log(`BRIEF: ${summary}`);

  return { sources: sourceLog, brief: summary };
}

async function recordWaitEvidence(result) {
  await callTools(
    [
      {
        name: "remember",
        arguments: {
          content: JSON.stringify({
            type: "cycle_evaluated",
            agent: AGENT_NAME,
            memory: result.memory,
            policyVersion: result.policyVersion ?? null,
            decision: result.decision,
            ownerReview: result.ownerReview ?? null,
            reason: result.reason,
          }),
          tags: ["demo", "evidence", "cycle"],
        },
      },
    ],
    { dataDir, clientName: "vmcp-agent-loop" }
  );
}

function pushEvent(events, cycleNumber, now, type, label) {
  events.push({ cycle: cycleNumber, at: now, type, label });
  return events.slice(-60);
}

async function runCycle(cycleNumber) {
  const { chain, events } = await readMemoryState(dataDir, "vmcp-agent-loop");
  const policy = latestPolicy(events);
  const result = evaluateCycle({ chain, policy, events });

  printCycle(cycleNumber, result);

  const state = loadState() ?? { cycles: [], events: [], lastTelegramAlert: null, policyVersion: null };
  const now = new Date().toISOString();

  let eventLog = state.events ?? [];
  eventLog = pushEvent(eventLog, cycleNumber, now, "cycle_started", `Cycle ${cycleNumber} started`);

  if (
    result.policyVersion !== undefined &&
    result.policyVersion !== null &&
    state.policyVersion != null &&
    result.policyVersion !== state.policyVersion
  ) {
    eventLog = pushEvent(
      eventLog,
      cycleNumber,
      now,
      "policy_updated",
      `Policy updated to v${result.policyVersion}`
    );
  }

  let telegramAlert = state.lastTelegramAlert ?? null;
  let research = null;

  if (result.decision === "STOP_BY_INTEGRITY") {
    eventLog = pushEvent(eventLog, cycleNumber, now, "memory_tampered", "Memory verification FAILED");
    eventLog = pushEvent(eventLog, cycleNumber, now, "tamper_detected", `Tamper detected: ${result.reason}`);
    eventLog = pushEvent(
      eventLog,
      cycleNumber,
      now,
      "agent_stopped",
      "Agent stopped before source selection"
    );

    const outcome = await sendIntegrityStopAlert({
      agent: AGENT_NAME,
      failedAt: chain?.failedAt ?? "unknown",
      action: result.action,
      sandbox: dataDir,
    });
    telegramAlert = { type: "STOP_BY_INTEGRITY", at: now, ...outcome };
    console.log(
      outcome.mock
        ? "TELEGRAM: mock alert printed above (set DEMO_TELEGRAM_ALERTS=true to send for real)"
        : `TELEGRAM: alert ${outcome.sent ? "sent" : "FAILED"}`
    );
    // Deliberately do not write any new memory event: the agent stops before
    // doing anything, it does not pretend business-as-usual.
  } else if (result.decision === "WAIT_FOR_OWNER") {
    eventLog = pushEvent(eventLog, cycleNumber, now, "memory_verified", "Memory verified");

    const wasWaiting = state.decision === "WAIT_FOR_OWNER";
    if (!wasWaiting && result.ownerReview) {
      eventLog = pushEvent(
        eventLog,
        cycleNumber,
        now,
        "prompt_injection_detected",
        `Prompt injection detected: ${result.ownerReview.action} requested by ${result.ownerReview.requestSource}`
      );
    }
    eventLog = pushEvent(
      eventLog,
      cycleNumber,
      now,
      "waiting_for_owner",
      result.ownerReview
        ? `Waiting for owner: ${result.ownerReview.action} (${result.ownerReview.requestSource})`
        : "Waiting for owner: no active policy"
    );

    const alreadyAlerted = state.lastTelegramAlert?.type === "WAIT_FOR_OWNER" && wasWaiting;
    if (!alreadyAlerted && result.ownerReview) {
      const outcome = await sendOwnerReviewAlert({
        agent: AGENT_NAME,
        action: result.ownerReview.action,
        memory: result.memory,
        decision: result.decision,
      });
      telegramAlert = { type: "WAIT_FOR_OWNER", at: now, ...outcome };
      console.log(
        outcome.mock
          ? "TELEGRAM: mock alert printed above (set DEMO_TELEGRAM_ALERTS=true to send for real)"
          : `TELEGRAM: alert ${outcome.sent ? "sent" : "FAILED"}`
      );
    }
    await recordWaitEvidence(result);
  } else {
    eventLog = pushEvent(eventLog, cycleNumber, now, "memory_verified", "Memory verified");
    research = await runResearch(cycleNumber, result);
    for (const source of research.sources) {
      eventLog = pushEvent(eventLog, cycleNumber, now, "source_selected", `Source selected: ${source.name} — ${source.reason}`);
      eventLog = pushEvent(eventLog, cycleNumber, now, "source_visited", `Source visited: ${source.name}`);
    }
    eventLog = pushEvent(eventLog, cycleNumber, now, "brief_generated", "Research brief generated");
  }

  const cycleSummary = {
    cycle: cycleNumber,
    at: now,
    memory: result.memory,
    policyVersion: result.policyVersion ?? null,
    decision: result.decision,
    currentStep: result.currentStep,
    reason: result.reason,
  };

  const nextState = {
    agent: AGENT_NAME,
    task: result.task ?? state.task ?? null,
    sandbox: dataDir,
    status: STATUS_BY_DECISION[result.decision] ?? "WAITING",
    memory: result.memory,
    policyStatus: result.policyStatus ?? "TRUSTED",
    policyVersion: result.policyVersion ?? null,
    decision: result.decision,
    currentStep: result.currentStep,
    reason: result.reason,
    ownerReview: result.ownerReview ?? null,
    research: research ?? (result.decision === "EXECUTE" ? null : state.research ?? null),
    lastTelegramAlert: telegramAlert,
    updatedAt: now,
    cycles: [...(state.cycles ?? []), cycleSummary].slice(-50),
    events: eventLog,
  };

  writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2));
  console.log(`\nSTATE: ${STATE_PATH}`);

  return result;
}

let cycleNumber = (loadState()?.cycles?.length ?? 0) + 1;
let lastResult = null;

for (let i = 0; i < maxCycles; i += 1) {
  lastResult = await runCycle(cycleNumber);
  cycleNumber += 1;

  if (lastResult.decision === "STOP_BY_INTEGRITY") break;
  if (i < maxCycles - 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

process.exit(EXIT_BY_DECISION[lastResult?.decision] ?? 1);
