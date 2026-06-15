import { DEMO_DIR, callTools, resolveDemoDataDir, textContent } from "./common.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dataDir = resolveDemoDataDir();
const { results } = await callTools(
  [{ name: "export", arguments: {} }],
  { dataDir, clientName: "vmcp-demo-export" }
);
const bundleText = textContent(results[0]);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(process.cwd(), "anchor-out", ts);
mkdirSync(outDir, { recursive: true });

const bundlePath = join(outDir, "bundle.json");
writeFileSync(bundlePath, bundleText, "utf-8");

const hash = createHash("sha256").update(bundleText, "utf-8").digest("hex");
writeFileSync(join(outDir, "bundle.sha256"), `${hash}  bundle.json\n`);

console.log("EVIDENCE EXPORTED");
console.log(`Sandbox: ${dataDir}`);
console.log(`Default demo dir: ${DEMO_DIR}`);
console.log(`Bundle: ${bundlePath}`);
console.log(`SHA256: ${hash}`);
console.log("External verifier: open verifier/index.html and load this bundle");
