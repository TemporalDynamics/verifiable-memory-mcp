# VMCP Demo E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave the verifiable-memory-mcp demo fully recordable as a live end-to-end flow against the real MCP server over stdio, using only sandbox demo data.

**Architecture:** Extract one shared stdio MCP client for demo and verifier scripts, then rewire the demo around an explicit sandbox and an honest scenario: initial policy, sensitive request outside policy, tamper event, guard refusal, export, and browser verification. Keep the public message narrow: verifiable memory, local chain of custody, portable evidence, and visible halt on tampering.

**Tech Stack:** Node.js, TypeScript build output, MCP stdio transport, SQLite sandbox DB, shell scripts, static browser verifier.

---

### Task 1: Shared MCP stdio client

**Files:**
- Create: `demo/mcp-client.mjs`
- Modify: `demo/common.mjs`

- [ ] Implement a shared client wrapper that spawns `dist/index.js`, performs `initialize`, sends `notifications/initialized`, calls tools, enforces timeouts, and closes cleanly.
- [ ] Make the wrapper require an explicit `VMCP_DATA_DIR` or default to `/tmp/vmcp-agent-demo`, never `~/.verifiable-memory-mcp`.
- [ ] Ensure stdout parsing handles the real server response framing and stderr stays available for debugging.

### Task 2: Rewire demo scripts to the shared client

**Files:**
- Modify: `demo/setup.mjs`
- Modify: `demo/run-agent.mjs`
- Modify: `demo/authorized-update.mjs`
- Modify: `demo/delegate-sensitive-request.mjs`
- Modify: `demo/export.mjs`
- Modify: `demo/reset.sh`

- [ ] Replace the ad hoc client usage with the shared MCP client.
- [ ] Rename the scenario agent to `treasury-briefing-agent` or `operations-assistant`.
- [ ] Seed an initial low-privilege policy that allows `send_daily_operational_summary` and excludes `approve_wire_transfer`, `export_customer_records`, and `delete_audit_log`.
- [ ] Record a concrete sensitive request with explicit fields: action, actor, risk, and status.
- [ ] Update `run-agent.mjs` so it evaluates the concrete request and renders an honest decision: `ALLOW`, `REVIEW`, or `BLOCK_BY_POLICY`.

### Task 3: Rewire verifier runtime scripts

**Files:**
- Modify: `verifier/acceptance.mjs`
- Modify: `verifier/guard.mjs`

- [ ] Replace local RPC logic with the same shared MCP client or a verifier-local equivalent that uses the same handshake semantics.
- [ ] Make `guard.mjs` distinguish integrity failure from policy insufficiency.
- [ ] Keep `acceptance.mjs` hermetic and pinned to controlled demo data.

### Task 4: Sandbox safety and export discipline

**Files:**
- Modify: `verifier/anchor.sh`
- Modify: `demo/export.mjs`
- Modify: `README.md`
- Modify: `verifier/README.md`

- [ ] Make `anchor.sh` refuse to run without an explicit `VMCP_DATA_DIR` or equivalent demo flag.
- [ ] Prevent all demo/export commands from reading default real memory by accident.
- [ ] Update docs so every demo command shows the sandbox requirement explicitly.

### Task 5: One-command smoke path

**Files:**
- Modify: `package.json`
- Create or modify: `demo/e2e.mjs`

- [ ] Add `npm run demo:e2e` to execute reset, setup, green check, sensitive request, policy review/block, tamper, integrity block, export, and final artifact readiness.
- [ ] Make it fail fast with non-zero exit on any broken step.

### Task 6: Verification

**Files:**
- No code path ownership; verification-only task

- [ ] Run `npm test`.
- [ ] Run `npm run demo:setup`.
- [ ] Run `npm run demo:run-agent` before tamper and confirm an honest green/allow or policy-based result as intended by the scenario.
- [ ] Run `node verifier/guard.mjs` before and after tamper and confirm the correct status transition.
- [ ] Run `node verifier/acceptance.mjs`.
- [ ] Run `VMCP_DATA_DIR=/tmp/vmcp-agent-demo bash verifier/anchor.sh <outdir>`.
- [ ] Confirm `verifier/sample-bundle.json` still matches `verifier/sample-bundle.sha256`.

### Coverage check

- Shared client: covered by Tasks 1-3.
- Explicit sandboxing and no accidental real-memory reads: covered by Tasks 1, 4, and 6.
- Honest scenario semantics: covered by Task 2.
- Single-command recordable flow: covered by Task 5.
- Acceptance criteria and evidence: covered by Task 6.
