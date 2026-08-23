#!/usr/bin/env node
import { createServer } from "node:http";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const LOOPBACK_HOST = "localhost";
const LOOPBACK_ORIGIN = `http://${LOOPBACK_HOST}`;
const ROUTES = [
  "/", "/cases/", "/cases/missing-file/", "/cases/reassuring-average/",
  "/cases/unsupported-citation/", "/cases/wrong-product-identity/",
  "/cases/lost-response/", "/cases/revision-bound-claim/", "/method/",
  "/tools/", "/challenge/", "/about/", "/assets/app.mjs",
  "/assets/classifier.mjs", "/data/deception-cases.v1.json",
];

function targetFor(pathname) {
  const path = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const target = normalize(join(DIST, path));
  if (!target.startsWith(`${DIST}/`)) throw new Error("unsafe request path");
  return target;
}

function contentType(path) {
  return ({ ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" })[extname(path)] ?? "application/octet-stream";
}

export async function checkHttp() {
  const previousResultOrder = getDefaultResultOrder();
  setDefaultResultOrder("ipv4first");
  const server = createServer(async (request, response) => {
    try {
      const target = targetFor(new URL(request.url, LOOPBACK_ORIGIN).pathname);
      const bytes = await readFile(target);
      response.writeHead(200, { "content-type": contentType(target), "cache-control": "no-store" });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  const results = [];
  try {
    await new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK_HOST, resolveListen);
    });
    const { port } = server.address();
    for (const route of ROUTES) {
      const response = await fetch(`${LOOPBACK_ORIGIN}:${port}${route}`);
      const text = await response.text();
      if (response.status !== 200) throw new Error(`${route} returned ${response.status}`);
      if (route.endsWith("/") && (!text.includes("<main id=\"main\">") || !text.includes("Intent: not assessed"))) throw new Error(`${route} lacks meaningful HTML`);
      results.push({ route, status: response.status, bytes: Buffer.byteLength(text) });
    }
  } finally {
    if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
    setDefaultResultOrder(previousResultOrder);
  }
  return { schema_version: "detecting_ai_deception_http_check_v1", result: "pass", route_count: results.length, routes: results };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await checkHttp(), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
