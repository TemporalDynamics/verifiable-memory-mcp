# verifiable-memory-mcp

**Local-first, append-only, tamper-evident memory for AI agents.**

An MCP server that stores agent memory as a verifiable hash chain. Every entry is immutable, timestamped, cryptographically hashed, and linked to the previous one. Altering any entry breaks the chain — detectably.

## Why

AI agents accumulate memory over time. Files get edited. Context gets stale. Records get overwritten.

This is not a vector database or a semantic memory palace. It is a **verifiable substrate** for agent memory: a place to store decisions, facts, and context so you can later verify nothing was silently changed.

## Tools

| Tool | Description |
|---|---|
| `remember` | Store a memory entry (append-only, hash-chained) |
| `recall` | Search memories by text content (simple LIKE + token fallback, not semantic) |
| `verify` | Recompute hashes and confirm an entry hasn't been altered |
| `chain` | View the full hash chain with integrity validation (detects breaks, reordering, tampering) |
| `timeline` | List memories chronologically, filterable by tag |
| `export` | Export a portable, verifiable JSON bundle |

## How it works

Every entry creates three hashes:

```
contentHash = sha256(content)
entryHash  = sha256({ contentHash, prevHash, createdAt })
```

- `contentHash` — integrity of the memory content
- `prevHash` — links to the previous entry (forms the chain)
- `entryHash` — integrity of the whole entry + its position in the chain

If someone edits the SQLite file directly, `contentHash` won't match.
If someone adds or removes entries, the `prevHash` chain breaks.

Content edits are detected by `verify`.
Chain breaks, removals, and reordering are detected by `chain`.

## Search behavior

`recall` currently uses text-based search, not embeddings or semantic retrieval.

It works best when your query uses the same language and keywords used in the stored memory.

If you work across languages, store bilingual entries or add bilingual tags:

```text
Remember: [RULE: PUBLIC] Do not mention internal protocol details publicly.
Evitar mencionar públicamente detalles internos del protocolo.

Tags: public, público, avoid, evitar, mention, mencionar
```

For broad inspection, use `timeline` with `includeContent: true`.

## Install

```bash
npm install -g verifiable-memory-mcp
```

Requires Node.js 18+.

## Usage with MCP clients

Add to your MCP client config:

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

### Claude CLI / OpenCode

```
> Remember: The deployment strategy prioritizes Europe over Asia for Q3.
  ✓ remembered (mem_a1b2c3d4)

> Recall deployment strategy
  Found 1 entry

> Verify mem_a1b2c3d4
  ✓ Entry is intact and chain-verified
```

### Via command line directly

```bash
# Run the MCP server in stdio mode
npx verifiable-memory-mcp
```

For testing, pipe JSON-RPC messages:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"remember","arguments":{"content":"test decision","tags":["test"]}}}' | npx verifiable-memory-mcp
```

## Testing with MCP Inspector

```bash
npx -y @modelcontextprotocol/inspector npx -y verifiable-memory-mcp
```

This opens a web UI where you can call each tool interactively.

### Tool call examples

**remember:**
```json
{
  "content": "The deployment targets Europe for Q3",
  "tags": ["strategy", "deployment"]
}
```

**recall:**
```json
{
  "query": "deployment"
}
```

**timeline** (with full content):
```json
{
  "includeContent": true
}
```

**timeline** (filtered by tag):
```json
{
  "tag": "strategy",
  "includeContent": true
}
```

**verify:**
```json
{
  "id": "mem_a1b2c3d4"
}
```

**chain:**
```json
{}
```

**export:**
```json
{}
```

## Storage

All data lives in `~/.verifiable-memory-mcp/memory.db` (SQLite, WAL mode).

No cloud. No telemetry. No login. Your memory never leaves your machine.

## Comparison

| Feature | Vector DBs | MemPalace | Verifiable Memory MCP |
|---|---|---|---|
| Storage | Vectors + chunks | SQLite + verbatim | SQLite + hash chain |
| Search | Semantic | Semantic + text | Text (LIKE) |
| Verification | No | Usually no chain verification | **Yes (hash chain)** |
| Append-only | No | Yes | **Yes + enforced by hash** |
| MCP support | Some | Yes | **Yes** |
| Cloud | Usually | Optional | **No (local-first)** |

This project does not compete on recall quality or embedding performance. It competes on **integrity**: knowing that what the agent remembers is what was actually stored.

Semantic retrieval may come later. v0.1 focuses on integrity, portability, and local verification.

## Security / Threat model

- **Tamper detection**: `verify()` detects altered entry content. `chain()` detects broken links, removals, reordering, or partial tampering.
- **No encryption**: This does not encrypt your memory. The SQLite database is stored in plaintext in `~/.verifiable-memory-mcp/`.
- **No access control**: Anyone with access to your machine can read the database. Do not store passwords, keys, tokens, credentials, or secrets here.
- **No cloud**: Data never leaves your machine. No telemetry, no login, no network calls from the MCP server.
- **Filesystem trust**: If an attacker has write access to the database, they may be able to rewrite entries and recompute hashes. This tool detects accidental edits, partial tampering, and broken chains; it is not a hardened security or audit system.

This is a tool for detecting whether local agent memory changed, not for preventing compromise of a machine.

## License

MIT
