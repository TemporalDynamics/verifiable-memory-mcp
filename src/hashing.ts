import { createHash } from "node:crypto";

export function sha256(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

export function hashContent(content: string): string {
  return sha256(content);
}

export function hashEntry(canonical: string): string {
  return sha256(canonical);
}

/**
 * What entry_hash actually commits to: contentHash, prevHash, createdAt —
 * nothing else. In particular, a stored row's `tags`, `id`, and its
 * storage-only `created_epoch`/rowid are NOT part of this derivation and
 * are not covered by chain verification. Do not present entry_hash as an
 * integrity guarantee over every stored field. `tags` are unauthenticated
 * metadata in this schema; do not use them for security or authorization
 * decisions. Data that must be covered by the hash chain belongs inside
 * `content` itself.
 */
export function buildEntryCanonical(
  contentHash: string,
  prevHash: string | null,
  createdAt: string
): string {
  return JSON.stringify({ contentHash, prevHash, createdAt });
}
