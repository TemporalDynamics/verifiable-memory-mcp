# verifiable-memory-mcp

**Local-first, append-only, tamper-evident memory for AI agents.**

`verifiable-memory-mcp` is an MCP server for storing agent memory as a verifiable hash chain.

Every entry is immutable, timestamped, cryptographically linked to the previous one, and exportable as portable evidence.

This repository is a **public, focused implementation** of one idea: agent memory should not only be useful, it should also be inspectable and tamper-evident.

It is not presented as a full agent operating system, a full memory architecture, or a complete governance layer. It is a narrow, practical building block that demonstrates a specific capability clearly.

## Why this exists

AI agents accumulate memory over time:

- decisions,
- operator notes,
- reminders,
- constraints,
- context,
- and historical records of what mattered.

In most systems, that memory is optimized for retrieval, not integrity.

Files get edited. Context drifts. Records are overwritten. Explanations come after the fact.

This project takes a different angle:

**before asking whether an agent remembers well, ask whether its memory can be checked.**

## What it does

This server gives an MCP-compatible client a local memory store with:

- append-only writes,
- per-entry hashing,
- chain integrity verification,
- chronological inspection,
- portable export,
- a browser-based bundle verifier.

The result is simple:

you can later verify whether what the agent “remembers” is still what was originally stored.

## What it is not

This is **not**:

- a vector database,
- a semantic memory system,
- a long-context reasoning engine,
- an enterprise audit platform,
- or a complete agent governance framework.

It does not try to solve everything.

It focuses on one narrow property:

**memory integrity.**

## Core idea

Each memory entry creates hashes that bind content, timestamp, and position in a chain.

```text
contentHash = sha256(content)
entryHash   = sha256({ contentHash, prevHash, createdAt })
```

- `contentHash` checks the stored content itself
- `prevHash` links the entry to the previous entry
- `entryHash` checks the integrity of the whole record in context

If someone edits an entry directly, the content hash no longer matches.
If someone inserts, removes, or reorders entries, the chain breaks.

## Available tools

| Tool | Description |
|---|---|
| `remember` | Store a new memory entry (append-only, hash-chained) |
| `recall` | Search memories by text content |
| `verify` | Recompute hashes and confirm an entry has not been altered |
| `chain` | Validate the full chain and detect breaks or reordering |
| `timeline` | List memories chronologically, optionally filtered by tag |
| `export` | Export a portable, verifiable JSON bundle |

## Evidence packages and verifier

The primary evidence artifact is a portable `.eco` package. The verifier link or QR is only a fast way to open that package.

Each `.eco` file is a JSON evidence envelope with:

- `bundleText`: the exact exported `verifiable-memory-bundle`,
- `anchor.bundleHash`: the SHA-256 hash of that bundle,
- `manifest`: agent, cycle, decision, memory status, failed entry, and timestamp,
- `report`: a human-readable explanation of what happened.

The demo writes packages to:

```text
demo/evidence/
```

Examples:

```text
000_IDLE.eco
001_EXECUTE.eco
003_WAIT_FOR_OWNER.eco
005_STOP_BY_INTEGRITY.eco
latest.eco
```

This repository also includes a static verifier at:

```text
verifier/index.html
```

It verifies `.eco` packages and exported `verifiable-memory-bundle` files entirely in the browser. It checks entry content hashes, entry hashes, chain links, and optionally a SHA-256 anchor for the exact exported file.

For a local demo:

```bash
npm run demo:export
npm run demo:publish-local
```

Then open the `.eco` verifier URL printed by `demo:export`, or load:

```text
demo/evidence/latest.eco
```

Standalone verifier mode is also available:

```bash
npm run demo:verifier
```

If the package was exported before tampering, the verifier should show `INTACT`. If it was exported after direct SQLite tampering, it should show `ALTERED`.

`demo:publish-local` serves the dashboard, verifier, and `.eco` files from one local origin. That makes this URL shape work for QR codes or another device on the same network:

```text
http://<your-local-ip>:4190/verifier/index.html?eco=/evidence/latest.eco
```

To share a public verifier URL, set `DEMO_PUBLIC_BASE_URL` before exporting:

```bash
export DEMO_PUBLIC_BASE_URL=https://demo.example.com
npm run demo:export
```

The export script will print both the local and the public verifier URLs.

**Phone/external device verification** requires HTTPS for browser Web Crypto APIs. For judge or investor demos, use an HTTPS domain, a tunnel (ngrok, cloudflared), or drag-and-drop the `.eco` file into the standalone verifier as the reliable fallback.

## Why MCP

This project is designed for the Model Context Protocol so that memory integrity can be exposed as a tool, not buried as an implementation detail.

That matters because it lets an agent:

- write memory,
- inspect memory,
- verify memory,
- and export memory evidence

through the same tool interface it uses for the rest of its work.

## Example

```text
Remember: The deployment strategy prioritizes Europe over Asia for Q3.
✓ remembered (mem_a1b2c3d4)

Recall deployment strategy
Found 1 entry

Verify mem_a1b2c3d4
✓ Entry is intact and chain-verified
```

## Install

```bash
npm install -g verifiable-memory-mcp
```

Requires Node.js 18+.

## MCP client config

```json
{
  "mcpServers": {
    "verifiable-memory-mcp": {
      "command": "npx",
      "args": ["-y", "verifiable-memory-mcp"]
    }
  }
}
```

## Direct usage

```bash
npx verifiable-memory-mcp
```

For testing with JSON-RPC:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"remember","arguments":{"content":"test decision","tags":["test"]}}}' \
  | npx verifiable-memory-mcp
```

## MCP Inspector

```bash
npx -y @modelcontextprotocol/inspector npx -y verifiable-memory-mcp
```

## Tool examples

**remember**

```json
{
  "content": "The deployment targets Europe for Q3",
  "tags": ["strategy", "deployment"]
}
```

**recall**

```json
{
  "query": "deployment"
}
```

**timeline**

```json
{
  "includeContent": true
}
```

**verify**

```json
{
  "id": "mem_a1b2c3d4"
}
```

**chain**

```json
{}
```

**export**

```json
{}
```

## Storage

Data is stored locally in:

```text
~/.verifiable-memory-mcp/memory.db
```

SQLite, WAL mode. No cloud. No telemetry. No login.

Override the data directory with:

```bash
VMCP_DATA_DIR=/tmp/vmcp-demo npx -y verifiable-memory-mcp
```

## Demo flow

The end-to-end demo is sandbox-only by default:

```bash
npm run demo:e2e
```

This uses `/tmp/vmcp-agent-demo` and never exports `~/.verifiable-memory-mcp`
unless you explicitly opt into real data elsewhere.

For a step-by-step recording flow:

```bash
export VMCP_DATA_DIR=/tmp/transparent-agent-demo
npm run demo:scenario:reset
npm run demo:cycle
npm run demo:owner-update
npm run demo:cycle
npm run demo:prompt-injection
npm run demo:cycle
npm run demo:owner-approve
npm run demo:cycle
npm run demo:tamper
npm run demo:cycle-after-tamper
npm run demo:export
npm run demo:publish-local
```

## Telegram demo control

The demo can also be controlled through a Telegram bot. It only accepts a fixed set of demo commands and runs the same local scripts as the terminal flow.

Required environment:

```bash
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...
export VMCP_DATA_DIR=/tmp/transparent-agent-demo
export DEMO_PUBLIC_BASE_URL=http://<your-local-ip>:4190
npm run demo:telegram
```

Available bot commands:

```text
/ready
/cycle
/owner_update
/prompt_injection
/approve
/reject
/tamper
/export
/eco
/status
/help
```

## Search behavior

`recall` currently uses text-based retrieval, not embeddings.

That is a deliberate choice in this version.

This project is not competing on semantic recall quality. It is competing on whether memory can later be checked and exported in a verifiable way.

If you work across languages, bilingual entries or bilingual tags improve recall quality.

## Comparison

| Feature | Vector DBs | Typical memory layers | verifiable-memory-mcp |
|---|---|---|---|
| Primary goal | Retrieval | Convenience | Integrity |
| Search | Semantic | Mixed | Text |
| Append-only | Usually no | Sometimes | **Yes** |
| Chain verification | No | Rarely | **Yes** |
| Local-first | Sometimes | Sometimes | **Yes** |
| MCP-native | Varies | Varies | **Yes** |

## Part of a broader evidence ecosystem

This public integrity layer is one focused building block inside a wider architecture for governed AI, portable evidence, and independent verification.

These are not separate product claims. They are different places where the same underlying need shows up: a claim about information is only trustworthy if it can be checked against the record it came from, not just taken on faith. VMMCP and Talo apply this where agents act on memory. EcoSign and CustodyArt apply it where documents and creative assets need provenance. WITH/WIT applies it to personal memory — answers link back to the records that support them.

## Applied workflow proof

Beyond the sandbox, this pattern is being validated inside a full recruiting application workflow: verifying memory before action, pausing for owner approval, and stopping when integrity fails. A demo video will be published here once recorded.

The recording will show external candidate documents, owner approval, evidence generation, and stop-by-integrity behavior in a real operational flow. Until it's published, the sandbox above remains the reproducible way to evaluate the pattern directly.

### [AppCrew](https://github.com/TemporalDynamics/AppCrew)

Observable runtime for governed AI agents.

AppCrew is the reusable runtime layer around agent execution: run state, timelines, approval gates, and evidence hooks. VMMCP is the integrity layer that can be attached when memory must be verified before action.

### Applied recruiting workflow

Vertical validation for recruiting agents.

The same control pattern is being validated inside a real recruiting workflow: external candidate documents, approval gates, evidence trails, and integrity failure handling. A demo video will be published here; until then, the public sandbox is the way to evaluate the pattern directly.

### [Portable ECO verification](https://temporaldynamics.github.io/verifiable-memory-mcp/verifier/)

Independent verification for ECO evidence artifacts.

The goal is portability: evidence should be re-checkable outside the original system, so verification can remain credible across workflows, devices, and operators.

### [EcoSign](https://github.com/TemporalDynamics/ecosign-public)

Evidence and verification workflows for digital documents.

EcoSign applies an evidence-first approach to document integrity, export, and independent verification in document-centered workflows.

### CustodyArt

Provenance and custody for creative digital assets.

CustodyArt applies custody and evidence discipline to artworks and digital cultural assets, where provenance and traceability matter over time.

### WITH / WIT

Deterministic semantic memory layer.

WITH/WIT applies the same evidence-first principle to human memory: the system can retrieve an answer and show the records that support it. The core remains private; a related public surface is [with-typing](https://github.com/TemporalDynamics/with-typing).

## Security / threat model

- **Tamper detection**: `verify()` detects altered entry content. `chain()` detects broken links, removals, and reordering.
- **No encryption**: the SQLite database is stored in plaintext.
- **No access control**: anyone with filesystem access can read the database.
- **No cloud**: the server does not send data to external services.
- **Not a hardened audit appliance**: if an attacker fully controls the machine, this tool does not guarantee safety.

This project helps detect memory changes.
It does not guarantee system compromise resistance.

## Positioning

The best way to understand this repository is:

**a public, concrete demonstration that agent memory can be append-only, inspectable, and tamper-evident through MCP.**

It is intentionally narrower than the broader architectural questions it points toward.

## Strategy docs

- [Transparent Agent Evidence](docs/strategy/transparent-agent-evidence.md)
- [ECO and ECOX Model](docs/strategy/eco-and-ecox-model.md)
- [ECO Verifier Universal Model](docs/strategy/eco-verifier-universal.md)

## License

MIT
