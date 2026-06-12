#!/usr/bin/env node
/**
 * acceptance.mjs — Evidencia de runtime para el verificador estático (Tarea 1).
 *
 * Qué hace, de punta a punta y sin mocks:
 *   1. Levanta el server MCP real (dist/index.js) contra una DB temporal.
 *   2. Registra 3 entradas vía JSON-RPC stdio y exporta el bundle real.
 *   3. Extrae el <script id="vmcp-core"> EXACTO de verifier/index.html
 *      y lo ejecuta en Node (mismo API WebCrypto que el browser).
 *   4. Corre los escenarios de aceptación del handoff §Tarea 1.
 *
 * Uso:  node verifier/acceptance.mjs
 * Salida: PASS/FAIL por escenario; exit code != 0 si algo falla.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ---------- 1. Server MCP real contra DB temporal ----------
const dataDir = mkdtempSync(join(tmpdir(), "vmcp-acceptance-"));
const server = spawn("node", [join(ROOT, "dist", "index.js")], {
  env: { ...process.env, VMCP_DATA_DIR: dataDir },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderrBuf = "";
server.stderr.on("data", (d) => (stderrBuf += d.toString()));

const pending = new Map();
let nextId = 1;
let lineBuf = "";
server.stdout.on("data", (chunk) => {
  lineBuf += chunk.toString();
  let nl;
  while ((nl = lineBuf.indexOf("\n")) >= 0) {
    const line = lineBuf.slice(0, nl).trim();
    lineBuf = lineBuf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch { /* línea no-JSON: ignorar */ }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout esperando ${method}`)); }
    }, 15_000);
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.error) throw new Error(`${name} → ${JSON.stringify(res.error)}`);
  return res.result.content[0].text;
}

// ---------- helpers ----------
const enc = new TextEncoder();
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let passCount = 0, failCount = 0;
function check(label, cond, detail) {
  if (cond) { passCount++; console.log(`  PASS  ${label}`); }
  else { failCount++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

// ---------- main ----------
try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "vmcp-acceptance", version: "0.0.0" },
  });
  notify("notifications/initialized");

  // Contenido estilo demo (simulación, sin datos reales) + unicode + caracteres especiales.
  await callTool("remember", {
    content: "Decisión simulada del agente: preparar instrucción de pago de $10.000 — pendiente de aprobación humana.",
    tags: ["demo", "simulación"],
  });
  await callTool("remember", {
    content: 'Contexto usado: límite operativo "tier-2", contraparte ACME S.A. (ñ, é, 中文, emoji ✓).',
    tags: ["demo", "contexto"],
  });
  await callTool("remember", {
    content: "Aprobación humana registrada. La instrucción pasa a ejecución.",
    tags: ["demo", "aprobación"],
  });

  const bundleText = await callTool("export", {});
  const bundleBytes = enc.encode(bundleText);
  const bundleObj = JSON.parse(bundleText);
  if (bundleObj.format !== "verifiable-memory-bundle" || bundleObj.entries.length !== 3) {
    throw new Error("el export no devolvió un bundle válido de 3 entradas");
  }
  const anchor = await sha256Hex(bundleBytes);

  // Hermético por defecto: la corrida no muta el árbol del repo.
  // Los fixtures commiteados (sample-bundle.json/.sha256) solo se regeneran
  // de forma explícita con --update-fixtures.
  if (process.argv.includes("--update-fixtures")) {
    writeFileSync(join(HERE, "sample-bundle.json"), bundleText);
    writeFileSync(join(HERE, "sample-bundle.sha256"), anchor + "  sample-bundle.json\n");
    console.log("fixtures actualizados: verifier/sample-bundle.json + .sha256");
  }

  // ---------- 2. Extraer y cargar el core EXACTO del HTML ----------
  const html = readFileSync(join(HERE, "index.html"), "utf-8");
  const m = html.match(/<script id="vmcp-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no se encontró <script id=\"vmcp-core\"> en index.html");
  vm.runInThisContext(m[1], { filename: "vmcp-core(extraído de index.html)" });
  const { verifyBundle } = globalThis.VMCPVerifier;

  console.log(`\nBundle real exportado: ${bundleObj.entries.length} entradas`);
  console.log(`sha256 (ancla): ${anchor}\n`);

  // ---------- 3. Escenarios de aceptación ----------
  // S1 — bundle real intacto + ancla correcta → VERDE
  let r = await verifyBundle(bundleBytes, anchor);
  check("S1 intacto + ancla correcta → verde/match",
    r.verdict === "green" && r.anchor === "match" && r.checkedEntries === 3,
    JSON.stringify(r.failure) + " anchor=" + r.anchor);

  // S2 — bundle intacto sin ancla → VERDE (verificación interna)
  r = await verifyBundle(bundleBytes, null);
  check("S2 intacto sin ancla → verde/not_provided",
    r.verdict === "green" && r.anchor === "not_provided");

  // S3 — editar UN carácter del content → ROJO (check: content)
  {
    const o = JSON.parse(bundleText);
    const c = o.entries[1].content;
    o.entries[1].content = (c[0] === "X" ? "Y" : "X") + c.slice(1);
    r = await verifyBundle(enc.encode(JSON.stringify(o, null, 2)), null);
    check("S3 un carácter editado → rojo/content en entry correcta",
      r.verdict === "red" && r.failure?.check === "content" && r.failure?.entryId === o.entries[1].id,
      JSON.stringify(r.failure));
  }

  // S4 — reordenar entries → ROJO (check: link)
  {
    const o = JSON.parse(bundleText);
    [o.entries[1], o.entries[2]] = [o.entries[2], o.entries[1]];
    r = await verifyBundle(enc.encode(JSON.stringify(o, null, 2)), null);
    check("S4 entries reordenadas → rojo/link",
      r.verdict === "red" && r.failure?.check === "link",
      JSON.stringify(r.failure));
  }

  // S5 — borrar una entry del medio → ROJO (check: link)
  {
    const o = JSON.parse(bundleText);
    o.entries.splice(1, 1);
    r = await verifyBundle(enc.encode(JSON.stringify(o, null, 2)), null);
    check("S5 entry del medio borrada → rojo/link",
      r.verdict === "red" && r.failure?.check === "link",
      JSON.stringify(r.failure));
  }

  // S6 — ancla que no coincide (hex válido) → ROJO (check: anchor), cadena interna consistente
  r = await verifyBundle(bundleBytes, "0".repeat(64));
  check("S6 ancla válida que no coincide → rojo/anchor + cadena interna ok",
    r.verdict === "red" && r.failure?.check === "anchor" && r.chainConsistent === true,
    JSON.stringify(r.failure));

  // S7 — ancla con formato inválido → ERROR (no veredicto), no falso ALTERADO
  r = await verifyBundle(bundleBytes, "esto-no-es-un-hash");
  check("S7 ancla inválida → error/anchor_invalid (sin falso veredicto)",
    r.verdict === "error" && r.failure?.check === "anchor_invalid");

  // S8 — JSON que no es bundle, sin ancla → ERROR (no verificable), no falso ALTERADO
  r = await verifyBundle(enc.encode(JSON.stringify({ hello: "world" })), null);
  check("S8 JSON ajeno sin ancla → error/format",
    r.verdict === "error" && r.failure?.check === "format");

  // S10 — los fixtures COMMITEADOS siguen siendo válidos (no quedaron stale)
  {
    const fixturePath = join(HERE, "sample-bundle.json");
    const shaPath = join(HERE, "sample-bundle.sha256");
    const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
    const fixtureAnchor = readFileSync(shaPath, "utf-8").split(/\s+/)[0];
    r = await verifyBundle(fixtureBytes, fixtureAnchor);
    check("S10 fixture commiteado verifica verde/match contra su .sha256",
      r.verdict === "green" && r.anchor === "match",
      JSON.stringify(r.failure) + " anchor=" + r.anchor);
  }

  // S9 — bytes truncados + ancla correcta del original → ROJO (el ancla manda)
  r = await verifyBundle(bundleBytes.slice(0, bundleBytes.length - 10), anchor);
  check("S9 archivo truncado + ancla del original → rojo/anchor",
    r.verdict === "red" && r.failure?.check === "anchor");

  console.log(`\nResultado: ${passCount} PASS, ${failCount} FAIL`);
  process.exitCode = failCount === 0 ? 0 : 1;
} catch (err) {
  console.error("\nERROR de ejecución:", err.message);
  if (stderrBuf) console.error("stderr del server:\n" + stderrBuf.slice(0, 2000));
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
