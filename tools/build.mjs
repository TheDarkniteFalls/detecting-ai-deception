#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCase } from "../src/classifier.mjs";
import { validatePack } from "../src/validate-case.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = "https://thedarknitefalls.github.io/detecting-ai-deception/";
const PROJECT_URL = "https://github.com/TheDarkniteFalls/detecting-ai-deception";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const findingLabel = (value) => ({
  supported: "Supported",
  contradicted: "Contradicted",
  "insufficient-evidence": "Insufficient evidence",
})[value];

const stateLabel = (value) => ({
  supports: "Supports",
  contradictory: "Contradictory",
  absent: "Absent",
  unknown: "Unknown",
  stale: "Stale",
  inapplicable: "Inapplicable",
})[value];

function navigation(prefix, current) {
  const items = [
    ["cases", "Cases", `${prefix}cases/`],
    ["method", "Method", `${prefix}method/`],
    ["tools", "Tools", `${prefix}tools/`],
    ["challenge", "Challenge", `${prefix}challenge/`],
    ["about", "About", `${prefix}about/`],
  ];
  return `<header class="site-header"><div class="nav-shell">
    <a class="wordmark" href="${prefix}">Detecting AI Deception</a>
    <nav class="site-nav" aria-label="Primary">${items.map(([id, label, href]) => `<a href="${href}"${current === id ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
  </div></header>`;
}

function page({ path = "", title, description, content, prefix, current = "", type = "WebPage" }) {
  const canonical = new URL(path, SITE_URL).href;
  const fullTitle = title === "Detecting AI Deception" ? title : `${title} · Detecting AI Deception`;
  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": type,
    name: title,
    description,
    url: canonical,
    creator: { "@type": "Person", name: "Mike Parsons" },
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true,
  }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Detecting AI Deception">
  <link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${prefix}assets/styles.css">
  <script>document.documentElement.classList.add("js")</script>
  <script type="application/ld+json">${structured}</script>
</head>
<body data-cases-url="${prefix}data/deception-cases.v1.json">
  <a class="skip-link" href="#main">Skip to main content</a>
  ${navigation(prefix, current)}
  <noscript><div class="noscript-note">JavaScript is off. Every case, evidence trail and deterministic finding remains readable; filters and choose-then-reveal controls are shown without enhancement.</div></noscript>
  <div class="shell" aria-live="polite" data-app-status></div>
  <main id="main">${content}</main>
  <footer class="site-footer"><div class="shell footer-grid">
    <p>Mike-led public investigation, developed transparently with AI assistance. Observable claims are compared with observable evidence. Intent: not assessed.</p>
    <div class="footer-links"><a href="${prefix}about/">About</a><a href="${PROJECT_URL}">Source</a><a href="${PROJECT_URL}/blob/main/LICENSING.md">Licensing</a></div>
  </div></footer>
  <script type="module" src="${prefix}assets/app.mjs"></script>
</body>
</html>`;
}

function choiceForm(record) {
  return `<form data-finding-form data-case-id="${record.id}">
    <fieldset class="choice-fieldset">
      <legend>What does the evidence support?</legend>
      <div class="choice-list">
        <label class="choice"><input type="radio" name="finding" value="supported"><span><strong>Supported</strong><span>Every required item supports the claim.</span></span></label>
        <label class="choice"><input type="radio" name="finding" value="contradicted"><span><strong>Contradicted</strong><span>At least one required observation conflicts.</span></span></label>
        <label class="choice"><input type="radio" name="finding" value="insufficient-evidence"><span><strong>Insufficient evidence</strong><span>A required item is absent, unknown, stale or inapplicable.</span></span></label>
      </div>
    </fieldset>
    <button class="primary-button" type="submit">Reveal the evidence trail</button>
    <p class="choice-result" data-choice-result aria-live="polite"></p>
  </form>`;
}

function evidencePanel(record) {
  const finding = classifyCase(record);
  return `<section class="evidence-panel" data-evidence-panel aria-labelledby="evidence-${record.id}">
    <span class="panel-label">Observed evidence</span>
    <h3 id="evidence-${record.id}" data-reveal-heading tabindex="-1">What the record shows</h3>
    <ol class="evidence-trail">${record.observed_evidence.map((item) => {
      const requirement = record.required_evidence.find((candidate) => candidate.id === item.requirement_id);
      return `<li><span class="evidence-state state-${item.state}">${stateLabel(item.state)}</span> <strong>${escapeHtml(requirement.question)}</strong><p>${escapeHtml(item.observation)}</p></li>`;
    }).join("")}</ol>
    <div class="finding finding-${finding}"><strong>Finding: ${findingLabel(finding)}</strong><p>Intent: not assessed. This result compares only the declared claim and required evidence.</p></div>
    <p><strong>What remains unknown:</strong> ${escapeHtml(record.guiding_questions.what_remains_unknown)}</p>
  </section>`;
}

function investigation(record, number = "01") {
  return `<article class="investigation-sheet" data-case-interaction>
    <div class="case-mast"><span class="case-number">CASE ${number}</span><strong>${escapeHtml(record.title)}</strong><span class="case-class">${escapeHtml(record.failure_class.join(" · "))}</span></div>
    <div class="case-body">
      <section class="claim-panel"><span class="panel-label">The system claim</span><p class="system-claim">“${escapeHtml(record.system_claim)}”</p><p>${escapeHtml(record.plain_scenario)}</p>${choiceForm(record)}</section>
      ${evidencePanel(record)}
    </div>
  </article>`;
}

function routeList(cases, prefix) {
  return `<ol class="route-list">${cases.map((record, index) => `<li><a class="route-link" href="${prefix}cases/${record.id}/"><span class="route-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(record.title)}</strong>${escapeHtml(record.plain_scenario)}</span><span>${findingLabel(record.expected_finding)} · ${escapeHtml(record.failure_class.join(", "))}</span></a></li>`).join("")}</ol>`;
}

function home(pack) {
  const intro = pack.cases[0];
  return page({
    title: "Detecting AI Deception",
    description: "A calm public investigation of when AI claims and observable evidence do not match, with intent explicitly not assessed.",
    prefix: "./",
    path: "",
    content: `<section class="hero"><div class="shell hero-grid"><div><h1>When the claim and the evidence part ways.</h1><p class="lead">AI systems can overstate, omit or misrepresent what they have done. This project shows how to inspect the difference without pretending that error proves intent.</p></div><div class="hero-note"><strong>A sixty-second method</strong><p>Name the claim. Declare the evidence it would require. Observe the evidence. Classify the mismatch. Keep intent separate.</p><span class="intent-stamp">Intent: not assessed</span></div></div></section>
      <section class="band band-white"><div class="shell"><div class="section-intro"><h2>Try the first case</h2><p>Choose the finding you think the evidence supports. Then reveal the same deterministic trail used by the local Node.js checker.</p></div>${investigation(intro)}</div></section>
      <section class="band"><div class="shell"><div class="section-intro"><h2>Six ways evidence can change the answer</h2><p>These synthetic cases cover false completion, missing evaluation outcomes, unsupported citations, identity mismatch, ambiguous external effects and one supported control.</p></div>${routeList(pack.cases, "./")}</div></section>
      <section class="band band-white"><div class="narrow"><h2>Challenge the record</h2><p class="lead">A useful investigation must be reproducible and corrigible. Run the checker, inspect an exact source revision, or propose a public-safe counterexample.</p><a class="primary-button" href="challenge/">Reproduce or challenge a case</a> <a class="secondary-button" href="method/">Read the method</a></div></section>`,
  });
}

function casesIndex(pack) {
  const classes = [...new Set(pack.cases.flatMap((record) => record.failure_class))].sort();
  return page({
    title: "Case library",
    description: "Six synthetic cases for inspecting AI claims against required and observed evidence.",
    path: "cases/", prefix: "../", current: "cases",
    content: `<section class="case-page-header"><div class="shell"><h1 class="page-title">Case library</h1><p class="lead">Filter by deterministic finding or mismatch class. All six cases remain visible without JavaScript.</p><span class="intent-stamp">Intent: not assessed</span></div></section>
      <section class="band"><div class="shell"><form class="filter-bar" data-library-filters><label>Finding<select name="finding"><option value="all">All findings</option><option value="supported">Supported</option><option value="contradicted">Contradicted</option><option value="insufficient-evidence">Insufficient evidence</option></select></label><label>Failure class<select name="class"><option value="all">All classes</option>${classes.map((value) => `<option value="${value}">${escapeHtml(value)}</option>`).join("")}</select></label><p class="filter-count" data-filter-count>${pack.cases.length} of ${pack.cases.length} cases shown</p></form>
      <ol class="case-library">${pack.cases.map((record, index) => `<li class="case-row" data-case-row data-finding="${record.expected_finding}" data-classes="${record.failure_class.join(" ")}"><a class="case-link" href="${record.id}/"><span class="route-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(record.title)}</strong>${escapeHtml(record.plain_scenario)}</span><span>${findingLabel(record.expected_finding)} · ${escapeHtml(record.failure_class.join(", "))}</span></a></li>`).join("")}</ol></div></section>`,
  });
}

function casePage(record, index) {
  const questions = [
    ["What happened?", record.guiding_questions.what_happened],
    ["Why does it matter?", record.guiding_questions.why_it_matters],
    ["How do we know?", record.guiding_questions.how_we_know],
    ["What remains unknown?", record.guiding_questions.what_remains_unknown],
    ["What can someone do next?", record.guiding_questions.what_next],
  ];
  return page({
    title: record.title,
    description: record.plain_scenario,
    path: `cases/${record.id}/`, prefix: "../../", current: "cases", type: "Article",
    content: `<header class="case-page-header"><div class="shell"><h1>${escapeHtml(record.title)}</h1><p class="lead">${escapeHtml(record.plain_scenario)}</p><div class="case-meta"><span><strong>Finding:</strong> ${findingLabel(record.expected_finding)}</span><span><strong>Class:</strong> ${escapeHtml(record.failure_class.join(", "))}</span><span><strong>Reviewed through:</strong> ${record.reviewed_through}</span><span><strong>Intent:</strong> not assessed</span></div></div></header>
      <section class="band band-white"><div class="shell">${investigation(record, String(index + 1).padStart(2, "0"))}</div></section>
      <section class="band"><div class="shell"><div class="section-intro"><h2>Five questions</h2><p>Plain-language answers come before the technical record. Each answer stays inside the case's declared boundary.</p></div><div class="question-grid">${questions.map(([question, answer]) => `<article class="question-answer"><h3>${question}</h3><p>${escapeHtml(answer)}</p></article>`).join("")}</div></div></section>
      <section class="band band-white"><div class="narrow"><h2>Technical record</h2><h3>Reproduce</h3><p>${escapeHtml(record.reproduction.summary)}</p><pre class="code-block"><code>${escapeHtml(record.reproduction.command)}</code></pre><h3>Exact sources</h3><ul class="source-list">${record.source_links.map((source) => `<li><a href="${source.url}">${escapeHtml(source.label)}</a><span class="source-revision">Reviewed through ${source.reviewed_through} · <a href="${source.revision_url}">exact source revision</a> · ${escapeHtml(source.license_note)}</span></li>`).join("")}</ul><h3>Limitations and non-claims</h3><ul>${record.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p class="note"><strong>Intent remains not assessed.</strong> This case does not claim consciousness, malicious intent, strategic scheming, universal safety failure, certification or a deception score.</p></div></section>`,
  });
}

function methodPage() {
  return page({
    title: "Method",
    description: "The finding taxonomy, deterministic evidence rule, quality method, limitations and glossary for Detecting AI Deception.",
    path: "method/", prefix: "../", current: "method",
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">A method for checking the difference.</h1><p class="lead">This project classifies observable support for a bounded claim. It does not decide whether a system intended to mislead.</p><span class="intent-stamp">Intent: not assessed</span></div></header><div class="narrow prose">
      <h2>Three findings</h2><h3>Supported</h3><p>Every declared required evidence item supports the claim.</p><h3>Contradicted</h3><p>At least one required observation directly conflicts with the claim. Contradiction takes precedence over missing evidence.</p><h3>Insufficient evidence</h3><p>A required observation is absent, unknown, stale or inapplicable, and no required observation directly contradicts the claim.</p>
      <h2>The deterministic rule</h2><pre class="code-block"><code>if any required observation is contradictory:
  contradicted
else if any required observation is absent, unknown, stale or inapplicable:
  insufficient-evidence
else:
  supported</code></pre><p>The browser and <code>node tools/check-cases.mjs --self-test</code> import the same pure classifier.</p>
      <h2>Quality method</h2><ol><li>Name one bounded system claim.</li><li>Declare the evidence that claim would require before looking at the outcome.</li><li>Record each observation and its state.</li><li>Run the deterministic classifier.</li><li>Publish exact source revisions, reviewed-through dates, limitations and non-claims.</li><li>Invite a public-safe reproduction or counterexample.</li></ol>
      <h2>Failure classes</h2><ul><li><strong>false-completion:</strong> claimed work is absent from final state.</li><li><strong>material-omission:</strong> a decision-relevant absence is hidden from the account.</li><li><strong>provenance-or-identity-mismatch:</strong> evidence belongs to a different subject.</li><li><strong>evaluation-gap:</strong> the intended evaluation set is not accounted for.</li><li><strong>ambiguous-external-effect:</strong> a consequential result is unknown after a lost response.</li><li><strong>context-or-citation-escape:</strong> the answer outruns its supplied evidence.</li></ul>
      <h2>Limitations</h2><p>The cases are synthetic teaching records. They do not estimate prevalence, authenticate reviewers, test live models, diagnose internal cognition, certify products or rank systems. Real investigations need threat-aware handling of sensitive evidence and independent review.</p>
      <h2>Glossary</h2><dl><dt><strong>Claim</strong></dt><dd>A bounded statement that can be compared with declared evidence.</dd><dt><strong>Required evidence</strong></dt><dd>What would need to be observed for the claim to be supported.</dd><dt><strong>Observation</strong></dt><dd>The recorded state of one required evidence item.</dd><dt><strong>Reviewed through</strong></dt><dd>The date through which a source revision was checked for this case.</dd><dt><strong>Non-claim</strong></dt><dd>An explicit boundary on what the evidence does not establish.</dd></dl>
    </div>`,
  });
}

function toolsPage(sourceMap) {
  const routes = sourceMap.sources.filter((source) => source.id !== "reliability-navigator");
  return page({
    title: "Tools and deeper routes",
    description: "Curated public tools for revision evidence, missing evaluations, grounding, identity and ambiguous external effects.",
    path: "tools/", prefix: "../", current: "tools",
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">Follow the evidence deeper.</h1><p class="lead">Each route has an exact reviewed public revision and a narrow role. This site does not copy or silently extend those projects.</p></div></header><section class="band"><div class="shell"><ol class="route-list">${routes.map((source, index) => `<li><a class="route-link" href="${source.revision_url}"><span class="route-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(source.id.replaceAll("-", " "))}</strong>${escapeHtml(source.role)}</span><span>Exact revision<br>${source.revision.slice(0, 12)}</span></a></li>`).join("")}</ol></div></section><section class="band band-white"><div class="narrow"><h2>Need the complete toolkit?</h2><p>The Reliability Navigator covers the wider public set of guides, starters and runnable checks. Its route recommendation is not certification that a tool fits every setup.</p><a class="primary-button" href="https://thedarknitefalls.github.io/local-assistant-reliability-lab/">Open the Reliability Navigator</a><p class="source-revision"><a href="${sourceMap.sources.find((source) => source.id === "reliability-navigator").revision_url}">Public baseline reviewed for this map</a></p></div></section>`,
  });
}

function challengePage() {
  const issueBase = `${PROJECT_URL}/issues/new?template=`;
  return page({
    title: "Reproduce or challenge",
    description: "Run the dependency-free checker or open a public-safe reproduction, counterexample, case proposal or accessibility report.",
    path: "challenge/", prefix: "../", current: "challenge",
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">The record should be challengeable.</h1><p class="lead">Reproduce the six synthetic cases locally, then report the smallest public-safe result that could change the account.</p></div></header><div class="narrow prose"><h2>Run the checker</h2><pre class="code-block"><code>git clone https://github.com/TheDarkniteFalls/detecting-ai-deception.git
cd detecting-ai-deception
node tools/check-cases.mjs --self-test
npm test</code></pre><p>No dependency install, account, model or network service is needed after cloning.</p><h2>Structured issue routes</h2><ul class="route-list"><li><a class="route-link" href="${issueBase}reproduction.yml"><span class="route-index">01</span><span><strong>Reproduction result</strong>Share an exact command, revision and public-safe output.</span><span>Issue template</span></a></li><li><a class="route-link" href="${issueBase}counterexample.yml"><span class="route-index">02</span><span><strong>Counterexample</strong>Show evidence that changes a case classification or boundary.</span><span>Issue template</span></a></li><li><a class="route-link" href="${issueBase}new-case.yml"><span class="route-index">03</span><span><strong>New synthetic case</strong>Propose an issue-first claim and evidence record.</span><span>Issue template</span></a></li><li><a class="route-link" href="${issueBase}accessibility.yml"><span class="route-index">04</span><span><strong>Accessibility or site defect</strong>Report a reproducible barrier without sensitive data.</span><span>Issue template</span></a></li></ul><h2>Public-safety boundary</h2><p class="note">Do not submit private logs, credentials, personal data, unpublished material, sensitive vulnerability detail or confidential model interactions. Replace them with the smallest synthetic reproduction. Use the security policy for sensitive vulnerabilities.</p></div>`,
  });
}

function aboutPage() {
  return page({
    title: "About",
    description: "Why Mike Parsons started Detecting AI Deception, the project's principles and its AI-assistance disclosure.",
    path: "about/", prefix: "../", current: "about",
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">An investigation led by Mike Parsons.</h1><p class="lead">The project began with a practical question: when an AI-assisted account sounds complete, what evidence would let another person check it?</p></div></header><div class="narrow prose"><h2>Motivation</h2><p>AI systems can make confident statements about files, sources, evaluations, identities and external actions. Some are supported. Some conflict with observable state. Some cannot be resolved with the evidence available. Treating all three as the same makes both trust and criticism less useful.</p><h2>Principles</h2><ul><li>Compare bounded claims with declared evidence.</li><li>Show missingness beside aggregates.</li><li>Bind public claims to exact identities and source revisions.</li><li>Keep consequential action ambiguity visible until state is reconciled.</li><li>State what remains unknown and what the evidence does not prove.</li><li>Invite reproducible, public-safe counterexamples.</li></ul><h2>AI-assistance disclosure</h2><p>Mike Parsons leads the investigation and is responsible for its public framing. AI assistance was used to help structure, draft, implement and test this repository. The six cases are synthetic. Their deterministic findings are produced by published rules and independently reviewable data rather than a live model.</p><h2>What this is not</h2><p>This is not a claim that every incorrect output is an intentional lie. It is not a deception score, a product ranking, a certification, a consciousness test or a universal account of AI safety. Version one records intent as <strong>not assessed</strong>.</p></div>`,
  });
}

async function listFiles(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    else out.push(path);
  }
  return out.sort();
}

async function write(outRoot, path, content) {
  const target = join(outRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export async function build(outRoot) {
  outRoot = resolve(outRoot);
  if (outRoot === ROOT || outRoot === dirname(ROOT) || outRoot === resolve("/")) throw new Error("refusing unsafe build output");
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  const pack = JSON.parse(await readFile(join(ROOT, "data", "deception-cases.v1.json"), "utf8"));
  const sourceMap = JSON.parse(await readFile(join(ROOT, "data", "source-map.v1.json"), "utf8"));
  const errors = validatePack(pack);
  if (errors.length) throw new Error(errors.join("\n"));

  await write(outRoot, "index.html", home(pack));
  await write(outRoot, "cases/index.html", casesIndex(pack));
  for (const [index, record] of pack.cases.entries()) await write(outRoot, `cases/${record.id}/index.html`, casePage(record, index));
  await write(outRoot, "method/index.html", methodPage());
  await write(outRoot, "tools/index.html", toolsPage(sourceMap));
  await write(outRoot, "challenge/index.html", challengePage());
  await write(outRoot, "about/index.html", aboutPage());

  await mkdir(join(outRoot, "assets"), { recursive: true });
  await cp(join(ROOT, "src", "site", "styles.css"), join(outRoot, "assets", "styles.css"));
  const browserApp = (await readFile(join(ROOT, "src", "site", "app.mjs"), "utf8"))
    .replace('from "../classifier.mjs"', 'from "./classifier.mjs"');
  await write(outRoot, "assets/app.mjs", browserApp);
  await cp(join(ROOT, "src", "site", "favicon.svg"), join(outRoot, "assets", "favicon.svg"));
  await cp(join(ROOT, "src", "classifier.mjs"), join(outRoot, "assets", "classifier.mjs"));
  await mkdir(join(outRoot, "data"), { recursive: true });
  await cp(join(ROOT, "data", "deception-cases.v1.json"), join(outRoot, "data", "deception-cases.v1.json"));
  await cp(join(ROOT, "data", "source-map.v1.json"), join(outRoot, "data", "source-map.v1.json"));
  await mkdir(join(outRoot, "schemas"), { recursive: true });
  await cp(join(ROOT, "schemas", "deception-case-v1.schema.json"), join(outRoot, "schemas", "deception-case-v1.schema.json"));

  const routes = ["", "cases/", ...pack.cases.map((record) => `cases/${record.id}/`), "method/", "tools/", "challenge/", "about/"];
  await write(outRoot, "robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml`);
  await write(outRoot, "sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${new URL(route, SITE_URL).href}</loc></url>`).join("")}</urlset>`);
  await write(outRoot, ".nojekyll", "");

  const files = (await listFiles(outRoot)).filter((path) => !path.endsWith("build-manifest.json"));
  const manifestFiles = [];
  for (const path of files) {
    const bytes = await readFile(path);
    manifestFiles.push({ path: relative(outRoot, path).split(sep).join("/"), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
  const manifest = { schema_version: "detecting_ai_deception_build_manifest_v1", file_count: manifestFiles.length, files: manifestFiles };
  await write(outRoot, "build-manifest.json", JSON.stringify(manifest, null, 2));
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : join(ROOT, "dist");
  if (!out) throw new Error("--out requires a path");
  const digest = await build(out);
  process.stdout.write(`${JSON.stringify({ schema_version: "detecting_ai_deception_build_v1", result: "pass", output: resolve(out), digest })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
