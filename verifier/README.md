# Bundle Verifier (static, client-side)

A single self-contained HTML page that verifies the integrity of a
`verifiable-memory-bundle` export — entirely in the browser. No backend, no
build step, no external dependencies. Once loaded, it works offline. Nothing
is sent to any server.

## What it checks

For every entry, in chain order (exact replica of `src/tools/chain.ts`):

1. `contentHash` — recomputed SHA-256 of `content`.
2. `entryHash` — recomputed SHA-256 of the canonical
   `JSON.stringify({contentHash, prevHash, createdAt})` (key order matters).
3. `prevHash` — must equal the previous entry's `entryHash`.

For a raw bundle, the optional external hash is SHA-256 of the exact uploaded
file bytes. For an ECO artifact, the optional external hash is SHA-256 of the
UTF-8 bytes of its `bundleText` string. Enter it in the **trusted external
hash** field or pass it as `?anchor=<sha256hex>`. The value must have been
obtained through a trusted channel outside the ECO. The ECO's own
`anchor.bundleHash` is a declaration inside that package, not an independent
trust root.

Without an externally supplied hash, the verifier can check internal content
hashes, entry hashes, and links. A coherent replacement bundle with recomputed
hashes can therefore remain internally consistent. Historical authenticity
cannot be established in that case.

For ECO files, `authority_summary`, `policy_summary`, `manifest`,
`report`, `verification`, `origin_app`, `packageHash`, and other outer
fields are displayed as declared, unauthenticated metadata. The verifier
computes bundle integrity itself and never treats `verification.integrity`
from the ECO as its result.

Results distinguish internal consistency from an external comparison. A
matching externally supplied hash is shown as an external match; without one,
the bundle is shown as internally consistent with historical authenticity
unestablished. An inconsistent chain or external-hash mismatch is shown as
altered. Unreadable files or malformed hashes produce a neutral error.

## Usage

- Serve `index.html` over `https://` or `http://localhost` (WebCrypto
  requires a secure context), or open it from any static host.
- Load a bundle via file picker, drag & drop, or `?bundle=<url>`.
- Optional: paste the trusted external hash of the uploaded bundle bytes, or
  for an ECO the UTF-8 bytes of `bundleText`; alternatively pass
  `?anchor=<sha256hex>`. Do not use the ECO's internal anchor as an
  independently trusted value.
- UI is bilingual (ES/EN toggle).

Generate a bundle with the `export` tool of the MCP server. Publish its
SHA-256 somewhere you don't control; for an ECO, publish the hash of
`bundleText`'s UTF-8 bytes rather than the ECO file hash.

For the live demo, keep everything on sandbox data:

```bash
VMCP_DATA_DIR=/tmp/vmcp-agent-demo bash verifier/anchor.sh /tmp/vmcp-anchor-demo
```

`anchor.sh` now refuses to run without an explicit `VMCP_DATA_DIR`.

## Acceptance checks

`node verifier/acceptance.mjs` extracts the **exact** core script from
`index.html` and checks the current ECO artifacts without starting a server
or writing, deleting, or regenerating repository files. Negative cases mutate
copies in memory only. It covers:

- read compatibility for every current `.eco` artifact;
- alteration of outer authority/policy summaries while the bundle commitment
  still matches;
- coherent replacement bundle detected against the original external hash;
- coherent replacement without an external hash, reported as internally
  consistent but historically unauthenticated; and
- independence of the computed result from the ECO's declared
  `verification.integrity`.

The command exits non-zero on any failure. It does not update
`sample-bundle.json` or `sample-bundle.sha256`.

## Hash preimages in the current demo producer

These fields retain their existing meanings; this verifier does not redefine
or recalculate `packageHash`:

- `anchor.bundleHash` and `verification.bundleHash`: SHA-256 of the UTF-8
  bytes of the `bundleText` string.
- `packageHash.value` inside the ECO: SHA-256 of the pretty-printed JSON
  serialization of the ECO object **before** the `packageHash` property is
  added.
- `packageHash` inside `demo/evidence/latest.json`: SHA-256 of the final
  pretty-printed ECO JSON **including** its `packageHash` property.

The two `packageHash` values consequently have different preimages. Neither
is treated as a verified package hash by this verifier.

## Honest scope

Tamper-evident, not tamper-proof: this verifier checks the covered bundle
bytes and chain. It does not authenticate outer ECO metadata, establish the
source or trustworthiness of a supplied anchor, or validate that content is
true or correct.

## Fail-closed guard

`demo/agent-loop.mjs --once` is a pre-action gate: it evaluates the latest
request only after verifying the full chain. Wire it as a hard precondition:

```bash
node demo/agent-loop.mjs --once && ./do-the-consequential-thing.sh
```

Exit codes in the demo:

- `0` → `EXECUTE`
- `2` → `STOP_BY_INTEGRITY`
- `3` → `WAIT_FOR_OWNER` / `BLOCK_BY_POLICY` / `BLOCK_BY_AUTHORITY`

Honest scope: it makes silent tampering a visible refusal; it cannot stop an
attacker who controls the machine from bypassing the gate itself.
