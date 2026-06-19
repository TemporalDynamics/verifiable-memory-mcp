#!/usr/bin/env bash
# anchor.sh — Export the current memory as a verifiable bundle and prepare its public anchor.
#
# What it does:
#   1. Exports a verifiable-memory-bundle from the MCP server (real JSON-RPC over stdio).
#   2. Computes the SHA-256 of the exact bundle bytes (the anchor hash).
#   3. If `ots` (OpenTimestamps client) is installed, stamps the bundle (Bitcoin-attested receipt).
#   4. Writes anchor-receipt.json in the shared @temporaldynamics/eco-packer-public
#      `legalTimestamp` shape, so one verifier can read EcoSign and vmcp anchors alike.
#      The backend stays neutral (OpenTimestamps / GitHub release) — no on-chain dependency.
#   5. Prints the exact command to publish the anchor as a GitHub release.
#
# It NEVER publishes by itself. Publishing is a human action:
# run the printed `gh release create` command yourself, and note the exact time.
#
# Usage:
#   VMCP_DATA_DIR=/path ./verifier/anchor.sh [outdir]
# Refuses to run against the default real memory unless ALLOW_REAL_DATA=1.
set -euo pipefail

# Preflight: fallar al inicio con mensaje claro, no a mitad del flujo.
for dep in node jq; do
  command -v "$dep" > /dev/null 2>&1 || { echo "ERROR: falta '$dep' en PATH." >&2; exit 1; }
done
if command -v sha256sum > /dev/null 2>&1; then
  sha256_file() { sha256sum "$1"; }
elif command -v shasum > /dev/null 2>&1; then # macOS
  sha256_file() { shasum -a 256 "$1"; }
else
  echo "ERROR: falta 'sha256sum' (Linux) o 'shasum' (macOS) en PATH." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
SERVER="$ROOT/dist/index.js"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${1:-$ROOT/anchor-out/$STAMP}"
REAL_DIR="${HOME}/.verifiable-memory-mcp"

[ -n "${VMCP_DATA_DIR:-}" ] || {
  echo "ERROR: VMCP_DATA_DIR is required. Refusing to export unspecified memory." >&2
  exit 1
}

if [ "${ALLOW_REAL_DATA:-0}" != "1" ] && [ "${VMCP_DATA_DIR}" = "$REAL_DIR" ]; then
  echo "ERROR: Refusing to export real memory at $REAL_DIR without ALLOW_REAL_DATA=1." >&2
  exit 1
fi

[ -f "$SERVER" ] || { echo "ERROR: $SERVER no existe. Corré 'npm run build' primero." >&2; exit 1; }
mkdir -p "$OUTDIR"

BUNDLE="$OUTDIR/bundle.json"

# --- 1. Export real via JSON-RPC stdio (initialize → initialized → export) ---
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"anchor.sh","version":"0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"export","arguments":{}}}' \
  | VMCP_DATA_DIR="$VMCP_DATA_DIR" node "$SERVER" \
  | jq -r 'select(.id == 2) | .result.content[0].text' > "$BUNDLE"

[ -s "$BUNDLE" ] || { echo "ERROR: el export volvió vacío." >&2; exit 1; }
jq -e '.format == "verifiable-memory-bundle"' "$BUNDLE" > /dev/null \
  || { echo "ERROR: el archivo exportado no es un verifiable-memory-bundle." >&2; exit 1; }

ENTRIES=$(jq '.entries | length' "$BUNDLE")

# --- 2. Anchor hash = sha256 of the exact file bytes ---
( cd "$OUTDIR" && sha256_file bundle.json > bundle.sha256 )
ANCHOR=$(cut -d' ' -f1 "$OUTDIR/bundle.sha256")

# --- 3. Optional: OpenTimestamps receipt (Bitcoin-attested, third-party time) ---
if command -v ots > /dev/null 2>&1; then
  ( cd "$OUTDIR" && ots stamp bundle.json ) \
    && echo "OpenTimestamps: recibo creado en $OUTDIR/bundle.json.ots" \
    || echo "AVISO: ots stamp falló; seguí con el release de GitHub." >&2
else
  echo "AVISO: 'ots' no está instalado (pip install opentimestamps-client). Anclaje solo por GitHub release."
fi

# --- 3b. Anchor receipt in the shared eco-packer-public `legalTimestamp` shape ---
# Same contract as @temporaldynamics/eco-packer-public (MIT): { standard, tsa, tokenSize,
# verified }. This makes the anchor reusable across the sibling apps WITHOUT importing any
# commercial/on-chain mechanism. `verified:false` is honest: an OpenTimestamps receipt is
# pending until it is confirmed on its attestation substrate.
OTS_FILE="$OUTDIR/bundle.json.ots"
if [ -f "$OTS_FILE" ]; then
  STANDARD="OpenTimestamps"
  TSA="opentimestamps:bitcoin"
  TOKEN_SIZE=$(wc -c < "$OTS_FILE" | tr -d ' ')
else
  STANDARD="github-release"
  TSA="github-release:TemporalDynamics/verifiable-memory-mcp"
  TOKEN_SIZE=null
fi

jq -n \
  --arg anchor "$ANCHOR" \
  --argjson entries "$ENTRIES" \
  --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg standard "$STANDARD" \
  --arg tsa "$TSA" \
  --argjson tokenSize "$TOKEN_SIZE" \
  --arg ref "anchor-$STAMP" \
  '{
    format: "verifiable-memory-anchor",
    version: "0.1.0",
    anchorHash: $anchor,
    bundleFormat: "verifiable-memory-bundle",
    entries: $entries,
    createdAt: $created,
    legalTimestamp: {
      standard: $standard,
      tsa: $tsa,
      tokenSize: $tokenSize,
      verified: false
    },
    publication: {
      substrate: "github-release",
      repo: "TemporalDynamics/verifiable-memory-mcp",
      ref: $ref
    }
  }' > "$OUTDIR/anchor-receipt.json"
echo "Anchor receipt (eco-packer-public shape): $OUTDIR/anchor-receipt.json"

# --- 4. Print, never publish ---
cat <<EOF

Bundle:   $BUNDLE   ($ENTRIES entradas)
Anchor:   $ANCHOR

Para PUBLICAR el ancla (acción humana — anotá la hora exacta al hacerlo):

  gh release create "anchor-$STAMP" \\
    "$OUTDIR/bundle.sha256" \\
    "$OUTDIR/anchor-receipt.json" \\
    $( [ -f "$OUTDIR/bundle.json.ots" ] && echo "\"$OUTDIR/bundle.json.ots\" \\" )
    --repo TemporalDynamics/verifiable-memory-mcp \\
    --title "Anchor $STAMP" \\
    --notes "sha256(bundle.json) = $ANCHOR"

Nota: el release publica SOLO el hash (y el recibo .ots si existe), no el bundle.
El bundle viaja por separado; quien verifica compara su sha256 contra este ancla.
Verificador: abrir verifier/index.html y pegar el ancla, o ?anchor=$ANCHOR
EOF
