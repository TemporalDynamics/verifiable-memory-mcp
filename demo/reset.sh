#!/usr/bin/env bash
set -e
DEMO_DIR="${VMCP_DATA_DIR:-${VMCP_DEMO_DIR:-/tmp/vmcp-agent-demo}}"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
echo "Demo memory reset."
echo "Data dir: $DEMO_DIR"
