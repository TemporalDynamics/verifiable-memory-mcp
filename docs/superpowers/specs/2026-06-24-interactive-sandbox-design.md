# Interactive Sandbox Design

Date: 2026-06-24
Repo: `verifiable-memory-mcp`

## Goal

Upgrade the current public sandbox page into a browser-only interactive sandbox that lets a visitor play through the core agent integrity flow without installing anything and without pretending that live agents or live search are running.

The sandbox should feel similar to a Talo-style agent console: the visitor chooses an intent, runs placeholder agent cycles, sees events appear, exports evidence, and verifies the resulting ECO artifact in the existing browser verifier.

This must happen on the existing public page:

`sandbox/index.html`

Do not create a second sandbox URL or a parallel page.

## Core Thesis

The sandbox demonstrates integrity-before-action:

1. A user enters or selects an intent.
2. The placeholder agent runs against controlled sample data.
3. The run returns results and generates evidence.
4. Prompt injection creates a warning but does not stop execution.
5. Memory tamper causes the next run to stop before action.
6. Every run produces an ECO artifact.
7. The visitor can download any ECO or open it directly in the verifier.

## Non-Goals

The sandbox does not run real agents, perform live web search, contact people, process real CVs, send mail, use private Talo data, or call a backend service.

It must not imply that the visitor is running a production recruiting workflow. It is a controlled browser demo of the agent integrity pattern.

## Interaction Model

The existing static demo and the new interactive flow should live together on the same page. The interactive console is the primary experience; the pre-generated artifact walkthrough can remain as supporting proof below it.

The page should expose a compact operator console with these controls:

- `Run`
- `Run with prompt injection`
- `Apply memory tamper`
- `Reset`

Each generated run should expose:

- run number
- run status
- memory state
- content risk
- decision
- short result summary
- `Download ECO`
- `Open in verifier`

The sandbox should keep a run history so a visitor can create many clean runs in a row and verify any of them.

## State Machine

### Initial State

- `runCount = 0`
- `memoryState = VERIFIED`
- `tamperPending = false`
- `runs = []`

### Clean Run

Trigger: `Run`

If `tamperPending = false`:

- create a new run
- memory state remains `VERIFIED`
- content risk is `CLEAN`
- decision is `EXECUTE`
- result summary is selected from controlled sample results
- ECO verifies positive in the verifier

The user can repeat this many times. Run 1, run 2, run 10, and later clean runs should each produce independently verifiable ECO artifacts.

### Prompt Injection Run

Trigger: `Run with prompt injection`

If `tamperPending = false`:

- create a new run
- memory state remains `VERIFIED`
- content risk is `SUSPICIOUS`
- decision is `EXECUTE_WITH_WARNING`
- timeline shows a prompt injection warning
- execution continues
- ECO verifies positive in the verifier

This is intentional: the verifier proves evidence integrity, not that the content was safe.

### Tamper Application

Trigger: `Apply memory tamper`

- set `tamperPending = true`
- show visible state `PENDING_TAMPER_CHECK`
- do not immediately create a stop run
- timeline records that memory was altered outside the approved flow

### Run After Tamper

Trigger: `Run` or `Run with prompt injection` while `tamperPending = true`

- create a new run
- memory state becomes `TAMPERED`
- content risk can remain `UNREVIEWED` or `SUSPICIOUS` depending on the trigger
- decision is `STOP_BY_INTEGRITY`
- no placeholder results are returned
- timeline shows the agent stopped before action
- ECO is generated as an incident artifact and opens in the verifier

The ECO should still verify as an intact artifact. Its content declares that the run stopped because memory integrity failed.

### Reset

Trigger: `Reset`

- clear all local sandbox state
- return to Initial State
- no remote state is touched

## ECO Requirements

Each run must generate an ECO-compatible JSON object that the existing verifier can process.

The ECO must include:

- `format = eco.evidence-artifact`
- `origin_app = verifiable-memory-mcp-sandbox`
- `artifact_type = run` or `incident`
- `lifecycle = NORMAL` or `INCIDENT`
- `manifest` with run number, decision, memory, content risk, status, and createdAt
- `anchor.bundleHash`
- `bundleText`
- human-readable report

The `bundleText` must contain a valid `verifiable-memory-bundle` with append-only entries and internally consistent hashes.

The sandbox must compute hashes in the browser using WebCrypto so downloaded ECOs are not static copies.

## Verifier Integration

For each run, the sandbox should support two verification paths:

1. `Download ECO`: saves the generated ECO JSON to the visitor's device.
2. `Open in verifier`: opens the existing `verifier/index.html` with the generated ECO loaded or transferred.

If direct URL transfer is too large or unreliable, the first implementation can use a Blob object URL while the user stays in the same browser session. Download must always remain available.

The existing verifier should remain the canonical verification surface. The sandbox should not duplicate verifier verdict logic except for generating valid artifacts.

## UI Structure

The sandbox page should have one primary usable surface, not a marketing page:

1. intent input
2. action buttons
3. live status panel
4. timeline
5. result panel
6. run history with ECO actions
7. existing artifact walkthrough as supporting evidence
8. short local install section below the console

Audience segmentation labels like `For judges and operators` and `For developers` should be removed. The page should be readable by anyone.

## Copy Rules

Use direct wording:

- `Run`
- `Run with prompt injection`
- `Apply memory tamper`
- `Download ECO`
- `Open in verifier`
- `Reset`

Avoid claims that imply real live search or live agents. The page may say:

`This sandbox uses controlled placeholder results to demonstrate the integrity flow.`

## Testing Requirements

Before completion, verify:

1. A clean run creates an ECO.
2. Ten repeated clean runs each create ECOs with `memory = VERIFIED`.
3. A prompt injection run creates an ECO with `contentRisk = SUSPICIOUS` and does not stop.
4. Applying tamper does not immediately stop.
5. The next run after tamper creates an ECO with `decision = STOP_BY_INTEGRITY`.
6. Clean run ECOs verify positive in the verifier.
7. Prompt injection ECO verifies positive in the verifier.
8. Tamper stop ECO verifies as an intact incident artifact.
9. Reset returns the sandbox to initial state.
10. No backend, network, token, or private Talo dependency is required.

## Implementation Boundary

Implement the interactive sandbox inside the existing `sandbox/index.html`. If helper JavaScript becomes necessary, place it under `sandbox/` and keep the verifier unchanged unless compatibility work is required.

Do not change the published ECO verifier behavior unless the sandbox exposes a real incompatibility.
