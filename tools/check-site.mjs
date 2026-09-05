#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEXNOW_KEY } from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PREFIX = "/detecting-ai-deception/";
const SITE_URL = `https://thedarknitefalls.github.io${SITE_PREFIX}`;
const PROJECT_URL = "https://github.com/TheDarkniteFalls/detecting-ai-deception";
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
  const descriptions = new Set();
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
    "schemas/deception-case-v1.schema.json",
    "schemas/agent-claim-check-input-v1.schema.json",
    "schemas/agent-claim-check-receipt-v1.schema.json",
    "schemas/agent-claim-check-error-v1.schema.json",
    "llms.txt", "robots.txt", "sitemap.xml",
    `${INDEXNOW_KEY}.txt`,
    ".nojekyll", "build-manifest.json",
  ];
  for (const required of requiredOutputs) if (!relativeFiles.has(required)) errors.push(`missing output ${required}`);
  const expectedOutput = new Set([...requiredRoutes, ...requiredOutputs]);
  for (const path of relativeFiles) if (!expectedOutput.has(path)) errors.push(`unexpected output ${path}`);
  if (htmlFiles.length !== 12) errors.push(`expected 12 HTML routes, found ${htmlFiles.length}`);
  if (files.length !== 29) errors.push(`expected 29 generated files, found ${files.length}`);
  if (!/^[0-9a-f]{32}$/.test(INDEXNOW_KEY)) errors.push("IndexNow key must be exactly 32 lowercase hexadecimal characters");
  const ownershipFiles = [...relativeFiles].filter((path) => /^[0-9a-f]{32}\.txt$/.test(path));
  if (ownershipFiles.length !== 1 || ownershipFiles[0] !== `${INDEXNOW_KEY}.txt`) errors.push("generated output must contain exactly one matching IndexNow ownership file");
  if (relativeFiles.has(`${INDEXNOW_KEY}.txt`)) {
    const keyText = await readFile(join(root, `${INDEXNOW_KEY}.txt`), "utf8");
    if (keyText !== `${INDEXNOW_KEY}\n`) errors.push("IndexNow ownership file bytes must contain only the key plus one newline");
  }

  for (const path of htmlFiles) {
    const pagePath = relative(root, path).split(sep).join("/").replace(/index\.html$/, "");
    const html = await readFile(path, "utf8");
    if (html.includes(INDEXNOW_KEY)) errors.push(`${pagePath}: IndexNow key must not appear in visible HTML or structured data`);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    if (!title) errors.push(`${pagePath}: missing title`);
    else if (titles.has(title)) errors.push(`${pagePath}: duplicate title ${title}`);
    else titles.add(title);
    const description = html.match(/<meta name="description" content="([^"]+)">/)?.[1];
    if (!description) errors.push(`${pagePath}: missing description content`);
    else if (descriptions.has(description)) errors.push(`${pagePath}: duplicate description ${description}`);
    else descriptions.add(description);
    for (const marker of [
      '<meta name="description"', '<link rel="canonical"', 'property="og:title"',
      'type="application/ld+json"', 'class="skip-link"', '<main id="main">',
      '<meta name="robots" content="index,follow,max-snippet:-1">',
      '<link rel="describedby"', '<noscript>', 'data-cases-url=', 'Intent: not assessed',
    ]) if (!html.includes(marker)) errors.push(`${pagePath}: missing ${marker}`);
    const globalHeader = html.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0] ?? "";
    const navPositions = ["Practice", "How to check", "Use the checker", "Submit evidence", "About"]
      .map((label) => globalHeader.indexOf(`>${label}</a>`));
    if (!navPositions.every((position, index) => position >= 0 && (index === 0 || position > navPositions[index - 1]))) {
      errors.push(`${pagePath}: expanded primary navigation is missing or out of order`);
    }
    for (const marker of ['class="mobile-cases-link"', 'aria-label="Mobile primary"', '>Intent boundary</a>', 'about/#intent-boundary']) {
      if (!globalHeader.includes(marker)) errors.push(`${pagePath}: navigation is missing ${marker}`);
    }
    const current = html.match(/<body data-page="([^"]+)"/)?.[1] ?? "home";
    const expectedCurrentCount = current === "home" ? 0 : 2;
    if ((globalHeader.match(/aria-current="page"/g) ?? []).length !== expectedCurrentCount) {
      errors.push(`${pagePath}: navigation current-page semantics are incorrect`);
    }
    if (/<meta\s+name=["']keywords["']/i.test(html)) errors.push(`${pagePath}: meta keywords are prohibited`);
    if (html.includes('"@type":"FAQPage"')) errors.push(`${pagePath}: FAQPage structured data is prohibited`);
    const structuredText = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    if (!structuredText) {
      errors.push(`${pagePath}: missing parseable structured data`);
    } else {
      try {
        const structured = JSON.parse(structuredText);
        const graph = structured["@graph"];
        if (!Array.isArray(graph)) errors.push(`${pagePath}: structured data does not use @graph`);
        else {
          const website = graph.find((item) => item["@type"] === "WebSite");
          const webPage = graph.find((item) => item["@type"] === "WebPage");
          if (website?.name !== "Detecting AI Deception" || website?.alternateName !== "DAID") errors.push(`${pagePath}: missing stable WebSite identity`);
          if (!webPage?.dateModified) errors.push(`${pagePath}: WebPage lacks deterministic dateModified`);
          const breadcrumb = graph.find((item) => item["@type"] === "BreadcrumbList");
          if (pagePath) {
            if (!html.includes('class="breadcrumbs" aria-label="Breadcrumb"')) errors.push(`${pagePath}: missing visible breadcrumb`);
            if (!breadcrumb || !Array.isArray(breadcrumb.itemListElement)) errors.push(`${pagePath}: missing BreadcrumbList structured data`);
          } else if (html.includes('class="breadcrumbs"') || breadcrumb) {
            errors.push("home must not render a redundant breadcrumb");
          }
        }
      } catch (error) {
        errors.push(`${pagePath}: invalid structured data JSON (${error.message})`);
      }
    }
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
    for (const marker of [
      'aria-label="On this case"', 'href="#make-your-call"', 'href="#read-plainly"',
      'href="#technical-record"', 'id="make-your-call"', 'id="read-plainly"', 'id="technical-record"',
    ]) if (!html.includes(marker)) errors.push(`${relative(root, path)}: missing case navigation contract ${marker}`);
  }

  const app = await readFile(join(root, "assets", "app.mjs"), "utf8");
  if (app.includes(INDEXNOW_KEY) || /api\.indexnow\.org|indexnow\.org/i.test(app)) errors.push("client runtime must not contain IndexNow key or submission behavior");
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
  const textOnLight = cssColor(styles, "text-on-light");
  const mutedOnLight = cssColor(styles, "muted-on-light");
  const accentOnLight = cssColor(styles, "accent-on-light");
  if (!bone || !violet || contrastRatio(bone, violet) < 4.5) errors.push("bone text on violet does not meet WCAG AA contrast");
  if (!black || !violetBright || contrastRatio(black, violetBright) < 4.5) errors.push("bright violet text on black does not meet WCAG AA contrast");
  if (!textOnLight || !bone || contrastRatio(textOnLight, bone) < 7) errors.push("primary text on the light surface does not meet WCAG AAA contrast");
  if (!mutedOnLight || !bone || contrastRatio(mutedOnLight, bone) < 7) errors.push("muted text on the light surface does not meet WCAG AAA contrast");
  if (!accentOnLight || !bone || contrastRatio(accentOnLight, bone) < 4.5) errors.push("accent text on the light surface does not meet WCAG AA contrast");
  if (!/\.band-white \.prose p,[\s\S]*?color:\s*var\(--muted-on-light\);/s.test(styles)) errors.push("light-surface prose does not use the semantic muted text role");
  if (!/\.band-white \.code-block code\s*\{[^}]*color:\s*var\(--mint\);/s.test(styles)) errors.push("light-surface code blocks do not preserve dark-surface code contrast");
  if (!/\.home-row-title\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s.test(styles)) errors.push("home case titles can break inside ordinary words");
  if (!/\.finding-summary h3\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s.test(styles)) errors.push("finding headings can break inside ordinary words");
  if (!/body\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s.test(styles)) errors.push("body text can break inside ordinary words");
  if (!/@media \(max-width: 52rem\)[\s\S]*?\.home-case-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s.test(styles)) errors.push("styles lack the two-column mobile practice-case selector");
  if (!/@media \(max-width: 22\.5rem\)[\s\S]*?\.home-case-grid\s*\{\s*grid-template-columns:\s*1fr;/s.test(styles)) errors.push("styles lack the one-column 320px practice-case selector");
  if (!/@media \(max-width: 40rem\)[\s\S]*?\.code-block\s*\{[^}]*overflow-x:\s*visible;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-wrap;/s.test(styles)) errors.push("mobile code blocks do not wrap without horizontal scrolling");
  if (/\.case-short-label\s*\{[^}]*color:\s*var\(--cobalt\)/s.test(styles)) errors.push("dark cobalt text is used on the black case-list surface");
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
    errors.push("home practice-case selector must contain exactly six cases");
  }
  if (!home.includes("Featured synthetic case 03")) {
    errors.push("home preview is not clearly identified as synthetic case 03");
  }
  for (const required of [
    "Check whether an AI answer is backed by the evidence.",
    "This site helps anyone reviewing an AI answer compare the claim with the evidence it would need and the record that exists.",
    "How the method helps you reach a defensible result.",
    "Practice with six synthetic cases.",
    "Know what the evidence can—and cannot—tell you.",
    "Challenge a result with evidence.",
    'href="#method-overview"',
    'id="method-overview"',
    'id="practice-cases"',
  ]) if (!home.includes(required)) errors.push(`home is missing visitor-first contract: ${required}`);
  for (const [label, value] of [["Claim", "30 days"], ["Required evidence", "30 days"], ["Observed record", "7 days"], ["Finding", "Choose, then reveal"]]) {
    if (!home.includes(`<dt>${label}</dt><dd>${value}</dd>`)) errors.push(`home featured case has incorrect ${label}`);
  }
  const featuredStart = home.indexOf('class="featured-case-panel"');
  const featuredEnd = home.indexOf("</a>", featuredStart);
  const featured = featuredStart >= 0 && featuredEnd > featuredStart ? home.slice(featuredStart, featuredEnd) : "";
  if (!featured.includes("Open the case and make the narrowest call the evidence supports.")) errors.push("home featured case lacks its blind-practice invitation");
  if (featured.includes("Contradicted") || featured.includes("The cited passage does not support the answer.")) errors.push("home featured case reveals its answer");
  if (home.includes("hero-evidence-object")) errors.push("home still renders the evidence sculpture");
  if (home.includes("case-index-band")) errors.push("home still renders the duplicate detailed case inventory");
  if ((home.match(/class="home-case-index"/g) ?? []).length !== 1) errors.push("home must contain exactly one compact practice-case inventory");
  const homeSectionOrder = ["home-opening", "method-band", "home-case-index", "trust-band", "challenge-band"]
    .map((className) => home.indexOf(`class="${className}`));
  if (!homeSectionOrder.every((position, index) => position >= 0 && (index === 0 || position > homeSectionOrder[index - 1]))) {
    errors.push("home visitor-first sections are out of order");
  }

  const expectedTitles = new Map([
    ["index.html", "Detecting AI Deception: Check AI Claims Against Evidence"],
    ["cases/index.html", "Practice Checking AI Claims Against Evidence · Detecting AI Deception"],
    ["method/index.html", "How to Check AI Claims Against Evidence · Detecting AI Deception"],
    ["tools/index.html", "AI Evidence-Checking Tools and Exact Sources · Detecting AI Deception"],
    ["challenge/index.html", "Reproduce or Challenge an AI Evidence Finding · Detecting AI Deception"],
    ["about/index.html", "How Detecting AI Deception Produces Reproducible Findings · Detecting AI Deception"],
  ]);
  for (const [path, expected] of expectedTitles) {
    const html = await readFile(join(root, path), "utf8");
    if (!html.includes(`<title>${expected}</title>`)) errors.push(`${path}: search title does not match the visitor intent`);
  }

  const method = await readFile(join(root, "method", "index.html"), "utf8");
  for (const question of [
    "How do I check whether an AI answer is supported?",
    "How do I verify an AI citation?",
    "What is the difference between contradicted and insufficient evidence?",
    "Does an unsupported claim prove AI deception or intent?",
  ]) if (!method.includes(question)) errors.push(`method page is missing search-intent answer: ${question}`);
  for (const term of ["AI hallucination", "fabricated citation", "Intent is always not assessed"]) {
    if (!method.includes(term)) errors.push(`method page is missing bounded ordinary-language term: ${term}`);
  }
  if (!method.includes('href="../cases/unsupported-citation/"')) errors.push("method citation guidance lacks a crawlable practice-case link");
  for (const marker of [
    "Use this four-line record on another AI answer",
    "Claim:\nRequired evidence:\nObserved record (source, exact revision or date, passage):\nFinding: Supported / Contradicted / Insufficient evidence — Intent: not assessed",
    "Practice the template on Case 03", "Browse all six cases", "Choose your next step", 'href="../challenge/"',
  ]) if (!method.includes(marker)) errors.push(`method page is missing transfer contract: ${marker}`);

  const about = await readFile(join(root, "about", "index.html"), "utf8");
  for (const target of [
    'href="../llms.txt"',
    'href="../data/deception-cases.v1.json"',
    'href="../schemas/deception-case-v1.schema.json"',
    'href="../data/source-map.v1.json"',
    'href="../tools/"',
    'href="../challenge/"',
  ]) if (!about.includes(target)) errors.push(`about page is missing automated-reader route ${target}`);
  if (!about.includes("Machines can rely on the published classifier relationship")) errors.push("about page lacks a bounded automated-reader reliability statement");
  if (!about.includes('<h2 id="intent-boundary">What this is not</h2>')) errors.push("about page lacks the stable intent-boundary anchor");

  const casesLanding = await readFile(join(root, "cases", "index.html"), "utf8");
  if (casesLanding.indexOf('class="archive-records"') > casesLanding.lastIndexOf("Browse all six cases")) errors.push("archive records do not precede the global spine");
  if ((casesLanding.match(/data-library-outcome hidden/g) ?? []).length !== 6) errors.push("archive outcomes are not blind by default");
  for (const marker of [
    "Filtering by finding reveals the case outcomes before you open them.",
    "No cases match both filters. Change a filter or browse all six below.",
    'data-finding-disclosure hidden', 'data-filter-empty hidden',
  ]) if (!casesLanding.includes(marker)) errors.push(`cases landing page is missing filter contract: ${marker}`);
  if (!casesLanding.includes('<link rel="alternate" href="../data/deception-cases.v1.json" type="application/json"')) errors.push("cases landing page lacks its collection-level JSON alternate");
  const casesStructured = JSON.parse(casesLanding.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  const dataset = casesStructured["@graph"].find((item) => item["@type"] === "Dataset");
  if (!dataset) errors.push("cases landing page lacks Dataset structured data");
  else {
    if (dataset.version !== "deception_case_pack_v1" || dataset.dateModified !== "2026-08-23") errors.push("Dataset version or reviewed-through date is inaccurate");
    if (dataset.license !== "https://creativecommons.org/licenses/by/4.0/") errors.push("Dataset license is inaccurate");
    if (dataset.distribution?.encodingFormat !== "application/json" || dataset.distribution?.contentUrl !== `${SITE_URL}data/deception-cases.v1.json`) errors.push("Dataset DataDownload is inaccurate");
    if (dataset.hasPart?.length !== 6) errors.push("Dataset must reference exactly six case resources");
  }
  for (const path of caseHtml) {
    const html = await readFile(path, "utf8");
    const structured = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    const webPage = structured["@graph"].find((item) => item["@type"] === "WebPage");
    const resource = structured["@graph"].find((item) => item["@type"] === "LearningResource");
    if (webPage?.dateModified !== "2026-08-27") errors.push(`${relative(root, path)}: WebPage dateModified must reflect the discovery-page change`);
    if (html.includes('<link rel="alternate"') && html.includes('type="application/json"')) errors.push(`${relative(root, path)}: case page incorrectly treats the six-case pack as its alternate representation`);
    if (!resource) errors.push(`${relative(root, path)}: missing LearningResource structured data`);
    else {
      if (resource.learningResourceType !== "Synthetic practice case" || resource.educationalUse !== "Practice") errors.push(`${relative(root, path)}: inaccurate learning-resource semantics`);
      if (resource.dateModified !== "2026-08-23") errors.push(`${relative(root, path)}: LearningResource reviewed date is inaccurate`);
      const aboutNames = new Set(resource.about?.filter((item) => item["@type"] === "Thing").map((item) => item.name));
      if (![...aboutNames].some((name) => typeof name === "string" && name.startsWith("Finding: "))) errors.push(`${relative(root, path)}: structured data omits the exact finding`);
      if (!aboutNames.has("Intent: not assessed")) errors.push(`${relative(root, path)}: structured data omits the intent boundary`);
      if (!aboutNames.has("Synthetic practice case")) errors.push(`${relative(root, path)}: structured data omits the synthetic boundary`);
      if ("additionalProperty" in resource) errors.push(`${relative(root, path)}: LearningResource uses unsupported additionalProperty semantics`);
    }
  }

  const llms = await readFile(join(root, "llms.txt"), "utf8");
  if (llms.includes(INDEXNOW_KEY)) errors.push("llms.txt must not expose the IndexNow key location");
  for (const marker of [
    "# Detecting AI Deception",
    "> Check whether an AI answer or citation is backed by the available evidence without guessing at intent.",
    "## Start",
    "## Exact practice-case records",
    "## Machine-readable evidence",
    "## Reproduce, challenge and inspect",
    "## Evidence boundaries",
    "Intent is always not assessed.",
  ]) if (!llms.includes(marker)) errors.push(`llms.txt is missing ${marker}`);
  for (const id of ["missing-file", "reassuring-average", "unsupported-citation", "wrong-product-identity", "lost-response", "revision-bound-claim"]) {
    const expected = `${SITE_PREFIX}cases/${id}/`;
    if (!llms.includes(expected)) errors.push(`llms.txt is missing exact case route ${id}`);
  }
  for (const route of ["data/deception-cases.v1.json", "schemas/deception-case-v1.schema.json", "data/source-map.v1.json", "method/", "tools/", "challenge/", "about/"]) {
    if (!llms.includes(`${SITE_PREFIX}${route}`)) errors.push(`llms.txt is missing authoritative route ${route}`);
  }
  const llmsLinesAfterFirstH2 = llms.slice(llms.indexOf("## ")).split("\n");
  for (const line of llmsLinesAfterFirstH2) {
    if (!line || line.startsWith("## ") || /^- \[[^\]]+\]\(https:\/\/[^)]+\): .+/.test(line)) continue;
    errors.push(`llms.txt has non-link-list content after its first H2: ${line}`);
  }
  for (const section of llms.split(/^## /m).slice(1)) {
    const lines = section.split("\n").slice(1).filter(Boolean);
    if (!lines.length || lines.some((line) => !/^- \[[^\]]+\]\(https:\/\/[^)]+\): .+/.test(line))) errors.push("llms.txt H2 sections must contain only descriptive file links");
  }
  if ((llms.match(/^# /gm) ?? []).length !== 1 || !/^# Detecting AI Deception\n\n> /m.test(llms)) errors.push("llms.txt must have one H1 followed by one blockquote summary");
  if (!llms.includes("It does not claim search ranking or inclusion.")) errors.push("llms.txt lacks its no-ranking boundary");
  for (const target of [
    "https://thedarknitefalls.github.io/detecting-ai-deception/tools/#agent-claim-check-v1",
    "https://github.com/TheDarkniteFalls/detecting-ai-deception/blob/main/docs/agent-claim-check-v1.md",
  ]) if (!llms.includes(target)) errors.push(`llms.txt is missing Agent Claim Check route ${target}`);
  for (const boundary of ["dependency-free", "offline", "deterministic", "non-authorizing"]) {
    if (!llms.includes(boundary)) errors.push(`llms.txt is missing Agent Claim Check boundary ${boundary}`);
  }

  const robots = await readFile(join(root, "robots.txt"), "utf8");
  if (robots.includes(INDEXNOW_KEY)) errors.push("robots.txt must not contain the IndexNow key");
  for (const agent of ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "*"]) {
    if (!robots.includes(`User-agent: ${agent}\nAllow: /`)) errors.push(`robots.txt lacks an allow directive for ${agent}`);
  }
  if (!robots.includes(`Sitemap: https://thedarknitefalls.github.io${SITE_PREFIX}sitemap.xml`)) errors.push("robots.txt lacks the canonical sitemap pointer");

  const sitemap = await readFile(join(root, "sitemap.xml"), "utf8");
  if (sitemap.includes(INDEXNOW_KEY)) errors.push("sitemap must contain only canonical HTML routes, not the IndexNow key file");
  const sitemapEntries = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)]
    .map((match) => ({ url: match[1], lastmod: match[2] }));
  if (sitemapEntries.length !== 12) errors.push(`sitemap must contain 12 dated routes, found ${sitemapEntries.length}`);
  for (const entry of sitemapEntries) {
    const expectedDate = entry.url === `${SITE_URL}tools/` ? "2026-08-30" : "2026-08-27";
    if (entry.lastmod !== expectedDate) errors.push(`sitemap lastmod mismatch for ${entry.url}: ${entry.lastmod}`);
  }
  if (/<(?:priority|changefreq)>/.test(sitemap)) errors.push("sitemap includes ignored priority or changefreq fields");

  const tools = await readFile(join(root, "tools", "index.html"), "utf8");
  if ((tools.match(/id="agent-claim-check-v1"/g) ?? []).length !== 1) errors.push("Tools must contain exactly one Agent Claim Check fragment");
  if (tools.indexOf('id="agent-claim-check-v1"') >= tools.indexOf("Supporting evidence routes")) errors.push("Agent Claim Check must precede supporting evidence routes");
  for (const marker of [
    "Run Agent Claim Check v1",
    "node tools/check-agent-claim.mjs examples/agent-claim-check-v1/supported.json",
    'intent_assessment: "not-assessed"',
    "downstream_action_authorized: false",
    'does_not_establish: ["correctness", "safety", "identity", "successful-execution", "authority", "permission"]',
    "A supported finding describes only the declared claim/evidence relationship. It is not permission to act.",
  ]) if (!tools.includes(marker)) errors.push(`Tools is missing Agent Claim Check contract: ${marker}`);
  for (const href of [
    `${SITE_URL}tools/#agent-claim-check-v1`,
    `${PROJECT_URL}/blob/main/docs/agent-claim-check-v1.md`,
    `${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/supported.json`,
    `${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/contradicted.json`,
    `${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/insufficient-evidence.json`,
    `${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/invalid-input.json`,
    `${PROJECT_URL}/blob/main/tools/check-agent-claim.mjs`,
    `${PROJECT_URL}/blob/main/src/agent-claim-check.mjs`,
    `${SITE_URL}schemas/agent-claim-check-input-v1.schema.json`,
    `${SITE_URL}schemas/agent-claim-check-receipt-v1.schema.json`,
    `${SITE_URL}schemas/agent-claim-check-error-v1.schema.json`,
    `${PROJECT_URL}/blob/main/LICENSING.md`,
    `${PROJECT_URL}/blob/main/SECURITY.md`,
    `${SITE_URL}challenge/`,
  ]) {
    if (href.endsWith("tools/#agent-claim-check-v1")) continue;
    if (!tools.includes(`href="${href}"`)) errors.push(`Tools is missing exact Agent Claim Check href ${href}`);
  }
  if (/<(?:form|input|textarea|select)\b/i.test(tools)) errors.push("Tools introduces an input or upload surface");

  const challenge = await readFile(join(root, "challenge", "index.html"), "utf8");
  if (!challenge.includes("Choose the route that matches what you found. Keep submissions public-safe; local reproduction is optional.")) errors.push("challenge page is missing its evidence-first lead");
  const challengeOrder = ["Counterexample", "Reproduction result", "New synthetic case", "Accessibility or site defect", "Optional local checker", "Public-safety boundary"]
    .map((label) => challenge.indexOf(label));
  if (!challengeOrder.every((position, index) => position >= 0 && (index === 0 || position > challengeOrder[index - 1]))) errors.push("challenge route order is incorrect");
  if (!challenge.includes("Local reproduction is optional.")) errors.push("challenge page does not describe local reproduction as optional");

  const supportingRoutes = [
    ["cases/index.html", "Practice checking AI claims against the evidence."],
    ["method/index.html", "Check an AI claim against the evidence."],
    ["about/index.html", "Inspect how every result was produced."],
  ];
  for (const [path, heading] of supportingRoutes) {
    const html = await readFile(join(root, path), "utf8");
    if (!html.includes(heading)) errors.push(`${path}: missing visitor-centered introduction`);
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
    if (!html.includes("Choose another practice case")) errors.push(`${relative(root, path)}: missing compact practice-case chooser`);
    if (html.indexOf("case-record-band") > html.indexOf("case-spine-band")) errors.push(`${relative(root, path)}: case chooser appears before the evidence interaction`);
  }
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "sendBeacon", "WebSocket", "XMLHttpRequest"]) {
    if (app.includes(forbidden)) errors.push(`app includes forbidden persistence/network primitive ${forbidden}`);
  }
  if (/fetch\s*\(\s*["']https?:/i.test(app)) errors.push("app includes external fetch");
  for (const marker of ["normalizeFilterValue", "revealsLibraryOutcomes", "data-library-outcome", "data-finding-disclosure", "data-filter-empty", "history.replaceState", 'addEventListener("popstate"']) {
    if (!app.includes(marker)) errors.push(`app is missing archive runtime contract ${marker}`);
  }
  if (!/target instanceof HTMLAnchorElement && isSameDocumentFragmentHref\(target\.href, location\.href\)\) return;/.test(app)) {
    errors.push("same-document fragment links do not bypass focus recentering");
  }
  const sourceClassifier = await readFile(join(ROOT, "src", "classifier.mjs"));
  const builtClassifier = await readFile(join(root, "assets", "classifier.mjs"));
  if (!sourceClassifier.equals(builtClassifier)) errors.push("browser classifier differs from Node source classifier");
  for (const schemaName of [
    "agent-claim-check-input-v1.schema.json",
    "agent-claim-check-receipt-v1.schema.json",
    "agent-claim-check-error-v1.schema.json",
  ]) {
    const sourceSchema = await readFile(join(ROOT, "schemas", schemaName));
    const builtSchema = await readFile(join(root, "schemas", schemaName));
    if (!sourceSchema.equals(builtSchema)) errors.push(`${schemaName}: generated schema is not byte-identical to source`);
    const schema = JSON.parse(builtSchema);
    if (schema.$id !== `${SITE_URL}schemas/${schemaName}`) errors.push(`${schemaName}: canonical $id mismatch`);
  }

  const manifestText = await readFile(join(root, "build-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.schema_version !== "detecting_ai_deception_build_manifest_v1") errors.push("build manifest schema is invalid");
  if (manifest.file_count !== manifest.files.length) errors.push("build manifest count mismatch");
  if (manifest.file_count !== 28) errors.push(`build manifest must contain 28 entries, found ${manifest.file_count}`);
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
