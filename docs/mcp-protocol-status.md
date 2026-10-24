# MCP protocol status

Tracks the MCP eras that the built server actually speaks, verified with the
official TypeScript clients over the real stdio transport.

## Current state — 2026-10-23

| Client / server path | Status |
|---|---|
| Existing clients using `initialize` | Supported through the official v2 `serveStdio` legacy path |
| Clients using `server/discover` for `2026-07-28` | Supported through the official v2 `serveStdio` modern path |
| Transport | `stdio` for both eras |
| Tools | The same eight names, schemas, descriptions and annotations are registered in both paths |
| Evidence / storage | Hashing, SQLite schema, State Root and evidence contracts are unchanged by the MCP migration |
| Declared Node minimum | Node `>=22`; validated on Node `22.22.3` |

The executable uses `@modelcontextprotocol/server@2.4.0`. The v2 SDK's
`serveStdio(factory)` owns era selection and pins one factory-created server
instance for the connection. The application does not hand-implement protocol
negotiation. The package retains `@modelcontextprotocol/sdk@1.32.2` and
`@modelcontextprotocol/client@2.4.0` as development-only dependencies for
compatibility tests; they are not runtime dependencies of the published tarball.

## Verification performed

- Legacy path: the official v1 client connects with `initialize`, lists all
  eight tools, and exercises the existing stdio integration coverage.
- Modern path: the official v2 client pins negotiation to `2026-07-28`,
  receives protocol era `modern`, discovers all eight tools, and calls each
  tool over stdio.
- Integrity negative path: after a real tool call stores an entry, the test
  alters its SQLite content and confirms `verify` reports `valid: false` and
  `recall` marks `content_mismatch` under the modern protocol. `recall` reports
  compromised entries for inspection; it does not reject or hide them.
- Modern error paths: schema-invalid arguments produce the SDK's input
  validation tool error; an unknown tool is rejected by the SDK. A stale
  `append_if_verified_head` returns `conflict`, and a subsequent verified
  snapshot confirms the chain was not extended.
- The same legacy and modern client tests pass against an installed
  `verifiable-memory-mcp-0.3.0.tgz`, not only the source checkout.
- MCP clients successfully parse and complete these stdio exchanges. Any
  non-protocol text written to stdout would corrupt those exchanges; diagnostic
  output is routed to stderr.

## Observable protocol differences

- Legacy clients continue to start with `initialize` and use the 2025-era
  handshake semantics. Their tool names and input contracts remain the same.
- Modern clients explicitly negotiate with `server/discover` and use the
  `2026-07-28` request model. This is a protocol-era difference handled by the
  SDK; the application tool catalog and business handlers are shared.
- Error details differ for malformed `tools/call` requests: the v2
  `McpServer` validates arguments against the advertised schema before running
  a handler, and rejects unknown tools before the application callback. The
  old low-level v1 handler instead returned its own `Unknown tool` result and
  passed malformed arguments to the handler. These are SDK-boundary behavior
  differences; registered tools, normal responses and application-level
  conflicts retain their contracts.
- `serveStdio` constructs a server instance for the selected era. There is one
  VMMCP executable and one tool implementation/catalog, rather than separate
  products or duplicated tool handlers.

## Release boundary

The local branch prepares version `0.3.0`. Compatibility has been exercised
against both client generations and the packed tarball. Node `22.22.3` is the
validated runtime; Node 26 support is not claimed. The version has not been
published. Do not infer npm publication or deployment from these local results.
