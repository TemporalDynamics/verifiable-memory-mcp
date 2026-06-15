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
- portable export.

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

## License

MIT
