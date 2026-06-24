# Interactive Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `sandbox/index.html` page into a browser-only interactive agent integrity sandbox with repeatable runs, prompt-injection warnings, tamper stops, downloadable ECO artifacts, and verifier handoff.

**Architecture:** Keep the sandbox as a static GitHub Pages-compatible page. All run state, placeholder results, hash computation, ECO generation, downloads, and verifier handoff run client-side in `sandbox/index.html`. The existing verifier remains the canonical validation surface.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, WebCrypto, Blob URLs, existing `verifier/index.html`.

---

## File Structure

- Modify: `sandbox/index.html`
  - Replace the current static-first walkthrough with an operator console.
  - Keep the current pre-generated artifact walkthrough below the interactive console as supporting evidence.
  - Add client-side JavaScript for state, run generation, ECO generation, downloads, and verifier handoff.

- Modify: `index.html`
  - Remove audience segmentation copy such as `For judges and operators` and `For developers`.
  - Point the main CTA to the now-interactive sandbox.
  - Keep the technical install path as a normal secondary section, not an audience label.
  - Add public ecosystem links that are already known to be public and presentation-ready.

- Do not modify: `verifier/index.html`
  - Use the existing `?eco=...` and file-loading behavior.
  - Only revisit the verifier if the generated ECOs expose a real compatibility issue.

---

### Task 1: Remove Audience Segmentation From Landing

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the segmented decision block copy**

In `index.html`, update the `#paths` section so it does not label users by role. Replace the two card headings and eyebrow text with direct product actions:

```html
<div class="decision-grid">
  <div class="card primary-path">
    <span class="eyebrow">Start here</span>
    <h3>Run the interactive sandbox</h3>
    <p>Generate clean runs, trigger a prompt-injection warning, apply memory tamper, and verify the resulting ECO artifacts in the browser.</p>
    <ul class="action-list">
      <li>No account, backend, or live search required</li>
      <li>Every run can produce a downloadable ECO</li>
      <li>The verifier checks the evidence independently</li>
    </ul>
  </div>
  <div class="card">
    <span class="eyebrow">Go deeper</span>
    <h3>Install and reproduce locally</h3>
    <p>Run the same integrity flow from the repository scripts, then export and verify the generated evidence on your own machine.</p>
    <ul class="action-list">
      <li>Uses concrete repo scripts</li>
      <li>Keeps the verifier as the independent endpoint</li>
      <li>Runs local-first with no backend trust requirement</li>
    </ul>
  </div>
</div>
```

- [ ] **Step 2: Adjust the local section sentence**

Replace the sentence that refers to developers and technical reviewers:

```html
<p class="section-lead">
  The browser sandbox is the fastest way to understand the flow. The local path lets anyone reproduce the same sequence from the repository scripts without trusting the landing page.
</p>
```

- [ ] **Step 3: Verify no segmentation copy remains**

Run:

```bash
rg -n "For judges|For developers|judges|developers|technical reviewers" index.html
```

Expected: no matches.

- [ ] **Step 4: Commit landing copy update**

```bash
git add index.html
git commit -m "docs: simplify sandbox landing audience copy"
```

---

### Task 2: Replace Static-First Sandbox With Interactive Console

**Files:**
- Modify: `sandbox/index.html`

- [ ] **Step 1: Replace the hero copy**

Change the sandbox hero so it describes a playable controlled demo:

```html
<span class="tag">Interactive controlled sandbox</span>
<h1>Run the agent flow, then verify the evidence.</h1>
<p class="lead">
  This sandbox uses controlled placeholder results to demonstrate the integrity flow. Run clean cycles, trigger a prompt-injection warning, apply memory tamper, and verify any generated ECO artifact in the browser.
</p>
```

- [ ] **Step 2: Add the console section before the existing flow**

Insert a new section after the header:

```html
<section id="console" class="console-section">
  <p class="kicker">Interactive sandbox</p>
  <h2>Run controlled agent cycles.</h2>
  <div class="console-layout">
    <div class="console-panel">
      <label class="field-label" for="intent">Intent</label>
      <textarea id="intent" rows="3">Find public AI infrastructure programs that match a small research team.</textarea>
      <div class="button-row">
        <button class="btn primary" id="runClean" type="button">Run</button>
        <button class="btn ghost" id="runInjection" type="button">Run with prompt injection</button>
        <button class="btn danger" id="applyTamper" type="button">Apply memory tamper</button>
        <button class="btn ghost" id="resetSandbox" type="button">Reset</button>
      </div>
    </div>
    <div class="status-panel">
      <div class="status-card"><span>Runs</span><strong id="runCount">0</strong></div>
      <div class="status-card"><span>Memory</span><strong id="memoryState">VERIFIED</strong></div>
      <div class="status-card"><span>Content</span><strong id="contentRisk">CLEAN</strong></div>
      <div class="status-card"><span>Decision</span><strong id="decisionState">IDLE</strong></div>
    </div>
  </div>
  <div class="console-layout secondary">
    <div class="console-panel">
      <h3>Live timeline</h3>
      <div id="timeline" class="timeline-list"></div>
    </div>
    <div class="console-panel">
      <h3>Latest result</h3>
      <div id="latestResult" class="result-box">No run yet.</div>
    </div>
  </div>
  <div class="console-panel">
    <h3>Run history</h3>
    <div id="runHistory" class="run-history"></div>
  </div>
</section>
```

- [ ] **Step 3: Add required CSS classes**

Add these styles to the existing `<style>` block:

```css
.console-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(16rem, .8fr); gap: 1rem; align-items: start; }
.console-layout.secondary { margin-top: 1rem; grid-template-columns: 1fr 1fr; }
@media (max-width: 820px) { .console-layout, .console-layout.secondary { grid-template-columns: 1fr; } }
.console-panel, .status-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 1rem; }
.field-label { display: block; font-size: .78rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: .45rem; }
textarea { width: 100%; resize: vertical; border: 1px solid var(--line); border-radius: 10px; padding: .8rem; background: var(--bg); color: var(--ink); font: inherit; }
.button-row { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: .8rem; }
button.btn { border: 0; cursor: pointer; font: inherit; }
.btn.danger { background: var(--bad-soft); color: var(--bad); border: 1px solid var(--bad); }
.status-panel { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; }
.status-card { border: 1px solid var(--line); border-radius: 10px; padding: .75rem; background: var(--bg); }
.status-card span { display: block; color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; }
.status-card strong { display: block; margin-top: .25rem; font-size: 1rem; overflow-wrap: anywhere; }
.timeline-list, .run-history { display: grid; gap: .55rem; }
.timeline-item, .run-item { border: 1px solid var(--line); border-radius: 10px; padding: .7rem .8rem; background: var(--bg); }
.timeline-item.warn, .run-item.warn { border-color: var(--warn); background: var(--warn-soft); }
.timeline-item.bad, .run-item.bad { border-color: var(--bad); background: var(--bad-soft); }
.timeline-item.good, .run-item.good { border-color: var(--good); background: var(--good-soft); }
.result-box { min-height: 7rem; color: var(--muted); }
.run-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .65rem; }
```

- [ ] **Step 4: Verify layout compiles as static HTML**

Open `sandbox/index.html` in a browser or serve the repo root:

```bash
python3 -m http.server 4190 --bind 127.0.0.1
```

Expected: page renders with the new console above the existing walkthrough.

---

### Task 3: Implement Client-Side Run State

**Files:**
- Modify: `sandbox/index.html`

- [ ] **Step 1: Add state and sample data script**

Before `</body>`, add:

```html
<script>
(() => {
  const sampleResults = [
    "Found 5 public AI infrastructure programs matching the intent.",
    "Shortlisted 4 vendor profiles that match the policy constraints.",
    "Returned 6 public research opportunities with evidence notes.",
    "Found 3 partner programs and 2 grant-like opportunities for review."
  ];

  const state = {
    runCount: 0,
    tamperPending: false,
    runs: [],
    lastRisk: "CLEAN"
  };

  const $ = (id) => document.getElementById(id);
  const nowIso = () => new Date().toISOString();

  function setStatus(memory, risk, decision) {
    $("runCount").textContent = String(state.runCount);
    $("memoryState").textContent = memory;
    $("contentRisk").textContent = risk;
    $("decisionState").textContent = decision;
  }

  function addTimeline(message, tone = "") {
    const node = document.createElement("div");
    node.className = `timeline-item ${tone}`.trim();
    node.textContent = message;
    $("timeline").prepend(node);
  }

  function resetSandbox() {
    state.runCount = 0;
    state.tamperPending = false;
    state.runs = [];
    state.lastRisk = "CLEAN";
    $("timeline").innerHTML = "";
    $("runHistory").innerHTML = "";
    $("latestResult").textContent = "No run yet.";
    setStatus("VERIFIED", "CLEAN", "IDLE");
    addTimeline("Sandbox reset. Memory is verified.", "good");
  }

  window.VMCPSandbox = { state, sampleResults, setStatus, addTimeline, resetSandbox, nowIso };
  resetSandbox();
})();
</script>
```

- [ ] **Step 2: Check no runtime errors**

Open browser devtools on the sandbox page.

Expected: no `Cannot read properties of null` errors.

---

### Task 4: Generate Verifiable ECO Artifacts in Browser

**Files:**
- Modify: `sandbox/index.html`

- [ ] **Step 1: Add WebCrypto helpers**

Append inside the existing sandbox script:

```js
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalEntry(contentHash, prevHash, createdAt) {
  return JSON.stringify({ contentHash, prevHash: prevHash ?? null, createdAt });
}
```

- [ ] **Step 2: Add bundle creation**

Append inside the sandbox script:

```js
async function createEntry(id, content, tags, prevHash) {
  const createdAt = nowIso();
  const contentHash = await sha256Hex(content);
  const entryHash = await sha256Hex(canonicalEntry(contentHash, prevHash, createdAt));
  return { id, createdAt, content, tags, contentHash, prevHash: prevHash ?? null, entryHash };
}

async function createBundle(run) {
  const entries = [];
  let prevHash = null;
  const base = [
    [`run_${run.number}_intent`, `Intent: ${run.intent}`, ["sandbox", "intent"]],
    [`run_${run.number}_decision`, `Decision: ${run.decision}; memory=${run.memory}; risk=${run.contentRisk}`, ["sandbox", "decision"]],
    [`run_${run.number}_result`, `Result: ${run.summary}`, ["sandbox", "result"]]
  ];
  for (const [id, content, tags] of base) {
    const entry = await createEntry(id, content, tags, prevHash);
    entries.push(entry);
    prevHash = entry.entryHash;
  }
  return {
    format: "verifiable-memory-bundle",
    version: "0.1",
    exportedAt: nowIso(),
    entries
  };
}
```

- [ ] **Step 3: Add ECO creation**

Append inside the sandbox script:

```js
async function createEco(run) {
  const bundle = await createBundle(run);
  const bundleText = JSON.stringify(bundle, null, 2);
  const bundleHash = await sha256Hex(bundleText);
  return {
    eco_version: "eco.v0.2",
    format: "eco.evidence-artifact",
    version: "0.1",
    origin_app: "verifiable-memory-mcp-sandbox",
    artifact_id: `sandbox_run_${run.number}_${bundleHash.slice(0, 12)}`,
    artifact_type: run.decision === "STOP_BY_INTEGRITY" ? "incident" : "run",
    lifecycle: run.decision === "STOP_BY_INTEGRITY" ? "INCIDENT" : "NORMAL",
    manifest: {
      runNumber: run.number,
      decision: run.decision,
      memory: run.memory,
      contentRisk: run.contentRisk,
      status: run.status,
      createdAt: run.createdAt
    },
    report: run.report,
    verification: {
      integrity: run.memory,
      lifecycle: run.decision === "STOP_BY_INTEGRITY" ? "INCIDENT" : "NORMAL",
      bundleHash
    },
    anchor: {
      algorithm: "sha256",
      bundleHash
    },
    bundleText
  };
}
```

- [ ] **Step 4: Verify generated ECO shape manually**

In browser console after one run:

```js
VMCPSandbox.state.runs[0].eco.format
VMCPSandbox.state.runs[0].eco.bundleText.includes("verifiable-memory-bundle")
```

Expected: `eco.evidence-artifact` and `true`.

---

### Task 5: Implement Run, Prompt Injection, Tamper, and Reset

**Files:**
- Modify: `sandbox/index.html`

- [ ] **Step 1: Add run creation**

Append inside the sandbox script:

```js
async function createRun(mode) {
  const intent = $("intent").value.trim() || "Find public AI infrastructure programs.";
  state.runCount += 1;
  const number = state.runCount;
  const createdAt = nowIso();

  let run;
  if (state.tamperPending) {
    const risk = mode === "injection" ? "SUSPICIOUS" : "UNREVIEWED";
    run = {
      number,
      intent,
      createdAt,
      memory: "TAMPERED",
      contentRisk: risk,
      decision: "STOP_BY_INTEGRITY",
      status: "STOPPED",
      summary: "No results returned. Memory integrity failed before action.",
      report: "The placeholder agent stopped before action because memory was altered outside the approved flow."
    };
    state.tamperPending = false;
    addTimeline(`Run #${number}: stopped before action because memory integrity failed.`, "bad");
  } else if (mode === "injection") {
    run = {
      number,
      intent,
      createdAt,
      memory: "VERIFIED",
      contentRisk: "SUSPICIOUS",
      decision: "EXECUTE_WITH_WARNING",
      status: "COMPLETED_WITH_WARNING",
      summary: sampleResults[number % sampleResults.length],
      report: "Prompt injection-like content was detected in the controlled input. Execution continued with a warning because memory integrity remained verified."
    };
    addTimeline(`Run #${number}: prompt injection warning detected; execution continued.`, "warn");
  } else {
    run = {
      number,
      intent,
      createdAt,
      memory: "VERIFIED",
      contentRisk: "CLEAN",
      decision: "EXECUTE",
      status: "COMPLETED",
      summary: sampleResults[number % sampleResults.length],
      report: "Clean controlled run completed with verified memory and no content warning."
    };
    addTimeline(`Run #${number}: completed with verified memory.`, "good");
  }

  run.eco = await createEco(run);
  state.runs.unshift(run);
  renderRun(run);
  setStatus(run.memory, run.contentRisk, run.decision);
}
```

- [ ] **Step 2: Add tamper behavior**

Append inside the sandbox script:

```js
function applyTamper() {
  state.tamperPending = true;
  setStatus("PENDING_TAMPER_CHECK", state.lastRisk, "WAITING_FOR_NEXT_RUN");
  addTimeline("Memory changed outside the approved flow. The next run must verify before acting.", "warn");
}
```

- [ ] **Step 3: Wire buttons**

Append inside the sandbox script:

```js
$("runClean").addEventListener("click", () => createRun("clean"));
$("runInjection").addEventListener("click", () => createRun("injection"));
$("applyTamper").addEventListener("click", applyTamper);
$("resetSandbox").addEventListener("click", resetSandbox);
```

- [ ] **Step 4: Manual behavior check**

In browser:

1. Click `Run`.
2. Click `Run with prompt injection`.
3. Click `Apply memory tamper`.
4. Click `Run`.

Expected:

- first run status is `EXECUTE`
- second run status is `EXECUTE_WITH_WARNING`
- tamper does not immediately create a run
- fourth action creates `STOP_BY_INTEGRITY`

---

### Task 6: Render Run History and ECO Actions

**Files:**
- Modify: `sandbox/index.html`

- [ ] **Step 1: Add download and verifier helpers**

Append inside the sandbox script:

```js
function ecoJson(run) {
  return JSON.stringify(run.eco, null, 2);
}

function downloadEco(run) {
  const blob = new Blob([ecoJson(run)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sandbox-run-${run.number}-${run.decision}.eco`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openInVerifier(run) {
  const blob = new Blob([ecoJson(run)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const verifier = new URL("../verifier/index.html", location.href);
  verifier.searchParams.set("eco", url);
  window.open(verifier.toString(), "_blank", "noopener");
}
```

- [ ] **Step 2: Add run rendering**

Append inside the sandbox script:

```js
function renderRun(run) {
  $("latestResult").innerHTML = `
    <strong>Run #${run.number}: ${run.decision}</strong><br>
    <span>${run.summary}</span><br>
    <span class="mono">memory=${run.memory}; risk=${run.contentRisk}</span>
  `;

  const item = document.createElement("div");
  const tone = run.decision === "STOP_BY_INTEGRITY" ? "bad" : run.contentRisk === "SUSPICIOUS" ? "warn" : "good";
  item.className = `run-item ${tone}`;
  item.innerHTML = `
    <strong>Run #${run.number}: ${run.decision}</strong>
    <div class="meta-list">
      <div><strong>Memory:</strong> ${run.memory}</div>
      <div><strong>Content:</strong> ${run.contentRisk}</div>
      <div><strong>Status:</strong> ${run.status}</div>
    </div>
    <div class="run-actions">
      <button class="link-chip" type="button" data-action="download">Download ECO</button>
      <button class="link-chip" type="button" data-action="verify">Open in verifier</button>
    </div>
  `;
  item.querySelector('[data-action="download"]').addEventListener("click", () => downloadEco(run));
  item.querySelector('[data-action="verify"]').addEventListener("click", () => openInVerifier(run));
  $("runHistory").prepend(item);
}
```

- [ ] **Step 3: Verify ten clean runs**

In browser:

1. Click `Reset`.
2. Click `Run` ten times.

Expected:

- `Runs` shows `10`.
- Run history contains ten entries.
- Each entry shows `Memory: VERIFIED`.
- Each entry has `Download ECO` and `Open in verifier`.

---

### Task 7: Keep Static Artifact Walkthrough Below the Console

**Files:**
- Modify: `sandbox/index.html`

- [ ] **Step 1: Rename the existing scenario section**

Change:

```html
<p class="kicker">Scenarios</p>
<h2>Walk through the real artifacts.</h2>
```

To:

```html
<p class="kicker">Published artifacts</p>
<h2>Compare against pre-generated ECO evidence.</h2>
```

- [ ] **Step 2: Clarify relationship between interactive and static evidence**

Replace the scenario section lead with:

```html
<p class="section-lead">
  The console above generates fresh ECO artifacts in your browser. These published ECO files are kept as stable examples from the repository history.
</p>
```

- [ ] **Step 3: Verify both flows are visible**

Open `sandbox/index.html`.

Expected:

- interactive console appears first
- published artifacts appear below it
- local install section remains below the artifacts

---

### Task 8: Validate Generated ECOs With Existing Verifier

**Files:**
- Manual verification against `sandbox/index.html` and `verifier/index.html`

- [ ] **Step 1: Verify clean run ECO**

1. Open `sandbox/index.html`.
2. Click `Run`.
3. Click `Open in verifier` on the generated run.

Expected:

- verifier loads
- verdict is green/verified
- manifest shows `decision = EXECUTE`

- [ ] **Step 2: Verify prompt injection ECO**

1. Return to sandbox.
2. Click `Run with prompt injection`.
3. Click `Open in verifier`.

Expected:

- verifier loads
- verdict is green/verified
- manifest or details include `EXECUTE_WITH_WARNING` and `SUSPICIOUS`

- [ ] **Step 3: Verify tamper stop ECO**

1. Return to sandbox.
2. Click `Apply memory tamper`.
3. Click `Run`.
4. Click `Open in verifier`.

Expected:

- verifier loads
- verdict is green/verified for the artifact integrity
- manifest or details include `STOP_BY_INTEGRITY` and `TAMPERED`

- [ ] **Step 4: Commit implementation**

```bash
git add index.html sandbox/index.html
git commit -m "feat: add interactive sandbox ECO flow"
```

---

## Self-Review

Spec coverage:

- Existing `sandbox/index.html` remains the only sandbox page.
- The console supports repeated clean runs.
- Prompt injection warns but does not stop.
- Tamper stops the next run.
- Each run generates a downloadable ECO.
- Each run can open in the existing verifier.
- Static artifact walkthrough remains on the same page as supporting evidence.
- Landing audience segmentation is removed.

No placeholders:

- The plan contains concrete file paths, commands, snippets, and expected outputs.

Type consistency:

- Run fields are consistently named `number`, `intent`, `createdAt`, `memory`, `contentRisk`, `decision`, `status`, `summary`, `report`, and `eco`.
- ECO fields are consistently named `format`, `origin_app`, `artifact_type`, `lifecycle`, `manifest`, `verification`, `anchor`, and `bundleText`.
