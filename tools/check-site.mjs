#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PREFIX = "/detecting-ai-deception/";
const SCULPTURE_ASSET = "assets/claim-record-evidence-sculpture.png";
const SCULPTURE_SHA256 = "8c9080e23d909c3d80835c7d5f1f8e52843ba32cc30883a91ec3e434a8b0a4a6";

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files.sort();
}

function internalTarget(href, pagePath) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return null;
  const url = new URL(href, `https://thedarknitefalls.github.io${SITE_PREFIX}${pagePath}`);
  if (url.origin !== "https://thedarknitefalls.github.io" || !url.pathname.startsWith(SITE_PREFIX)) return null;
  let path = decodeURIComponent(url.pathname.slice(SITE_PREFIX.length));
  if (!path || path.endsWith("/")) path += "index.html";
  return path;
}

function cssColor(styles, name) {
  return styles.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

export async function checkSite(root = join(ROOT, "dist")) {
  root = resolve(root);
  const errors = [];
  const files = await listFiles(root);
  const relativeFiles = new Set(files.map((path) => relative(root, path).split(sep).join("/")));
  const htmlFiles = files.filter((path) => path.endsWith(".html"));
  const titles = new Set();
  const requiredRoutes = [
    "index.html", "cases/index.html", "cases/missing-file/index.html",
    "cases/reassuring-average/index.html", "cases/unsupported-citation/index.html",
    "cases/wrong-product-identity/index.html", "cases/lost-response/index.html",
    "cases/revision-bound-claim/index.html", "method/index.html",
    "tools/index.html", "challenge/index.html", "about/index.html",
  ];
  for (const route of requiredRoutes) if (!relativeFiles.has(route)) errors.push(`missing route ${route}`);
  const requiredOutputs = [
    "assets/styles.css", "assets/app.mjs", "assets/classifier.mjs", "assets/favicon.svg",
    SCULPTURE_ASSET,
    "data/deception-cases.v1.json", "data/source-map.v1.json",
    "schemas/deception-case-v1.schema.json", "robots.txt", "sitemap.xml",
    ".nojekyll", "build-manifest.json",
  ];
  for (const required of requiredOutputs) if (!relativeFiles.has(required)) errors.push(`missing output ${required}`);
  const expectedOutput = new Set([...requiredRoutes, ...requiredOutputs]);
  for (const path of relativeFiles) if (!expectedOutput.has(path)) errors.push(`unexpected output ${path}`);

  for (const path of htmlFiles) {
    const pagePath = relative(root, path).split(sep).join("/").replace(/index\.html$/, "");
    const html = await readFile(path, "utf8");
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    if (!title) errors.push(`${pagePath}: missing title`);
    else if (titles.has(title)) errors.push(`${pagePath}: duplicate title ${title}`);
    else titles.add(title);
    for (const marker of [
      '<meta name="description"', '<link rel="canonical"', 'property="og:title"',
      'type="application/ld+json"', 'class="skip-link"', '<main id="main">',
      '<noscript>', 'data-cases-url=', 'Intent: not assessed',
    ]) if (!html.includes(marker)) errors.push(`${pagePath}: missing ${marker}`);
    if (/<span class="evidence-state [^"]+">[^<]+<\/span><strong>/.test(html)) {
      errors.push(`${pagePath}: evidence status is concatenated with its question`);
    }
    if (/google-analytics|googletagmanager|plausible|segment\.com|hotjar|mixpanel/i.test(html)) errors.push(`${pagePath}: tracker-like content`);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = internalTarget(match[1], pagePath);
      if (target && !relativeFiles.has(target)) errors.push(`${pagePath}: broken internal target ${match[1]} -> ${target}`);
    }
  }

  const caseHtml = htmlFiles.filter((path) => relative(root, path).split(sep).join("/").startsWith("cases/") && !path.endsWith("cases/index.html"));
  if (caseHtml.length !== 6) errors.push(`expected 6 permanent case pages, found ${caseHtml.length}`);
  for (const path of caseHtml) {
    const html = await readFile(path, "utf8");
    for (const question of ["What happened?", "Why does it matter?", "How do we know?", "What remains unknown?", "What can someone do next?"]) {
      if (!html.includes(question)) errors.push(`${relative(root, path)}: missing guiding question ${question}`);
    }
    if (!html.includes("exact source revision")) errors.push(`${relative(root, path)}: missing exact source revision link`);
    if (!html.includes("Limitations and non-claims")) errors.push(`${relative(root, path)}: missing non-claims`);
  }

  const app = await readFile(join(root, "assets", "app.mjs"), "utf8");
  const styles = await readFile(join(root, "assets", "styles.css"), "utf8");
  const sourceSculpture = await readFile(join(ROOT, "src", "site", "assets", "claim-record-evidence-sculpture.png"));
  const builtSculpture = await readFile(join(root, SCULPTURE_ASSET));
  if (!sourceSculpture.equals(builtSculpture)) errors.push("generated evidence sculpture differs from its source asset");
  if (createHash("sha256").update(builtSculpture).digest("hex") !== SCULPTURE_SHA256) errors.push("evidence sculpture provenance hash changed");
  if (!/\.evidence-state\s*\{[^}]*display:\s*block;[^}]*margin-bottom:\s*0\.35rem;/s.test(styles)) {
    errors.push("evidence status lacks the required visual separation from its question");
  }
  if (styles.includes("data:image/png;base64")) errors.push("shared styles embed the home-only evidence sculpture");
  if (!styles.includes(`--evidence-sculpture: url("./claim-record-evidence-sculpture.png")`)) errors.push("styles do not reference the local evidence sculpture asset");
  const bone = cssColor(styles, "bone");
  const violet = cssColor(styles, "violet");
  const black = cssColor(styles, "black");
  const violetBright = cssColor(styles, "violet-bright");
  if (!bone || !violet || contrastRatio(bone, violet) < 4.5) errors.push("bone text on violet does not meet WCAG AA contrast");
  if (!black || !violetBright || contrastRatio(black, violetBright) < 4.5) errors.push("bright violet text on black does not meet WCAG AA contrast");
  if (!/\.home-row-title\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s.test(styles)) errors.push("home case titles can break inside ordinary words");
  if (!/@media \(max-width: 22rem\)[\s\S]*?grid-template-columns:\s*3\.25rem minmax\(0, 1fr\) 4rem 1\.5rem;/s.test(styles)) errors.push("styles lack the exact 320px case-row allocation");
  if (/(?:linear|radial|conic)-gradient\s*\(/i.test(styles)) errors.push("styles include a prohibited gradient");
  if (/@import|url\(\s*["']?https?:/i.test(styles)) errors.push("styles include an external font or network asset");
  if (!styles.includes("@media (prefers-reduced-motion: reduce)")) errors.push("styles lack a reduced-motion mode");
  if (!styles.includes(":focus-visible")) errors.push("styles lack a visible keyboard-focus rule");

  const home = await readFile(join(root, "index.html"), "utf8");
  if ((home.match(/data-home-preview="unsupported-citation"/g) ?? []).length !== 1) {
    errors.push("home must preview the existing unsupported-citation case exactly once");
  }
  if ((home.match(/data-synthetic-case/g) ?? []).length !== 1) {
    errors.push("home must contain exactly one synthetic case preview");
  }
  if ((home.match(/data-spine-case=/g) ?? []).length !== 6) {
    errors.push("home case spine must contain exactly six cases");
  }
  if (!home.includes("Existing synthetic case · 03 of 06")) {
    errors.push("home preview is not clearly identified as existing synthetic case 03 of 06");
  }

  for (const path of caseHtml) {
    const html = await readFile(path, "utf8");
    for (const part of ["claim", "required-evidence", "observed-record", "finding"]) {
      if (!html.includes(`data-composition-part="${part}"`)) {
        errors.push(`${relative(root, path)}: missing Claim / Record composition part ${part}`);
      }
    }
    if (!html.includes("data-evidence-rail")) errors.push(`${relative(root, path)}: missing semantic evidence rail`);
    if (!html.includes("data-artifact-id=")) errors.push(`${relative(root, path)}: missing case-specific evidence object`);
  }
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "sendBeacon", "WebSocket", "XMLHttpRequest"]) {
    if (app.includes(forbidden)) errors.push(`app includes forbidden persistence/network primitive ${forbidden}`);
  }
  if (/fetch\s*\(\s*["']https?:/i.test(app)) errors.push("app includes external fetch");
  const sourceClassifier = await readFile(join(ROOT, "src", "classifier.mjs"));
  const builtClassifier = await readFile(join(root, "assets", "classifier.mjs"));
  if (!sourceClassifier.equals(builtClassifier)) errors.push("browser classifier differs from Node source classifier");

  const manifestText = await readFile(join(root, "build-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.schema_version !== "detecting_ai_deception_build_manifest_v1") errors.push("build manifest schema is invalid");
  if (manifest.file_count !== manifest.files.length) errors.push("build manifest count mismatch");
  if (manifest.file_count !== relativeFiles.size - 1) errors.push("build manifest does not cover the exact generated output scope");
  const manifestedPaths = new Set(manifest.files.map((item) => item.path));
  for (const path of relativeFiles) if (path !== "build-manifest.json" && !manifestedPaths.has(path)) errors.push(`manifest omits generated output ${path}`);
  for (const item of manifest.files) {
    const path = join(root, item.path);
    if (!relativeFiles.has(item.path)) { errors.push(`manifest missing file ${item.path}`); continue; }
    const bytes = await readFile(path);
    if (bytes.length !== item.bytes) errors.push(`manifest byte mismatch ${item.path}`);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) errors.push(`manifest digest mismatch ${item.path}`);
  }

  return {
    schema_version: "detecting_ai_deception_site_check_v1",
    result: errors.length ? "fail" : "pass",
    errors,
    html_count: htmlFiles.length,
    permanent_case_count: caseHtml.length,
    file_count: files.length,
  };
}

async function main() {
  const root = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "dist");
  const result = await checkSite(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
