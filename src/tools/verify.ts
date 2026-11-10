import { inspectEntryForVerification } from "../db.js";
import { hashContent, hashEntry, buildEntryCanonical } from "../hashing.js";
import { ToolResponse } from "../types.js";

export function verify(args: { id: string }): ToolResponse {
  const snapshot = inspectEntryForVerification(args.id);
  if (!snapshot) {
    return {
      content: [{ type: "text", text: JSON.stringify({ verificationStatus: "not_found", id: args.id }, null, 2) }],
    };
  }

  const entry = snapshot.entry;
  const recomputedContentHash = hashContent(entry.content);
  const contentValid = recomputedContentHash === entry.contentHash;

  const recomputedCanonical = buildEntryCanonical(entry.contentHash, entry.prevHash, entry.createdAt);
  const recomputedEntryHash = hashEntry(recomputedCanonical);
  const entryHashValid = recomputedEntryHash === entry.entryHash;
  const chainValid = snapshot.chainIntegrity === "verified";
  const stateRoot = snapshot.stateRoot;
  const stateRootVerified = stateRoot.stateRootVerified;
  const explicitIntegrityFailure = !contentValid || !entryHashValid || !chainValid || stateRoot.status === "mismatch";
  const verificationStatus = explicitIntegrityFailure
    ? "integrity_failure"
    : stateRootVerified
      ? "verified"
      : "verification_incomplete";
  const allChecksPassed = verificationStatus === "verified";
  const failureReasons = [
    !contentValid ? "entry content hash mismatch" : null,
    !entryHashValid ? "entry hash mismatch" : null,
    !chainValid ? "complete-chain verification failed" : null,
    stateRoot.status === "mismatch" ? "State Root does not match the database head" : null,
  ].filter((reason): reason is string => reason !== null);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: entry.id,
            verificationStatus,
            /** True only when entry hashes, the complete chain, and the external State Root all pass. */
            valid: allChecksPassed,
            /** True only when the database head matched the OS keychain witness. */
            stateRootVerified,
            createdAt: entry.createdAt,
            totalEntries: snapshot.totalEntries,
            checks: {
              contentIntegrity: {
                passed: contentValid,
                stored: entry.contentHash,
                computed: recomputedContentHash,
              },
              entryHashIntegrity: {
                passed: entryHashValid,
                stored: entry.entryHash,
                computed: recomputedEntryHash,
              },
              chainIntegrity: {
                passed: chainValid,
                status: snapshot.chainIntegrity,
                scope: "entire_chain",
                entriesChecked: snapshot.totalEntries,
              },
              stateRoot: {
                passed: stateRootVerified,
                status: stateRoot.status,
                dbRoot: stateRoot.dbRoot,
                keychainRoot: stateRoot.keychainRoot,
                accountName: stateRoot.accountName,
                message: stateRoot.message,
              },
            },
            summary: verificationStatus === "verified"
              ? "Entry hashes, the complete chain, and State Root are verified"
              : verificationStatus === "integrity_failure"
                ? `Integrity failure: ${failureReasons.join("; ")}`
                : `Verification incomplete: entry and chain checks passed, but State Root status is ${stateRoot.status}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
