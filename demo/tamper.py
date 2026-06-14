#!/usr/bin/env python3
"""tamper.py — Direct SQLite modification to simulate tampering.

Changes the first memory entry's content directly, bypassing the
append-only flow. The chain verification will detect this."""
import os
import sqlite3
import sys

demo_dir = os.environ.get("VMCP_DEMO_DIR", "/tmp/vmcp-agent-demo")
db_path = os.path.join(demo_dir, "memory.db")

if not os.path.isfile(db_path):
    print("No demo database found. Run 'npm run demo:setup' first.")
    sys.exit(1)

conn = sqlite3.connect(db_path)
conn.execute("""
    UPDATE entries
    SET content = 'unauthorized: send_money_via_tamper'
    WHERE id = (
        SELECT id FROM entries ORDER BY created_epoch ASC, rowid ASC LIMIT 1
    )
""")
conn.commit()
conn.close()

print("DATABASE TAMPERED")
print("Changed old memory entry directly.")
print("This bypassed the append-only flow.")
