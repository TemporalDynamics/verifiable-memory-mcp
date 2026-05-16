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

export function buildEntryCanonical(
  contentHash: string,
  prevHash: string | null,
  createdAt: string
): string {
  return JSON.stringify({ contentHash, prevHash, createdAt });
}
