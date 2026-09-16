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

export type ToolName =
  | "remember"
  | "recall"
  | "verify"
  | "chain"
  | "timeline"
  | "export"
  | "append_if_verified_head"
  | "read_verified_snapshot";

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
       * Monotonic 0-based sequence index from genesis within the structurally
       * verified chain (0 for genesis, 1 for second, etc.) — assigned
       * deterministically within the verified transaction, matching
       * VerifiedEntry.sequence in readVerifiedSnapshot.
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

/**
 * The verifiable projection of one entry — exactly the fields entry_hash
 * actually commits to (see hashing.ts:buildEntryCanonical), nothing more.
 * Deliberately excludes `tags`, `id`, and the storage-only
 * `created_epoch`/rowid: none of them are covered by the hash chain, and
 * mixing them into what a caller might treat as "verified" would misstate
 * what was actually checked. A caller that also wants the unauthenticated
 * fields must fetch the full MemoryEntry separately (e.g. via getEntry) and
 * keep the two clearly apart.
 */
export interface VerifiedEntry {
  /** 0-based monotonic sequence index from genesis within the structurally verified chain. */
  readonly sequence: number;
  readonly content: string;
  readonly contentHash: string;
  readonly prevHash: string | null;
  readonly entryHash: string;
  readonly createdAt: string;
}

export interface ReadVerifiedSnapshotQuery {
  readonly afterSequence?: number | null;
  readonly limit?: number;
  readonly expectedSnapshotHead?: string | null;
}

/** The subset of integrity failure reasons readVerifiedSnapshot can produce. */
export type SnapshotIntegrityStatus =
  | Extract<
      ConditionalAppendIntegrityStatus,
      "chain_broken" | "witness_missing" | "witness_unavailable" | "witness_mismatch" | "witness_unexpected_when_empty"
    >
  | "invalid_expected_snapshot_head"
  | "invalid_after_sequence"
  | "invalid_limit";

/**
 * Result of readVerifiedSnapshot — a read-only, point-in-time view of the
 * chain, structurally verified against the external witness before being
 * returned. On failure, returns NO entries and NO partial content — never
 * hand back potentially-untrustworthy data alongside a failure status.
 *
 * TEMPORAL SEMANTICS, stated exactly (do not oversell this elsewhere): this
 * snapshot is coherent as of the position it was read at (`ledgerPosition`).
 * It is NOT a claim about being "the current" state after the fact — by the
 * time a caller acts on it, a concurrent writer may already have appended
 * past it. A verified-and-then-stale snapshot is expected, normal, and safe
 * — the guarantee this function makes is about what it observed, not about
 * what remains true afterward. Safety comes from pairing this with
 * append_if_verified_head afterward (passing `ledgerPosition` as
 * `expectedHead`): if anything wrote in between, that CAS call fails
 * (`conflict`) rather than silently overwriting. Never treat a successful
 * snapshot alone as a freshness guarantee, and never add automatic retries
 * here — a caller that needs the CURRENT state after a conflict should call
 * this function again, explicitly.
 */
export type ReadVerifiedSnapshotResult =
  | {
      readonly ok: true;
      readonly status: "verified";
      /** Genesis entryHash for a non-empty verified chain; null only for a genuinely empty chain. */
      readonly historyId: string | null;
      /** Pass this back as `expectedHead` to append_if_verified_head or `expectedSnapshotHead` to paginate. Null only for a genuinely empty chain. */
      readonly ledgerPosition: string | null;
      readonly entries: readonly VerifiedEntry[];
      readonly chainLength: number;
      readonly nextSequence: number | null;
      readonly witnessStatus: "confirmed" | "empty_chain";
    }
  | {
      readonly ok: false;
      readonly status: "snapshot_conflict";
      readonly expectedSnapshotHead: string | null;
      readonly observedHead: string | null;
    }
  | {
      readonly ok: false;
      readonly status: "integrity_failure";
      readonly integrityStatus: SnapshotIntegrityStatus;
    };

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type ToolResponse = CallToolResult;
