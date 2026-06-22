#!/usr/bin/env node
/**
 * dashboard-server.mjs — tiny static file server for demo/dashboard.html.
 *
 * Serves the demo/ directory only (dashboard.html + state.json), so the
 * dashboard can poll state.json over http:// without browser file:// CORS
 * restrictions. Not used by anything outside this demo.
 *
 * Usage: node demo/dashboard-server.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4180);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".eco": "application/json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = url.pathname === "/" ? "/dashboard.html" : url.pathname;
  pathname = normalize(pathname).replace(/^(\.\.[/\\])+/, "");

  let base = HERE;
  if (pathname.startsWith("/verifier/") || pathname.startsWith("/anchor-out/")) {
    base = ROOT;
  }
  const filePath = join(base, pathname);
  if (!filePath.startsWith(base)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`DASHBOARD: http://localhost:${PORT}/`);
  console.log(`Serving: ${HERE}`);
});
