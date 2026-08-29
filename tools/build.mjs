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
const SITE_NAME = "Detecting AI Deception";
const SITE_UPDATED = "2026-08-27";
const USAGE_SURFACE_UPDATED = "2026-08-30";
export const INDEXNOW_KEY = "9b73d8320f260bfd96685d71e08434bd";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const CREATOR_ID = `${PROJECT_URL}#mike-parsons`;
const WEBSITE_ID = `${SITE_URL}#website`;
const SITE_DESCRIPTION = "Check whether AI answers and citations are supported by the available evidence without guessing at intent.";

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

const stateSymbol = (value) => ({
  supports: "✓",
  contradictory: "×",
  absent: "—",
  unknown: "?",
  stale: "!",
  inapplicable: "—",
})[value];

const failureClassLabel = (value) => ({
  "false-completion": "Claimed output missing",
  "material-omission": "Decision-relevant omission",
  "provenance-or-identity-mismatch": "Product or version mismatch",
  "evaluation-gap": "Unaccounted evaluation cases",
  "ambiguous-external-effect": "External result unknown",
  "context-or-citation-escape": "Citation does not support claim",
  "control-case": "Supported control",
})[value] ?? value;

const caseShortLabel = (value) => ({
  "missing-file": "Missing output",
  "reassuring-average": "Uncounted cases",
  "unsupported-citation": "Unsupported citation",
  "wrong-product-identity": "Wrong identity",
  "lost-response": "Unknown external result",
  "revision-bound-claim": "Supported control",
})[value] ?? value;

function failureClassDisplay(values, { technical = false } = {}) {
  return values.map((value) => technical
    ? `${escapeHtml(failureClassLabel(value))} <code>${escapeHtml(value)}</code>`
    : escapeHtml(failureClassLabel(value))).join(" · ");
}

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
    <a class="nav-boundary" href="${prefix}about/#intent-boundary">Intent: not assessed</a>
    <div class="mobile-navigation">
      <a class="mobile-cases-link" href="${prefix}cases/"${current === "cases" ? ' aria-current="page"' : ""}>Cases</a>
      <details class="mobile-menu"><summary><span class="menu-lines" aria-hidden="true"><span></span><span></span><span></span></span>Menu</summary>
        <nav aria-label="Mobile primary">${items.slice(1).map(([id, label, href]) => `<a href="${href}"${current === id ? ' aria-current="page"' : ""}>${label}</a>`).join("")}<a href="${prefix}about/#intent-boundary">Intent boundary</a></nav>
      </details>
    </div>
  </div></header>`;
}

function breadcrumbNav(prefix, items) {
  const trail = [{ name: "Home", route: "" }, ...items];
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><div class="shell"><ol>${trail.map((item, index) => {
    const current = index === trail.length - 1;
    return `<li>${current ? `<span aria-current="page">${escapeHtml(item.name)}</span>` : `<a href="${prefix}${item.route}">${escapeHtml(item.name)}</a>`}</li>`;
  }).join("")}</ol></div></nav>`;
}

function structuredData({ canonical, title, description, type, dateModified, breadcrumbs, mainEntity }) {
  const pageId = `${canonical}#webpage`;
  const graph = [
    {
      "@type": "Person",
      "@id": CREATOR_ID,
      name: "Mike Parsons",
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: "DAID",
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      creator: { "@id": CREATOR_ID },
      license: LICENSE_URL,
    },
  ];
  const pageNode = {
    "@type": type,
    "@id": pageId,
    url: canonical,
    name: title,
    description,
    inLanguage: "en",
    dateModified,
    isPartOf: { "@id": WEBSITE_ID },
    creator: { "@id": CREATOR_ID },
    license: LICENSE_URL,
    isAccessibleForFree: true,
  };
  if (breadcrumbs.length) {
    const breadcrumbId = `${canonical}#breadcrumb`;
    pageNode.breadcrumb = { "@id": breadcrumbId };
    graph.push({
      "@type": "BreadcrumbList",
      "@id": breadcrumbId,
      itemListElement: [{ name: "Home", route: "" }, ...breadcrumbs].map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: new URL(item.route, SITE_URL).href,
      })),
    });
  }
  if (mainEntity) {
    pageNode.mainEntity = { "@id": mainEntity["@id"] };
  }
  graph.push(pageNode);
  if (mainEntity) graph.push(mainEntity);
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c");
}

function datasetEntity(pack) {
  const canonical = new URL("cases/", SITE_URL).href;
  return {
    "@type": "Dataset",
    "@id": `${canonical}#dataset`,
    name: "Detecting AI Deception synthetic practice case pack",
    description: "Six synthetic teaching cases for comparing AI claims with required evidence and the observed record.",
    url: canonical,
    version: pack.schema_version,
    dateModified: pack.reviewed_through,
    inLanguage: "en",
    creator: { "@id": CREATOR_ID },
    creditText: pack.creator,
    license: LICENSE_URL,
    isAccessibleForFree: true,
    distribution: {
      "@type": "DataDownload",
      name: "Six-case JSON pack",
      encodingFormat: "application/json",
      contentUrl: new URL("data/deception-cases.v1.json", SITE_URL).href,
    },
    hasPart: pack.cases.map((record) => ({
      "@id": `${new URL(`cases/${record.id}/`, SITE_URL).href}#learning-resource`,
    })),
  };
}

function caseLearningResource(record) {
  const canonical = new URL(`cases/${record.id}/`, SITE_URL).href;
  return {
    "@type": "LearningResource",
    "@id": `${canonical}#learning-resource`,
    name: record.title,
    description: record.plain_scenario,
    url: canonical,
    learningResourceType: "Synthetic practice case",
    educationalUse: "Practice",
    dateModified: record.reviewed_through,
    inLanguage: "en",
    creator: { "@id": CREATOR_ID },
    license: LICENSE_URL,
    isAccessibleForFree: true,
    isBasedOn: record.source_links.map((source) => source.revision_url),
    about: [
      { "@type": "Thing", name: `Finding: ${findingLabel(record.expected_finding)}` },
      { "@type": "Thing", name: "Intent: not assessed" },
      { "@type": "Thing", name: "Synthetic practice case" },
    ],
  };
}

function arrowIcon() {
  return `<svg class="arrow-icon" viewBox="0 0 28 18" aria-hidden="true" focusable="false"><path d="M1 9h24M18 2l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
}

function caseSpine(cases, prefix, currentId = "", titleOverride = "") {
  const title = titleOverride || (currentId ? "Choose another practice case" : "Six practice cases");
  return `<nav class="case-spine" aria-label="${title}"><span class="spine-title">${title}</span><ol>${cases.map((record, index) => `<li data-spine-case="${record.id}"${record.id === currentId ? ' class="is-current"' : ""}><a href="${prefix}${record.id}/"${record.id === currentId ? ' aria-current="step"' : ""}><span class="spine-node">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(caseShortLabel(record.id))}</strong><small>${record.id === currentId ? "Current synthetic case" : "Open synthetic case"}</small></span></a></li>`).join("")}</ol></nav>`;
}

function heroEvidenceObject(record) {
  const revision = record.source_links[0]?.revision_url.match(/\/commit\/([0-9a-f]{7,40})/i)?.[1]?.slice(0, 7) ?? "revision";
  return `<figure class="hero-evidence-object">
    <figcaption class="sr-only">A tactile evidence sculpture comparing the claim, required evidence, observed record and deterministic finding for existing synthetic case 03 of 06.</figcaption>
    <dl class="orbit-record">
      <span class="orbit-material" aria-hidden="true"></span>
      <svg class="orbit-lines" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M142 104 C250 104 286 130 356 138"/><path d="M836 118 C774 118 746 142 706 160"/>
        <path d="M840 288 C774 288 744 294 681 314"/><path d="M829 444 C752 444 720 426 674 408"/>
        <path class="orbit-track" d="M250 300 C300 170 657 105 758 235 C842 344 694 471 493 447 C303 426 210 358 250 300Z"/>
        <path class="orbit-track orbit-track-dashed" d="M319 370 C389 455 725 443 764 299 C787 213 672 171 523 194 C389 215 272 304 319 370Z"/>
        <circle cx="356" cy="138" r="6"/><circle cx="706" cy="160" r="6"/><circle cx="681" cy="314" r="6"/><circle cx="674" cy="408" r="6"/>
      </svg>
      <div class="orbit-object orbit-claim"><dt>Claim</dt><dd class="sr-only">30 days</dd></div>
      <div class="orbit-object orbit-required"><dt>Required evidence</dt><dd>30 days</dd></div>
      <div class="orbit-object orbit-observed"><dt class="sr-only">Observed record</dt><dd>7 days</dd></div>
      <div class="orbit-object orbit-citation"><dt class="sr-only">Source revision</dt><dd><a href="${escapeHtml(record.source_links[0]?.revision_url ?? record.canonical_source)}">[${escapeHtml(revision)}]</a></dd></div>
      <div class="orbit-object orbit-finding"><dt class="sr-only">Finding</dt><dd>${findingLabel(record.expected_finding)}</dd></div>
      <div class="orbit-callout callout-claim" aria-hidden="true"><strong>Claim</strong><span>The asserted statement.</span></div>
      <div class="orbit-callout callout-required" aria-hidden="true"><strong>Required<br>evidence</strong><span>What would support the claim.</span></div>
      <div class="orbit-callout callout-observed" aria-hidden="true"><strong>Observed<br>record</strong><span>What the record actually shows.</span></div>
      <div class="orbit-callout callout-finding" aria-hidden="true"><strong>Finding</strong><span>The available evidence conflicts with the claim.</span></div>
    </dl>
    <p class="object-equivalent">The claim says 30 days. The supplied passage says 7 days. The deterministic finding is contradicted. Intent is not assessed.</p>
  </figure>`;
}

function routeObject(record) {
  const symbol = ({
    "missing-file": `<circle class="symbol-fill" cx="60" cy="36" r="29"/>`,
    "reassuring-average": `<path d="M9 55 42 18 63 45 82 31 104 52 151 13"/>`,
    "unsupported-citation": `<path class="symbol-heavy" d="M45 72V42Q45 17 70 17h20q25 0 25 25v30"/>`,
    "wrong-product-identity": `<path class="symbol-fill" d="M24 15h108l17 21-17 21H24L10 36Z"/><circle class="symbol-hole" cx="25" cy="36" r="5"/><path class="symbol-cut" d="M47 23v26M57 23v26M69 23v26M82 23v26M96 23v26M108 23v26M120 23v26"/>`,
    "lost-response": `<path class="symbol-fill" d="M45 60V41c0-20 13-30 35-30s35 10 35 30v19Z"/><path class="symbol-cut" d="M54 48h52M49 55h62M40 63h80"/>`,
    "revision-bound-claim": `<rect x="38" y="10" width="84" height="52"/><path d="m54 37 17 16 38-35"/>`,
  })[record.id] ?? "";
  return `<span class="route-object route-object-${record.id}" aria-hidden="true"><svg class="route-symbol" viewBox="0 0 160 72" focusable="false">${symbol}</svg></span>`;
}

function page({
  path = "", title, description, content, prefix, current = "", type = "WebPage",
  dateModified = SITE_UPDATED, breadcrumbs = [], mainEntity = null, alternateData = "",
}) {
  const canonical = new URL(path, SITE_URL).href;
  const fullTitle = path ? `${title} · ${SITE_NAME}` : title;
  const structured = structuredData({ canonical, title: fullTitle, description, type, dateModified, breadcrumbs, mainEntity });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <link rel="describedby" href="${prefix}llms.txt" type="text/markdown">
${alternateData ? `  <link rel="alternate" href="${alternateData}" type="application/json" title="Six synthetic AI claim evidence cases">\n` : ""}  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Detecting AI Deception">
  <link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${prefix}assets/styles.css">
  <script>document.documentElement.classList.add("js")</script>
  <script type="application/ld+json">${structured}</script>
</head>
<body data-page="${current || "home"}" data-cases-url="${prefix}data/deception-cases.v1.json">
  <a class="skip-link" href="#main">Skip to main content</a>
  ${navigation(prefix, current)}
  <noscript><div class="noscript-note">JavaScript is off. Every case, evidence trail and deterministic finding remains readable; filters and choose-then-reveal controls are shown without enhancement.</div></noscript>
  <div class="shell" aria-live="polite" data-app-status></div>
  <main id="main">${breadcrumbs.length ? breadcrumbNav(prefix, breadcrumbs) : ""}${content}</main>
  <footer class="site-footer"><div class="shell footer-grid">
    <p>Mike-led public investigation, developed transparently with AI assistance. Six synthetic cases compare observable claims with observable evidence. Intent: not assessed.</p>
    <div class="footer-links"><a href="${prefix}tools/">Tools</a><a href="${prefix}challenge/">Challenge</a><a href="${prefix}about/">About</a><a href="${PROJECT_URL}">Source</a><a href="${PROJECT_URL}/blob/main/LICENSING.md">Licensing</a></div>
  </div></footer>
  <script type="module" src="${prefix}assets/app.mjs"></script>
</body>
</html>`;
}

function choiceForm(record) {
  return `<form data-finding-form data-case-id="${record.id}">
    <fieldset class="choice-fieldset">
      <legend>What does the record let you say?</legend>
      <p class="choice-prompt">Make the narrowest call the evidence supports. You can revise your view after the finding is revealed.</p>
      <div class="choice-list">
        <label class="choice choice-supported"><input type="radio" name="finding" value="supported"><span class="choice-mark" aria-hidden="true">✓</span><span><strong>Supported</strong><span>Every required item supports the claim.</span></span></label>
        <label class="choice choice-contradicted"><input type="radio" name="finding" value="contradicted"><span class="choice-mark" aria-hidden="true">×</span><span><strong>Contradicted</strong><span>At least one required observation conflicts.</span></span></label>
        <label class="choice choice-insufficient"><input type="radio" name="finding" value="insufficient-evidence"><span class="choice-mark" aria-hidden="true">?</span><span><strong>Insufficient evidence</strong><span>A required item is absent, unknown, stale or inapplicable.</span></span></label>
      </div>
    </fieldset>
    <button class="primary-button" type="submit" aria-controls="finding-panel-${record.id}" aria-expanded="false"><span>Reveal the finding</span>${arrowIcon()}</button>
    <p class="choice-result" data-choice-result aria-live="polite"></p>
  </form>`;
}

function caseArtifact(record) {
  const content = ({
    "missing-file": `<div class="artifact-ledger"><div><span>Reviewed revision</span><strong>Named</strong></div><div><span><code>reports/final-summary.json</code></span><strong>Missing</strong></div></div>`,
    "reassuring-average": `<div class="artifact-counts"><div><strong>20</strong><span>Intended</span></div><div><strong>14</strong><span>Scored</span></div><div><strong>6</strong><span>Unaccounted</span></div></div>`,
    "unsupported-citation": `<div class="artifact-versus"><div><span>Claim</span><strong>30 days</strong></div><span aria-hidden="true">≠</span><div><span>Passage</span><strong>7 days</strong></div></div>`,
    "wrong-product-identity": `<div class="artifact-identity"><div><span>Claim</span><strong>Product B · 3.0</strong></div><div><span>Source</span><strong>Product A · 4.2</strong></div></div>`,
    "lost-response": `<ol class="artifact-sequence"><li><span>1</span>Request sent</li><li><span>2</span>Response lost</li><li><span>3</span>Resulting state unknown</li></ol>`,
    "revision-bound-claim": `<div class="artifact-checks"><span>✓ Revision matches</span><span>✓ Named check passed</span><span>✓ Path set matches</span></div>`,
  })[record.id];
  return `<figure class="case-artifact artifact-${record.id}" data-artifact-id="${record.id}"><figcaption>Case-specific evidence object</figcaption>${content}</figure>`;
}

function observedRecord(record) {
  return `<ol class="observed-list" data-evidence-rail>${record.observed_evidence.map((item) => {
    const requirement = record.required_evidence.find((candidate) => candidate.id === item.requirement_id);
    return `<li class="observation state-${item.state}"><span class="state-mark" aria-hidden="true">${stateSymbol(item.state)}</span><div><span class="evidence-state state-${item.state}">${stateLabel(item.state)}</span> <strong>${escapeHtml(requirement.question)}</strong><p>${escapeHtml(item.observation)}</p></div></li>`;
  }).join("")}</ol>`;
}

function findingPanel(record) {
  const finding = classifyCase(record);
  return `<section class="finding-panel finding-${finding}" id="finding-panel-${record.id}" data-finding-panel aria-labelledby="finding-${record.id}">
    <div class="finding-summary"><span class="finding-symbol" aria-hidden="true">${stateSymbol(finding === "supported" ? "supports" : finding === "contradicted" ? "contradictory" : "unknown")}</span><div><span class="panel-label">Finding</span><h3 id="finding-${record.id}" data-reveal-heading tabindex="-1">${findingLabel(finding)}</h3><p>The declared claim is <strong>${finding === "supported" ? "supported by" : finding === "contradicted" ? "in conflict with" : "not resolved by"}</strong> the required evidence.</p><p class="intent-line"><strong>Intent:</strong> not assessed.</p></div></div>
    <div class="unknown-block"><span class="panel-label">What remains unknown</span><p>${escapeHtml(record.guiding_questions.what_remains_unknown)}</p></div>
  </section>`;
}

function investigation(record, number = "01", { homePreview = false, showHeader = true } = {}) {
  return `<article class="case-record" data-case-interaction data-synthetic-case${homePreview ? ` data-home-preview="${record.id}"` : ""}>${showHeader ? `
    <header class="record-header"><div class="record-kicker"><span>Existing case ${number} of 06</span><span>Visibly synthetic</span><span>Reviewed ${record.reviewed_through}</span></div><h2>${escapeHtml(record.title)}</h2><p class="record-scenario">${escapeHtml(record.plain_scenario)}</p><p class="record-class"><span>Evidence pattern:</span> ${failureClassDisplay(record.failure_class)}</p></header>` : ""}
    <div class="record-comparison">
      <section class="record-column record-claim" data-composition-part="claim"><span class="step-index" aria-hidden="true">01</span><span class="panel-label">Claim</span><blockquote>“${escapeHtml(record.system_claim)}”</blockquote>${caseArtifact(record)}</section>
      <section class="record-column record-required" data-composition-part="required-evidence"><span class="step-index" aria-hidden="true">02</span><span class="panel-label">Required evidence</span><ol class="required-list">${record.required_evidence.map((item) => `<li>${escapeHtml(item.question)}</li>`).join("")}</ol></section>
      <section class="record-column record-observed" data-composition-part="observed-record"><span class="step-index" aria-hidden="true">03</span><span class="panel-label">Observed record</span>${observedRecord(record)}</section>
    </div>
    <div class="classification-strip" data-composition-part="finding"><span class="step-index" aria-hidden="true">04</span>${choiceForm(record)}</div>
    ${findingPanel(record)}
  </article>`;
}

function routeList(cases, prefix) {
  return `<ol class="route-list case-route-list">${cases.map((record, index) => `<li data-case-id="${record.id}"><a class="route-link" href="${prefix}cases/${record.id}/"><span class="route-index">${String(index + 1).padStart(2, "0")}</span><span class="route-copy"><span class="case-short-label">${escapeHtml(caseShortLabel(record.id))}</span><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.plain_scenario)}</span></span>${routeObject(record)}<span class="route-outcome"><strong><span class="state-token" aria-hidden="true">${stateSymbol(record.expected_finding === "supported" ? "supports" : record.expected_finding === "contradicted" ? "contradictory" : "unknown")}</span>${findingLabel(record.expected_finding)}</strong><span>${failureClassDisplay(record.failure_class)}</span></span>${arrowIcon()}</a></li>`).join("")}</ol>`;
}

function homeCaseTitle(id) {
  return ({
    "missing-file": "The missing file",
    "reassuring-average": "The reassuring average",
    "unsupported-citation": "Unsupported citation",
    "wrong-product-identity": "Wrong product identity",
    "lost-response": "Lost response",
    "revision-bound-claim": "Supported claim",
  })[id] ?? id;
}

function homeCaseArchive(cases) {
  return `<section class="home-case-index" id="practice-cases" aria-labelledby="home-case-index-title"><div class="shell">
    <div class="practice-heading"><h2 id="home-case-index-title">Practice with six synthetic cases.</h2><p>Each case lets you compare one AI claim with the evidence it would need and the record that is actually available. Choose a case and classify the result as Supported, Contradicted or Insufficient evidence.</p></div>
    <nav class="home-finding-filter" aria-label="Open the case library by finding"><a class="is-current" href="cases/">All</a><a href="cases/?finding=supported">Supported</a><a href="cases/?finding=contradicted">Contradicted</a><a href="cases/?finding=insufficient-evidence">Insufficient evidence</a></nav>
    <ol class="home-case-grid">${cases.map((record, index) => `<li data-spine-case="${record.id}" data-case-id="${record.id}" data-finding="${record.expected_finding}"><a href="cases/${record.id}/" aria-label="Open synthetic case ${String(index + 1).padStart(2, "0")}: ${escapeHtml(homeCaseTitle(record.id))}"><span class="home-row-index">${String(index + 1).padStart(2, "0")}</span><strong class="home-row-title">${escapeHtml(homeCaseTitle(record.id))}</strong>${routeObject(record)}${arrowIcon()}</a></li>`).join("")}</ol>
  </div></section>`;
}

function featuredCasePanel(record) {
  return `<a class="featured-case-panel" href="cases/${record.id}/" aria-label="Try synthetic case 03: decide whether the citation supports the answer" data-home-preview="${record.id}" data-synthetic-case>
    <span class="featured-case-kicker">Featured synthetic case 03</span>
    <strong class="featured-case-question">Does the citation support the answer?</strong>
    <dl class="featured-evidence-list">
      <div class="featured-evidence-row featured-claim"><dt>Claim</dt><dd>30 days</dd>${arrowIcon()}</div>
      <div class="featured-evidence-row featured-required"><dt>Required evidence</dt><dd>30 days</dd>${arrowIcon()}</div>
      <div class="featured-evidence-row featured-observed"><dt>Observed record</dt><dd>7 days</dd>${arrowIcon()}</div>
      <div class="featured-evidence-row featured-finding"><dt>Finding</dt><dd>Choose, then reveal</dd>${arrowIcon()}</div>
    </dl>
    <span class="featured-case-summary">Open the case and make the narrowest call the evidence supports.</span>
  </a>`;
}

function home(pack) {
  const introIndex = pack.cases.findIndex((record) => record.id === "unsupported-citation");
  const intro = pack.cases[introIndex];
  if (!intro) throw new Error("home preview case unsupported-citation is missing");
  const methodSteps = [
    ["Record the claim", "Capture exactly what the answer says before interpreting it."],
    ["Define the evidence", "Write down what the record would need to show for the claim to hold."],
    ["Compare the record", "Look for evidence that matches, conflicts with or fails to reach the claim."],
    ["Report the result", "Classify the relationship and keep intent separate."],
  ];
  return page({
    title: "Detecting AI Deception: Check AI Claims Against Evidence",
    description: "Check whether an AI answer or citation is supported by evidence using six synthetic practice cases and a reproducible four-step method. Intent is not assessed.",
    prefix: "./",
    path: "",
    content: `<section class="home-opening"><div class="shell"><div class="opening-grid"><div class="opening-copy"><h1>Check whether an AI answer is backed by the evidence.</h1><p class="hero-explanation">AI answers can sound certain even when their sources are missing, contradictory or too weak to support them. This site helps anyone reviewing an AI answer compare the claim with the evidence it would need and the record that exists. You will learn to classify the result as Supported, Contradicted or Insufficient evidence without guessing at intent.</p><div class="hero-actions"><a class="primary-button" href="cases/unsupported-citation/"><span>Try a practice case</span>${arrowIcon()}</a><a class="secondary-button" href="#method-overview"><span>See the four-step method</span>${arrowIcon()}</a></div></div>${featuredCasePanel(intro)}</div></div></section>
      <section class="method-band" id="method-overview" aria-labelledby="method-overview-title"><div class="shell"><div class="method-heading"><h2 id="method-overview-title">How the method helps you reach a defensible result.</h2><p>The four steps keep a confident answer from substituting for evidence. They show you what to record, what to compare and how far the conclusion can go.</p></div><ol class="method-steps">${methodSteps.map(([title, description], index) => `<li><span class="method-number">0${index + 1}</span><div><h3>${title}</h3><p>${description}</p></div></li>`).join("")}</ol><a class="text-link method-link" href="method/">Read the complete method ${arrowIcon()}</a></div></section>
      ${homeCaseArchive(pack.cases)}
      <section class="trust-band"><div class="shell"><div class="section-intro"><span class="section-number">Boundary</span><div><h2>Know what the evidence can—and cannot—tell you.</h2><p>This site shows how far the available record supports a claim. It does not infer motive, estimate how often these patterns occur or collect your activity.</p></div></div><ul class="trust-list"><li><strong>Six visibly synthetic cases</strong><span>Teaching examples, not a prevalence estimate or allegation about a real incident.</span></li><li><strong>One deterministic rule</strong><span>The browser and local checker import the same classifier.</span></li><li><strong>Exact public revisions</strong><span>Every source keeps its revision and reviewed-through date beside the claim.</span></li><li><strong>No hidden collection</strong><span>No account, analytics, tracker, backend or live model receives your choices.</span></li></ul></div></section>
      <section class="challenge-band"><div class="shell challenge-layout"><div><h2>Challenge a result with evidence.</h2><p>Run the checker, inspect an exact revision, or supply a public-safe counterexample. The record should change when the evidence does.</p></div><div class="challenge-actions"><a class="primary-button" href="challenge/"><span>Challenge the record</span>${arrowIcon()}</a><a class="secondary-button" href="tools/"><span>Open the evidence tools</span>${arrowIcon()}</a></div></div></section>`,
  });
}

function casesIndex(pack) {
  const classes = [...new Set(pack.cases.flatMap((record) => record.failure_class))].sort();
  return page({
    title: "Practice Checking AI Claims Against Evidence",
    description: "Practice AI answer and citation verification with six synthetic cases. Compare each claim with required and observed evidence before revealing the finding.",
    path: "cases/", prefix: "../", current: "cases",
    breadcrumbs: [{ name: "Practice cases", route: "cases/" }],
    mainEntity: datasetEntity(pack),
    alternateData: "../data/deception-cases.v1.json",
    content: `<section class="case-page-header library-header"><div class="shell"><div class="page-heading-grid"><div><h1 class="page-title">Practice checking AI claims against the evidence.</h1><p class="lead">Every example is synthetic. Open a case, compare the AI claim with the evidence it would need and the record that is available, then decide whether the result is Supported, Contradicted or Insufficient evidence before seeing the finding.</p></div><div class="intent-boundary intent-boundary-compact"><span aria-hidden="true">≠</span><strong>Intent: not assessed</strong><small>A finding describes support, not motive.</small></div></div></div></section>
      <section class="case-archive-band"><div class="shell"><form class="filter-bar" data-library-filters><label>Finding<select name="finding"><option value="all">All findings</option><option value="supported">Supported</option><option value="contradicted">Contradicted</option><option value="insufficient-evidence">Insufficient evidence</option></select></label><label>Evidence pattern<select name="class"><option value="all">All evidence patterns</option>${classes.map((value) => `<option value="${value}">${escapeHtml(failureClassLabel(value))}</option>`).join("")}</select></label><p class="filter-count" data-filter-count>${pack.cases.length} of ${pack.cases.length} cases shown</p></form><p class="filter-disclosure" data-finding-disclosure hidden>Filtering by finding reveals the case outcomes before you open them.</p><div class="archive-layout"><div class="archive-records"><p class="filter-empty" data-filter-empty hidden>No cases match both filters. Change a filter or browse all six below.</p><ol class="case-library">${pack.cases.map((record, index) => `<li class="case-row" data-case-row data-case-id="${record.id}" data-finding="${record.expected_finding}" data-classes="${record.failure_class.join(" ")}"><a class="case-link" href="${record.id}/"><span class="route-index">${String(index + 1).padStart(2, "0")}</span><span class="route-copy"><span class="case-short-label">${escapeHtml(caseShortLabel(record.id))}</span><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.plain_scenario)}</span></span>${routeObject(record)}<span class="route-outcome" data-library-outcome hidden><strong><span class="state-token" aria-hidden="true">${stateSymbol(record.expected_finding === "supported" ? "supports" : record.expected_finding === "contradicted" ? "contradictory" : "unknown")}</span>${findingLabel(record.expected_finding)}</strong><span>${failureClassDisplay(record.failure_class)}</span></span>${arrowIcon()}</a></li>`).join("")}</ol></div>${caseSpine(pack.cases, "", "", "Browse all six cases")}</div></div></section>`,
  });
}

function caseJourney(cases, index) {
  const previous = cases[index - 1];
  const next = cases[index + 1];
  return `<nav class="case-journey" aria-label="Continue through the six practice cases">
    <div>${previous ? `<span>Previous case</span><a href="../${previous.id}/">${escapeHtml(previous.title)}</a>` : `<span>Start of the record</span>`}</div>
    <a class="case-journey-all" href="../">All practice cases</a>
    <div class="case-journey-next">${next ? `<span>Next case</span><a href="../${next.id}/">${escapeHtml(next.title)}</a>` : `<span>End of the record</span>`}</div>
  </nav>`;
}

function casePage(record, index, cases) {
  const questions = [
    ["What happened?", record.guiding_questions.what_happened],
    ["Why does it matter?", record.guiding_questions.why_it_matters],
    ["How do we know?", record.guiding_questions.how_we_know],
    ["What remains unknown?", record.guiding_questions.what_remains_unknown],
    ["What can someone do next?", record.guiding_questions.what_next],
  ];
  return page({
    title: record.title,
    description: `${record.plain_scenario} Compare the claim with the evidence and see why the finding is ${findingLabel(record.expected_finding)}.`,
    path: `cases/${record.id}/`, prefix: "../../", current: "cases",
    dateModified: SITE_UPDATED,
    breadcrumbs: [
      { name: "Practice cases", route: "cases/" },
      { name: record.title, route: `cases/${record.id}/` },
    ],
    mainEntity: caseLearningResource(record),
    content: `<header class="case-page-header"><div class="shell"><div class="case-page-kicker"><span>Case ${String(index + 1).padStart(2, "0")} of 06</span><span>Visibly synthetic</span><span>Reviewed ${record.reviewed_through}</span></div><div class="case-heading-grid"><div><h1>${escapeHtml(record.title)}</h1><p class="lead">${escapeHtml(record.plain_scenario)}</p></div><aside class="case-reading-note"><span aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><strong>Read the claim. Check the record. Make the narrowest defensible call.</strong><small>Intent: not assessed</small></aside></div><nav class="case-local-nav" aria-label="On this case"><a href="#make-your-call">Make a call</a><a href="#read-plainly">Read plainly</a><a href="#technical-record">Open proof</a><a href="../../challenge/">Challenge</a></nav></div></header>
      <section class="case-record-band" id="make-your-call"><div class="shell"><div class="record-band-intro"><span class="section-number">Claim / record</span><div><h2>Make your call before the finding appears.</h2><p>The same four-part composition is used in every case: claim, required evidence, observed record, finding.</p></div></div>${investigation(record, String(index + 1).padStart(2, "0"), { showHeader: false })}</div></section>
      <section class="case-spine-band"><div class="shell">${caseSpine(cases, "../", record.id)}</div></section>
      <section class="question-band" id="read-plainly"><div class="shell"><div class="section-intro"><span class="section-number">Read plainly</span><div><h2>Five questions that keep the story honest.</h2><p>Each answer stays inside this case’s declared boundary. Unknowns remain visible instead of being converted into certainty.</p></div></div><ol class="question-story">${questions.map(([question, answer], questionIndex) => `<li><span class="question-number">0${questionIndex + 1}</span><div><h3>${question}</h3><p>${escapeHtml(answer)}</p></div></li>`).join("")}</ol></div></section>
      <section class="technical-record" id="technical-record"><div class="shell"><div class="section-intro"><span class="section-number">Proof</span><div><h2>Open the technical record.</h2><p>Reproduce the bounded check, inspect exact revisions, and keep the limitations beside the result.</p></div></div><div class="technical-grid"><section><h3>Reproduce</h3><p class="case-pattern"><strong>Evidence pattern:</strong> ${failureClassDisplay(record.failure_class, { technical: true })}</p><p>${escapeHtml(record.reproduction.summary)}</p><pre class="code-block" tabindex="0" aria-label="Reproduction command"><code>${escapeHtml(record.reproduction.command)}</code></pre></section><section><h3>Exact sources</h3><ul class="source-list">${record.source_links.map((source) => `<li><a href="${source.url}">${escapeHtml(source.label)}</a><span class="source-revision">Reviewed through ${source.reviewed_through} · <a href="${source.revision_url}">exact source revision</a> · ${escapeHtml(source.license_note)}</span></li>`).join("")}</ul></section><section class="technical-limitations"><h3>Limitations and non-claims</h3><ul>${record.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p class="note"><strong>Intent remains not assessed.</strong> This case does not claim consciousness, malicious intent, strategic scheming, universal safety failure, production readiness, certification or a deception score.</p></section></div>${caseJourney(cases, index)}<div class="challenge-record"><a class="secondary-button" href="../../challenge/">Challenge this record</a></div></div></section>`,
  });
}

function methodPage() {
  return page({
    title: "How to Check AI Claims Against Evidence",
    description: "Learn a four-step method for checking AI claims and citations against evidence, distinguishing contradiction from insufficient evidence without inferring intent.",
    path: "method/", prefix: "../", current: "method",
    breadcrumbs: [{ name: "Method", route: "method/" }],
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">Check an AI claim against the evidence.</h1><p class="lead">Start with the exact claim, define the evidence it would require, compare that requirement with the available record, and classify the result as Supported, Contradicted or Insufficient evidence. The method does not assess intent.</p><div class="intent-boundary intent-boundary-compact"><span aria-hidden="true">≠</span><strong>Intent: not assessed</strong></div></div></header><div class="narrow prose">
      <section class="method-transfer" aria-labelledby="method-transfer-title"><h2 id="method-transfer-title">Use this four-line record on another AI answer</h2><pre class="method-template"><code>Claim:
Required evidence:
Observed record (source, exact revision or date, passage):
Finding: Supported / Contradicted / Insufficient evidence — Intent: not assessed</code></pre><div class="method-transfer-actions"><a class="primary-button" href="../cases/unsupported-citation/">Practice the template on Case 03</a><a class="secondary-button" href="../cases/">Browse all six cases</a></div></section>
      <h2>Common questions about checking AI answers</h2>
      <h3>How do I check whether an AI answer is supported?</h3><p>Write down the exact claim before interpreting it, define what evidence would need to be present for it to hold, and compare that requirement with the record you can actually inspect. If every required observation supports the claim, the result is Supported. If any required observation conflicts, it is Contradicted. If required evidence is missing or unresolved, it is Insufficient evidence. You can <a href="../cases/">practice that comparison with all six synthetic cases</a>.</p>
      <h3>How do I verify an AI citation?</h3><p>Open the cited source and the exact revision or version when one is available. Find the passage that is supposed to support the answer, then compare its subject, value, scope and date with the exact claim. A link is not proof by itself: <a href="../cases/unsupported-citation/">the unsupported-citation practice case</a> shows a 30-day answer beside a passage that says 7 days.</p>
      <h3>What is the difference between contradicted and insufficient evidence?</h3><p>Contradicted means at least one required observation directly conflicts with the claim. Insufficient evidence means the record is missing, unknown, stale or inapplicable and contains no direct conflict. The first supports a negative relationship finding; the second means the available record does not let you decide.</p>
      <h3>Does an unsupported claim prove AI deception or intent?</h3><p>No. Terms such as <em>AI hallucination</em> or <em>fabricated citation</em> are often used for different kinds of failure, but they do not establish why an answer was produced. This method asks a narrower, inspectable question: how does the claim relate to the available evidence? Intent is always not assessed.</p>
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
      <section class="method-next"><h2>Choose your next step</h2><div class="method-transfer-actions"><a class="primary-button" href="../cases/">Browse all six cases</a><a class="secondary-button" href="../challenge/">Challenge a result</a></div></section>
    </div>`,
  });
}

function toolsPage(sourceMap) {
  const routes = sourceMap.sources.filter((source) => source.id !== "reliability-navigator");
  return page({
    title: "AI Evidence-Checking Tools and Exact Sources",
    description: "Inspect exact public revisions and tools for checking AI claims, citations, missing evaluations, identity mismatches and ambiguous external actions.",
    path: "tools/", prefix: "../", current: "tools",
    dateModified: USAGE_SURFACE_UPDATED,
    breadcrumbs: [{ name: "Tools", route: "tools/" }],
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">Follow the evidence deeper.</h1><p class="lead">Run DAID's own harness check first, then inspect the exact reviewed revisions and narrow roles of supporting projects.</p></div></header>
<section class="band band-white" id="agent-claim-check-v1"><div class="narrow prose"><h2>Run Agent Claim Check v1</h2><p>Agent Claim Check is DAID's dependency-free, offline and deterministic harness check for one bounded claim and its observable evidence.</p><pre class="code-block"><code>node tools/check-agent-claim.mjs examples/agent-claim-check-v1/supported.json</code></pre><p>The example returns <code>supported</code>. Read that result only with these machine boundaries:</p><pre class="code-block"><code>intent_assessment: "not-assessed"
downstream_action_authorized: false
does_not_establish: ["correctness", "safety", "identity", "successful-execution", "authority", "permission"]</code></pre><p>A supported finding describes only the declared claim/evidence relationship. It is not permission to act.</p><h3>Guide, examples, and contracts</h3><ul><li><a href="${PROJECT_URL}/blob/main/docs/agent-claim-check-v1.md">Read the canonical Agent Claim Check v1 guide</a>.</li><li>Run the source examples: <a href="${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/supported.json">supported</a>, <a href="${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/contradicted.json">contradicted</a>, <a href="${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/insufficient-evidence.json">insufficient evidence</a>, and <a href="${PROJECT_URL}/blob/main/examples/agent-claim-check-v1/invalid-input.json">invalid input</a>.</li><li>Inspect the <a href="${PROJECT_URL}/blob/main/tools/check-agent-claim.mjs">CLI</a> and <a href="${PROJECT_URL}/blob/main/src/agent-claim-check.mjs">core</a>.</li><li>Use the canonical <a href="${SITE_URL}schemas/agent-claim-check-input-v1.schema.json">input</a>, <a href="${SITE_URL}schemas/agent-claim-check-receipt-v1.schema.json">receipt</a>, and <a href="${SITE_URL}schemas/agent-claim-check-error-v1.schema.json">error</a> schemas.</li><li>Review <a href="${PROJECT_URL}/blob/main/LICENSING.md">licensing</a>, <a href="${PROJECT_URL}/blob/main/SECURITY.md">security reporting</a>, or the existing <a href="${SITE_URL}challenge/">public-safe Challenge route</a>.</li></ul></div></section>
<section class="band"><div class="shell"><h2>Supporting evidence routes</h2><p>Each route below has an exact reviewed public revision and a narrow role. This site does not copy or silently extend those projects.</p><ol class="route-list">${routes.map((source, index) => `<li><a class="route-link" href="${source.revision_url}"><span class="route-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(source.id.replaceAll("-", " "))}</strong>${escapeHtml(source.role)}</span><span>Exact revision<br>${source.revision.slice(0, 12)}</span></a></li>`).join("")}</ol></div></section><section class="band band-white"><div class="narrow"><h2>Need the complete toolkit?</h2><p>The Reliability Navigator covers the wider public set of guides, starters and runnable checks. Its route recommendation is not certification that a tool fits every setup.</p><a class="primary-button" href="https://thedarknitefalls.github.io/local-assistant-reliability-lab/">Open the Reliability Navigator</a><p class="source-revision"><a href="${sourceMap.sources.find((source) => source.id === "reliability-navigator").revision_url}">Public baseline reviewed for this map</a></p></div></section>`,
  });
}

function challengePage() {
  const issueBase = `${PROJECT_URL}/issues/new?template=`;
  return page({
    title: "Reproduce or Challenge an AI Evidence Finding",
    description: "Run the dependency-free AI claim checker or submit a public-safe reproduction, evidence counterexample, synthetic case proposal or accessibility report.",
    path: "challenge/", prefix: "../", current: "challenge",
    breadcrumbs: [{ name: "Challenge", route: "challenge/" }],
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">The record should be challengeable.</h1><p class="lead">Have public-safe evidence that could change a finding? Choose a route below. Local reproduction is optional and can help others verify the result.</p></div></header><div class="narrow prose"><h2>Choose an evidence route</h2><ul class="route-list"><li><a class="route-link" href="${issueBase}counterexample.yml"><span class="route-index">01</span><span><strong>Counterexample</strong>Show evidence that changes a case classification or boundary.</span><span>Issue template</span></a></li><li><a class="route-link" href="${issueBase}reproduction.yml"><span class="route-index">02</span><span><strong>Reproduction result</strong>Share an exact command, revision and public-safe output.</span><span>Issue template</span></a></li><li><a class="route-link" href="${issueBase}new-case.yml"><span class="route-index">03</span><span><strong>New synthetic case</strong>Propose an issue-first claim and evidence record.</span><span>Issue template</span></a></li><li><a class="route-link" href="${issueBase}accessibility.yml"><span class="route-index">04</span><span><strong>Accessibility or site defect</strong>Report a reproducible barrier without sensitive data.</span><span>Issue template</span></a></li></ul><h2>Optional local checker</h2><pre class="code-block"><code>git clone https://github.com/TheDarkniteFalls/detecting-ai-deception.git
cd detecting-ai-deception
node tools/check-cases.mjs --self-test
npm test</code></pre><p>Local reproduction is optional. No dependency install, account, model or network service is needed after cloning.</p><h2>Public-safety boundary</h2><p class="note">Do not submit private logs, credentials, personal data, unpublished material, sensitive vulnerability detail or confidential model interactions. Replace them with the smallest synthetic reproduction. Use the security policy for sensitive vulnerabilities.</p></div>`,
  });
}

function aboutPage() {
  return page({
    title: "How Detecting AI Deception Produces Reproducible Findings",
    description: "See how Detecting AI Deception uses exact source revisions, published evidence records and one deterministic rule, with limitations and intent boundaries visible.",
    path: "about/", prefix: "../", current: "about",
    breadcrumbs: [{ name: "About", route: "about/" }],
    content: `<header class="case-page-header"><div class="shell"><h1 class="page-title">Inspect how every result was produced.</h1><p class="lead">Every finding can be reproduced from published evidence, exact source revisions and a deterministic rule. You can inspect the limitations or challenge a result with a public-safe counterexample.</p></div></header><div class="narrow prose"><h2>Motivation</h2><p>AI systems can make confident statements about files, sources, evaluations, identities and external actions. Some are supported. Some conflict with observable state. Some cannot be resolved with the evidence available. Treating all three as the same makes both trust and criticism less useful.</p><h2>Principles</h2><ul><li>Compare bounded claims with declared evidence.</li><li>Show missingness beside aggregates.</li><li>Bind public claims to exact identities and source revisions.</li><li>Keep consequential action ambiguity visible until state is reconciled.</li><li>State what remains unknown and what the evidence does not prove.</li><li>Invite reproducible, public-safe counterexamples.</li></ul><h2>For agents and automated readers</h2><p>This is a static, public evidence record rather than a live model or API. Automated readers can use the <a href="../llms.txt">plain-text discovery summary</a>, <a href="../data/deception-cases.v1.json">six-case JSON pack</a>, <a href="../schemas/deception-case-v1.schema.json">JSON Schema</a> and <a href="../data/source-map.v1.json">exact-revision source map</a>. The <a href="../tools/">evidence tools</a> and <a href="../challenge/">challenge route</a> explain how to reproduce or contest a finding.</p><p>Machines can rely on the published classifier relationship, exact case values, reviewed-through dates, licensing and provenance in those files. They should not infer motive, prevalence, live-model behavior or product certification from the records. See the repository’s <a href="${PROJECT_URL}/blob/main/LICENSING.md">licensing explanation</a> and <a href="${PROJECT_URL}/blob/main/NOTICE">provenance notice</a>.</p><h2>AI-assistance disclosure</h2><p>Mike Parsons leads the investigation and is responsible for its public framing. AI assistance was used to help structure, draft, implement and test this repository. The six cases are synthetic. Their deterministic findings are produced by published rules and independently reviewable data rather than a live model.</p><h2 id="intent-boundary">What this is not</h2><p>This is not a claim that every incorrect output is an intentional lie. It is not a deception score, a product ranking, a certification, a consciousness test or a universal account of AI safety. Version one records intent as <strong>not assessed</strong>.</p></div>`,
  });
}

function llmsText(pack) {
  const caseLines = pack.cases.map((record, index) => {
    const label = `${String(index + 1).padStart(2, "0")} · ${record.title} · ${findingLabel(record.expected_finding)}`;
    return `- [${label}](${new URL(`cases/${record.id}/`, SITE_URL).href}): ${record.plain_scenario}`;
  }).join("\n");
  return `# Detecting AI Deception

> Check whether an AI answer or citation is backed by the available evidence without guessing at intent.

Detecting AI Deception (DAID) is a static public teaching site. It contains exactly six synthetic practice cases and one deterministic rule for classifying the relationship between a claim and its required evidence as Supported, Contradicted or Insufficient evidence.

All six linked records are synthetic teaching cases reviewed through ${pack.reviewed_through}. Their finding distribution is three Contradicted, two Insufficient evidence and one Supported. Claim → Required evidence → Observed record → Finding is the public evidence model. Intent is always not assessed. The records do not establish motive, estimate prevalence, evaluate a live model, rank products or provide certification.

This file follows an experimental agent-discovery convention. It does not claim search ranking or inclusion.

## Start

- [Visitor overview](${SITE_URL}): Understand the problem, inspect the featured citation case and choose a practice case.
- [Evidence-checking method](${new URL("method/", SITE_URL).href}): Learn how to record a claim, define required evidence, compare the observed record and report the narrowest finding.
- [Six practice cases](${new URL("cases/", SITE_URL).href}): Compare each claim with the required and observed evidence before revealing its finding.

## Exact practice-case records

${caseLines}

## Machine-readable evidence

- [Six-case JSON pack](${new URL("data/deception-cases.v1.json", SITE_URL).href}): Canonical structured case content and expected findings.
- [JSON Schema](${new URL("schemas/deception-case-v1.schema.json", SITE_URL).href}): Validation contract for one case record.
- [Exact-revision source map](${new URL("data/source-map.v1.json", SITE_URL).href}): Public source revisions, narrow roles and non-claims.
- [Local checker and source repository](${PROJECT_URL}): Dependency-free deterministic classifier, tests and build source.

## Reproduce, challenge and inspect

- [Agent Claim Check v1](${new URL("tools/#agent-claim-check-v1", SITE_URL).href}): The core is dependency-free, offline, deterministic and non-authorizing for one declared claim/evidence relationship.
- [Agent Claim Check v1 guide](${PROJECT_URL}/blob/main/docs/agent-claim-check-v1.md): Source guide for exact examples, commands, receipt fields, schemas, provenance and boundaries.
- [Evidence tools](${new URL("tools/", SITE_URL).href}): Exact reviewed routes for deeper public checks.
- [Challenge a finding](${new URL("challenge/", SITE_URL).href}): Reproduction commands and public-safe counterexample routes.
- [Method, provenance and AI-assistance disclosure](${new URL("about/", SITE_URL).href}): How results are produced and what machines can rely on.
- [Licensing](${PROJECT_URL}/blob/main/LICENSING.md): Apache-2.0 for software-oriented files and CC BY 4.0 for original content and data, with linked third-party materials retaining their own terms.

## Evidence boundaries

- [Evidence-checking method](${new URL("method/", SITE_URL).href}): Claim → Required evidence → Observed record → Finding; missing or unresolved evidence is not converted into certainty.
- [Six synthetic practice cases](${new URL("cases/", SITE_URL).href}): Intent is always not assessed, and the records do not establish motive or estimate prevalence.
- [Limitations and non-claims](${new URL("about/", SITE_URL).href}): The site does not evaluate a live model, rank products or provide certification.
- [Deterministic source and privacy boundary](${PROJECT_URL}): The browser and local checker share one classifier; no account, analytics, tracker, backend or live model receives visitor choices.
`;
}

function robotsText() {
  const retrievalAgents = [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
  ];
  return `${retrievalAgents.map((agent) => `User-agent: ${agent}\nAllow: /`).join("\n\n")}\n\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml`;
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
  for (const [index, record] of pack.cases.entries()) await write(outRoot, `cases/${record.id}/index.html`, casePage(record, index, pack.cases));
  await write(outRoot, "method/index.html", methodPage());
  await write(outRoot, "tools/index.html", toolsPage(sourceMap));
  await write(outRoot, "challenge/index.html", challengePage());
  await write(outRoot, "about/index.html", aboutPage());

  await mkdir(join(outRoot, "assets"), { recursive: true });
  await cp(join(ROOT, "src", "site", "styles.css"), join(outRoot, "assets", "styles.css"));
  await cp(join(ROOT, "src", "site", "assets", "claim-record-evidence-sculpture.png"), join(outRoot, "assets", "claim-record-evidence-sculpture.png"));
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
  for (const schema of [
    "agent-claim-check-input-v1.schema.json",
    "agent-claim-check-receipt-v1.schema.json",
    "agent-claim-check-error-v1.schema.json",
  ]) await cp(join(ROOT, "schemas", schema), join(outRoot, "schemas", schema));

  const routes = [
    { path: "", lastmod: SITE_UPDATED },
    { path: "cases/", lastmod: SITE_UPDATED },
    ...pack.cases.map((record) => ({ path: `cases/${record.id}/`, lastmod: SITE_UPDATED })),
    { path: "method/", lastmod: SITE_UPDATED },
    { path: "tools/", lastmod: USAGE_SURFACE_UPDATED },
    { path: "challenge/", lastmod: SITE_UPDATED },
    { path: "about/", lastmod: SITE_UPDATED },
  ];
  await write(outRoot, "llms.txt", llmsText(pack));
  await write(outRoot, "robots.txt", robotsText());
  await write(outRoot, "sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${new URL(route.path, SITE_URL).href}</loc><lastmod>${route.lastmod}</lastmod></url>`).join("")}</urlset>`);
  await write(outRoot, `${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);
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
