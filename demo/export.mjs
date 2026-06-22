import { DEMO_DIR, callTools, resolveDemoDataDir, textContent } from "./common.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createEvidencePackage } from "./evidence-package.mjs";

const dataDir = resolveDemoDataDir();
const statePath = join(process.cwd(), "demo", "state.json");
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf-8"))
  : {
      agent: "unknown",
      task: null,
      decision: "EXPORT",
      memory: "UNKNOWN",
      reason: "manual export without dashboard state",
    };
const { results } = await callTools(
  [{ name: "export", arguments: {} }],
  { dataDir, clientName: "vmcp-demo-export" }
);
const bundleText = textContent(results[0]);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(process.cwd(), "anchor-out", ts);
const latestDir = join(process.cwd(), "anchor-out", "latest");
mkdirSync(outDir, { recursive: true });
mkdirSync(latestDir, { recursive: true });

const bundlePath = join(outDir, "bundle.json");
writeFileSync(bundlePath, bundleText, "utf-8");

const hash = createHash("sha256").update(bundleText, "utf-8").digest("hex");
writeFileSync(join(outDir, "bundle.sha256"), `${hash}  bundle.json\n`);
writeFileSync(join(latestDir, "bundle.json"), bundleText, "utf-8");
writeFileSync(join(latestDir, "bundle.sha256"), `${hash}  bundle.json\n`);

const cycle = Number.isFinite(Number(state.cycles?.at?.(-1)?.cycle))
  ? Number(state.cycles.at(-1).cycle)
  : 0;
const eco = await createEvidencePackage({
  state,
  cycle,
  decision: state.decision ?? "EXPORT",
  memory: state.memory ?? "UNKNOWN",
  failedEntry: state.evidencePackage?.failedEntry ?? null,
  label: "manual_export",
  dataDir,
});

const publicBaseUrl = process.env.DEMO_PUBLIC_BASE_URL ?? "";
const localUrl = "http://localhost:4190/verifier/index.html?eco=/evidence/latest.eco";
const publicUrl = publicBaseUrl
  ? `${publicBaseUrl.replace(/\/$/, "")}/verifier/index.html?eco=/evidence/latest.eco`
  : null;

console.log("EVIDENCE EXPORTED");
console.log(`Sandbox: ${dataDir}`);
console.log(`Default demo dir: ${DEMO_DIR}`);
console.log(`Bundle: ${bundlePath}`);
console.log(`SHA256: ${hash}`);
console.log(`Latest bundle: ${join(latestDir, "bundle.json")}`);
console.log(`Latest anchor: ${join(latestDir, "bundle.sha256")}`);
console.log(`ECO: ${eco.path}`);
console.log(`Latest ECO: ${eco.latestPath}`);
console.log("Verifier:");
console.log(`  npm run demo:publish-local`);
console.log(`  ${localUrl}`);
if (publicUrl) {
  console.log("Public verifier (DEMO_PUBLIC_BASE_URL):");
  console.log(`  ${publicUrl}`);
}
console.log("Standalone verifier server:");
console.log(`  npm run demo:verifier`);
console.log(`  http://localhost:4190/verifier/index.html?eco=/demo/evidence/latest.eco`);
console.log("");
console.log("Phone / external device verification:");
console.log("  local LAN: use drag-and-drop or the QR code in the dashboard.");
console.log("  HTTPS required for browser crypto APIs on mobile devices.");
console.log("  For judge/investor demos, deploy behind HTTPS or use a tunnel.");
