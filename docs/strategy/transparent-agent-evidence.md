# Transparent Agent Evidence

Transparent Agent Evidence is a demo flow for agents that operate under verifiable memory.

The agent does not invent its own trust method. The owner connects a Verifiable Memory MCP server that provides operating memory made of Policy, Ledger, and Authority.

The agent verifies memory before acting. If memory and authority are clean, it executes. If external content requests a sensitive action, the agent pauses for owner review. If the memory store is changed outside the authorized append-only flow, the agent stops and emits an evidence artifact.

Every meaningful run state produces an ECO artifact.

The dashboard shows the operation. The ECO preserves the evidence. The verifier lets anyone check that evidence without trusting the agent, the dashboard, or the operator machine.
