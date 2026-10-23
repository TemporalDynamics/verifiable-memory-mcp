#!/usr/bin/env node
/**
 * Read-only acceptance checks for the static ECO verifier.
 *
 * Reads the existing ECO artifacts without modifying them. All mutations used
 * by negative cases exist only in memory; no server, database, generated ECO,
 * fixture update, or cleanup of repository files is performed.
 *
 * Usage: node verifier/acceptance.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

globalThis.crypto ??= webcrypto;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const ECO_DIR = join(REPO, "demo", "evidence");
const enc = new TextEncoder();

let passCount = 0;
let failCount = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passCount++;
    console.log(`PASS ${label}`);
  } else {
    failCount++;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeInternallyConsistentBundle(bundleText) {
  const bundle = JSON.parse(bundleText);
  if (bundle.entries[0]) bundle.entries[0].content += " [coherent replacement fixture]";
  let previousHash = bundle.entries[0]?.prevHash ?? null;
  for (const entry of bundle.entries) {
    entry.contentHash = await sha256Hex(enc.encode(entry.content));
    entry.prevHash = previousHash;
    const canonical = JSON.stringify({
      contentHash: entry.contentHash,
      prevHash: entry.prevHash,
      createdAt: entry.createdAt,
    });
    entry.entryHash = await sha256Hex(enc.encode(canonical));
    previousHash = entry.entryHash;
  }
  return JSON.stringify(bundle, null, 2);
}

const html = readFileSync(join(HERE, "index.html"), "utf8");
const coreMatch = html.match(/<script id="vmcp-core">([\s\S]*?)<\/script>/);
if (!coreMatch) throw new Error('No se encontró el core "vmcp-core" en index.html');
vm.runInThisContext(coreMatch[1], { filename: "vmcp-core(index.html)" });
const verifier = globalThis.VMCPVerifier;

const showBadgesSource = html.slice(
  html.indexOf("function showBadges"),
  html.indexOf("function renderIdle")
);
const verifyInputSource = html.slice(
  html.indexOf("async function verifyInput"),
  html.indexOf("globalThis.VMCPVerifier =")
);
check(
  "presentation derives integrity from computed chain state",
  showBadgesSource.includes("r.chainConsistent") &&
    !showBadgesSource.includes("verification.integrity")
);
check(
  "ECO verifier does not promote its internal anchor to external input",
  verifyInputSource.includes("verifyBundle(textToBytes(eco.bundleText), anchorRaw)") &&
    !verifyInputSource.includes("eco.anchor.bundleHash;")
);
check(
  "outer authority and policy values have explicit unauthenticated labels",
  html.includes("Resumen de autoridad (declarado/no autenticado)") &&
    html.includes("Resumen de política (declarado/no autenticado)") &&
    html.includes("Authority summary (declared/unauthenticated)") &&
    html.includes("Policy summary (declared/unauthenticated)")
);

const artifactNames = readdirSync(ECO_DIR).filter((name) => name.endsWith(".eco")).sort();
if (artifactNames.length === 0) throw new Error("No hay artefactos ECO actuales para la prueba de compatibilidad.");

const artifacts = artifactNames.map((name) => ({
  name,
  bytes: new Uint8Array(readFileSync(join(ECO_DIR, name))),
}));
const firstArtifact = artifacts.find(({ name }) => name !== "latest.eco") ?? artifacts[0];
const originalEco = JSON.parse(new TextDecoder().decode(firstArtifact.bytes));
if (typeof originalEco.bundleText !== "string") throw new Error("El ECO actual no contiene bundleText.");

// Compatibility: every existing ECO remains readable. No assertion assumes
// that its embedded declarations are authenticated or that all chains are valid.
for (const artifact of artifacts) {
  const result = await verifier.verifyInput(artifact.bytes, null);
  check(
    `compatibility read ${artifact.name}`,
    result.package?.format === "eco.evidence-artifact" &&
      result.package?.metadataAuthentication?.status === "unauthenticated" &&
      result.anchor === "not_provided"
  );
}

const originalBundleHash = await sha256Hex(enc.encode(originalEco.bundleText));

// Preserve the verifier's earlier bundle-level regression coverage, using only
// the bundle embedded in an existing ECO and in-memory mutations.
{
  const result = await verifier.verifyInput(firstArtifact.bytes, originalBundleHash);
  check(
    "bundle baseline passes with externally supplied hash",
    result.verdict === "green" && result.anchor === "match" && result.chainConsistent === true
  );
}
{
  const result = await verifier.verifyInput(firstArtifact.bytes, null);
  check(
    "bundle baseline without external hash reports internal consistency only",
    result.verdict === "green" &&
      result.anchor === "not_provided" &&
      result.historicalAuthenticity === "not_established"
  );
}
{
  const bundle = JSON.parse(originalEco.bundleText);
  if (bundle.entries.length > 0) {
    bundle.entries[0].content += " [tamper]";
    const result = await verifier.verifyBundle(enc.encode(JSON.stringify(bundle, null, 2)), null);
    check("edited content fails its content hash", result.verdict === "red" && result.failure?.check === "content");
  } else {
    check("edited content test requires at least one entry", false);
  }
}
{
  const bundle = JSON.parse(originalEco.bundleText);
  if (bundle.entries.length > 1) {
    [bundle.entries[0], bundle.entries[1]] = [bundle.entries[1], bundle.entries[0]];
    const result = await verifier.verifyBundle(enc.encode(JSON.stringify(bundle, null, 2)), null);
    check("reordered entries fail their chain links", result.verdict === "red");
  } else {
    check("reordered entries test requires at least two entries", false);
  }
}
{
  const bundle = JSON.parse(originalEco.bundleText);
  if (bundle.entries.length > 2) {
    bundle.entries.splice(1, 1);
    const result = await verifier.verifyBundle(enc.encode(JSON.stringify(bundle, null, 2)), null);
    check("deleted middle entry fails its chain links", result.verdict === "red");
  } else {
    check("deleted-middle-entry test requires at least three entries", false);
  }
}
{
  const result = await verifier.verifyInput(firstArtifact.bytes, "not-a-sha256");
  check("malformed external hash produces neutral error", result.verdict === "error" && result.anchor === "invalid");
}
{
  const result = await verifier.verifyBundle(enc.encode(JSON.stringify({ hello: "world" })), null);
  check("unrelated JSON is rejected as a bundle", result.verdict === "error" && result.failure?.check === "format");
}
{
  const truncated = firstArtifact.bytes.slice(0, firstArtifact.bytes.length - 8);
  const result = await verifier.verifyInput(truncated, originalBundleHash);
  check("truncated ECO does not match original external hash", result.verdict === "error" || result.verdict === "red");
}

// A: outer declarations can change without changing bundle integrity or
// authenticating those declarations.
{
  const altered = structuredClone(originalEco);
  altered.authority_summary = { owner: "attacker-substituted", policyVersion: 999 };
  altered.policy_summary = { policyStatus: "TRUSTED_BY_ATTACKER" };
  altered.verification = { ...altered.verification, integrity: "VALID" };
  const alteredBytes = enc.encode(JSON.stringify(altered));
  const result = await verifier.verifyInput(alteredBytes, originalBundleHash);
  check(
    "A outer summaries remain unauthenticated despite matching bundle anchor",
    result.chainConsistent === true &&
      result.anchor === "match" &&
      result.package?.metadataAuthentication?.status === "unauthenticated" &&
      result.package?.authority_summary?.owner === "attacker-substituted"
  );
}

// Build a coherent replacement bundle by recomputing every content and chain
// hash. The package's internal anchor is updated, while the trusted external
// commitment remains the original bundle hash.
const replacementBundleText = await makeInternallyConsistentBundle(originalEco.bundleText);
const replacementBundleHash = await sha256Hex(enc.encode(replacementBundleText));
if (replacementBundleHash === originalBundleHash) {
  throw new Error("La sustitución de prueba no produjo un hash distinto.");
}
const replacementEco = structuredClone(originalEco);
replacementEco.bundleText = replacementBundleText;
replacementEco.bundle = JSON.parse(replacementBundleText);
replacementEco.anchor.bundleHash = replacementBundleHash;
const replacementBytes = enc.encode(JSON.stringify(replacementEco));

// B: only an independently supplied original commitment detects this coherent
// replacement as different from the previously committed bundle.
{
  const result = await verifier.verifyInput(replacementBytes, originalBundleHash);
  check(
    "B coherent bundle replacement detected against external original commitment",
    result.chainConsistent === true &&
      result.anchor === "mismatch" &&
      result.historicalAuthenticity === "external_hash_mismatch" &&
      result.verdict === "red"
  );
}

// C: without external commitment, a coherent replacement can pass internal
// consistency; historic authenticity must remain explicitly unestablished.
{
  const result = await verifier.verifyInput(replacementBytes, null);
  check(
    "C coherent replacement without external commitment is internally consistent only",
    result.chainConsistent === true &&
      result.verdict === "green" &&
      result.anchor === "not_provided" &&
      result.historicalAuthenticity === "not_established"
  );
}

// D: package.verification.integrity is a declaration, not the computed result.
{
  const altered = structuredClone(originalEco);
  altered.verification = { ...altered.verification, integrity: "TAMPERED" };
  const result = await verifier.verifyInput(enc.encode(JSON.stringify(altered)), null);
  check(
    "D computed integrity is independent of verification.integrity declaration",
    result.chainConsistent === true &&
      result.package?.verification?.integrity === "TAMPERED" &&
      result.package?.metadataAuthentication?.status === "unauthenticated"
  );
}

console.log(`\nResultado: ${passCount} PASS, ${failCount} FAIL; ${artifacts.length} ECO existentes leídos sin modificarlos.`);
process.exitCode = failCount === 0 ? 0 : 1;
