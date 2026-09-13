export interface MemoryEntry {
  id: string;
  createdAt: string;
  content: string;
  /** NOT covered by entryHash (see hashing.ts:buildEntryCanonical) — unauthenticated metadata. Never use for security or authorization decisions. */
  tags: string[];
  contentHash: string;
  prevHash: string | null;
  entryHash: string;
}

export interface VerifyResult {
  id: string;
  valid: boolean;
  storedHash: string;
  computedHash: string;
  reason: string;
}

export interface ExportBundle {
  format: "verifiable-memory-bundle";
  version: "0.1";
  exportedAt: string;
  entries: MemoryEntry[];
}

export type ToolName = "remember" | "recall" | "verify" | "chain" | "timeline" | "export" | "append_if_verified_head";

/**
 * Why an integrity check inside insertEntryIfVerifiedHead refused to
 * proceed. Deliberately more granular than a boolean: a caller (or a test)
 * needs to tell "the chain itself doesn't hash-check" apart from "the
 * external witness disagrees" apart from "there is no witness to check
 * against yet" — these are different failure classes with different causes.
 */
export type ConditionalAppendIntegrityStatus =
  | "invalid_expected_head"
  | "invalid_content"
  | "invalid_tags"
  | "chain_broken"
  | "witness_missing"
  | "witness_unavailable"
  | "witness_mismatch"
  | "witness_unexpected_when_empty";

/**
 * Result of insertEntryIfVerifiedHead — a single verified conditional
 * append. Four disjoint outcomes, deliberately never collapsed into a bare
 * boolean:
 *
 * - "appended": SQLite committed AND the external witness was updated to
 *   match. The only outcome where a caller may treat the new head as fully
 *   confirmed end-to-end.
 * - "conflict": nothing was written. expectedHead did not match the
 *   verified current head (or the ledger's actual emptiness didn't match
 *   what expectedHead assumed).
 * - "integrity_failure": nothing was written. Either the inputs were
 *   invalid, the stored chain itself failed structural verification, or the
 *   external witness could not be confirmed (missing/unavailable/mismatch).
 * - "committed_but_witness_unconfirmed": SQLite DID commit the new entry —
 *   this is NOT a failure to write, it is a failure to confirm the write
 *   externally. See db.ts's module header for why SQLite and the keychain
 *   can never be one atomic transaction, and why this state must be
 *   reported honestly rather than folded into "appended" or "integrity_failure".
 */
export type ConditionalAppendResult =
  | {
      readonly ok: true;
      readonly status: "appended";
      readonly previousHead: string | null;
      /** The verifiable position — see newHead vs. sequence note below. */
      readonly newHead: string;
      /**
       * A local ordinal (SQLite's own rowid) — NOT cryptographically
       * committed into the hash chain, NOT portable across a reconstructed
       * or restored database (a restore replayed through a different insert
       * order would assign different values), and never a substitute for
       * `newHead` when a caller needs a verifiable position. Use it only for
       * same-process/same-file ordering convenience, never as a security-
       * relevant identifier.
       */
      readonly sequence: number;
      readonly witnessStatus: "confirmed";
    }
  | {
      readonly ok: false;
      readonly status: "conflict";
      readonly expectedHead: string | null;
      readonly observedHead: string | null;
      readonly committed: false;
    }
  | {
      readonly ok: false;
      readonly status: "integrity_failure";
      readonly integrityStatus: ConditionalAppendIntegrityStatus;
      readonly committed: false;
    }
  | {
      readonly ok: false;
      readonly status: "committed_but_witness_unconfirmed";
      readonly previousHead: string | null;
      readonly newHead: string;
      readonly committed: true;
    };

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type ToolResponse = CallToolResult;
