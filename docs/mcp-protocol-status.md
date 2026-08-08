# MCP protocol status

Tracks what protocol revision `verifiable-memory-mcp` actually speaks, as verified
against the running server — not inferred from the SDK version or from upstream
announcements.

## Current state (2026-08-07)

| Question | Answer |
|---|---|
| MCP TypeScript SDK dependency current? | **Yes** — `@modelcontextprotocol/sdk@1.30.0` |
| Compatible with existing handshake-based clients (e.g. Talo's `vmcp_client.py`)? | **Yes** — tested, unchanged behavior |
| Implements MCP `2026-07-28` (stateless core)? | **No** — tested, confirmed absent |

## Evidence

- `npm run build`, `npm test` (23/23), and `node verifier/acceptance.mjs` (36/36) all
  pass on `@modelcontextprotocol/sdk@1.30.0`.
- Sending `initialize` with `protocolVersion: "2024-11-05"` — the exact handshake Talo
  sends today — against the server built on 1.30.0 works unchanged: server echoes
  `protocolVersion: "2024-11-05"`, `tools/list` responds normally.
- Sending `server/discover` (the RPC the `2026-07-28` spec makes mandatory) returns
  `-32601 Method not found`.
- The installed SDK's own constants confirm why:
  ```
  LATEST_PROTOCOL_VERSION = '2025-11-25'
  SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']
  ```
  The SDK's `Server`/`StdioServerTransport` classes still implement the
  handshake/session model. `2026-07-28` removed `initialize`/`notifications/initialized`
  entirely in favor of a stateless, per-request `_meta`-based model — that's not
  exposed by this SDK version yet.

## Gate

**MCP `2026-07-28` migration: pending until the TypeScript SDK that VMMCP consumes
exposes the stateless protocol** (`server/discover`, self-describing requests, no
initialize/session). Re-run the probe in this doc against each new SDK release; move
this row to "Yes" only when `server/discover` actually responds.

Do not hand-implement the stateless model against raw JSON-RPC in the meantime unless
there's a concrete, named need. That would repeat the exact pattern this repo exists to
avoid on the Talo side: a local reimplementation of a primitive that should live in the
canonical layer (here, the SDK).

## Separate, scoped, not urgent

`npm audit` reports 9 transitive vulnerabilities (2 low, 2 moderate, 5 high), all in
`@modelcontextprotocol/sdk`'s HTTP-transport dependencies (`hono`, `express`,
`body-parser`, `qs`, `ip-address`, `nanoid`, `fast-uri`, `esbuild`, `postcss`). This
server only uses `StdioServerTransport` — that HTTP code path is never instantiated.
Needs a reachability check before treating it as a real risk, not just a severity
count. Track as its own task.
