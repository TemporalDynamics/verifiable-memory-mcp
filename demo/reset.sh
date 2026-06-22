#!/usr/bin/env bash
set -e
DEMO_DIR="${VMCP_DATA_DIR:-${VMCP_DEMO_DIR:-/tmp/vmcp-agent-demo}}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
rm -f "$HERE/state.json"
rm -rf "$HERE/evidence"
echo "Demo memory reset."
echo "Data dir: $DEMO_DIR"
echo "Dashboard state reset."
