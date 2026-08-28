import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  caseMatchesFilters,
  isSameDocumentFragmentHref,
  normalizeFilterValue,
  revealsLibraryOutcomes,
} from "../src/site/app.mjs";
import { build, INDEXNOW_KEY } from "../tools/build.mjs";
import { checkHttp } from "../tools/check-http.mjs";
import { checkSite } from "../tools/check-site.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("same-document fragment links preserve native anchor scrolling", () => {
  const current = "https://example.test/detecting-ai-deception/?view=compact";
  assert.equal(isSameDocumentFragmentHref("#method-overview", current), true);
  assert.equal(isSameDocumentFragmentHref("https://example.test/detecting-ai-deception/?view=compact#practice-cases", current), true);
  assert.equal(isSameDocumentFragmentHref("#", current), false);
  assert.equal(isSameDocumentFragmentHref("?view=full#method-overview", current), false);
  assert.equal(isSameDocumentFragmentHref("/detecting-ai-deception/method/#overview", current), false);
  assert.equal(isSameDocumentFragmentHref("https://other.test/detecting-ai-deception/?view=compact#method-overview", current), false);
});

test("practice filters normalize fail-closed and reveal outcomes only for explicit findings", () => {
  const findings = new Set(["all", "supported", "contradicted", "insufficient-evidence"]);
  const classes = new Set(["all", "false-completion", "context-or-citation-escape"]);
  assert.equal(normalizeFilterValue("contradicted", findings), "contradicted");
  assert.equal(normalizeFilterValue("invalid", findings), "all");
  assert.equal(normalizeFilterValue(null, findings), "all");
  assert.equal(normalizeFilterValue("false-completion", classes), "false-completion");
  assert.equal(revealsLibraryOutcomes("all"), false);
  assert.equal(revealsLibraryOutcomes("contradicted"), true);
  assert.equal(revealsLibraryOutcomes("invalid"), false);
  assert.equal(caseMatchesFilters("supported", ["control-case"], "supported", "control-case"), true);
  assert.equal(caseMatchesFilters("supported", ["control-case"], "supported", "false-completion"), false);
});

test("the complete static site builds and passes its semantic contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    const digest = await build(root);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const result = await checkSite(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.html_count, 12);
    assert.equal(result.permanent_case_count, 6);
    assert.equal(result.file_count, 26);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the HTTP publication check stays loopback-only and covers every public route", async () => {
  const source = await readFile(join(ROOT, "tools", "check-http.mjs"), "utf8");
  assert.match(source, /const LOOPBACK_HOST = "localhost";/);
  assert.doesNotMatch(source, /0\.0\.0\.0|127\.0\.0\.1/);
  const result = await checkHttp();
  assert.equal(result.result, "pass");
  assert.equal(result.route_count, 16);
  assert.ok(result.routes.every(({ status, bytes }) => status === 200 && bytes > 0));
  assert.ok(result.routes.some(({ route }) => route === `/${INDEXNOW_KEY}.txt`));
});

test("the project-scoped IndexNow ownership file is deterministic and inert", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
    const rootFiles = await readdir(root);
    assert.deepEqual(rootFiles.filter((name) => /^[0-9a-f]{32}\.txt$/.test(name)), [`${INDEXNOW_KEY}.txt`]);
    assert.equal(await readFile(join(root, `${INDEXNOW_KEY}.txt`), "utf8"), `${INDEXNOW_KEY}\n`);

    for (const path of ["index.html", "cases/index.html", "cases/unsupported-citation/index.html", "llms.txt", "robots.txt", "sitemap.xml", "assets/app.mjs"]) {
      assert.doesNotMatch(await readFile(join(root, path), "utf8"), new RegExp(INDEXNOW_KEY));
    }
    const sitemap = await readFile(join(root, "sitemap.xml"), "utf8");
    assert.equal((sitemap.match(/<url>/g) ?? []).length, 12);

    const buildSource = await readFile(join(ROOT, "tools", "build.mjs"), "utf8");
    assert.ok(buildSource.includes(`export const INDEXNOW_KEY = "${INDEXNOW_KEY}";`));
    assert.doesNotMatch(buildSource, /api\.indexnow\.org|fetch\s*\(/i);
    const app = await readFile(join(ROOT, "src", "site", "app.mjs"), "utf8");
    assert.doesNotMatch(app, /indexnow|api\.indexnow\.org/i);

    const readme = await readFile(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /project-scoped IndexNow ownership file/);
    assert.match(readme, /does not guarantee\s+crawling, indexing or ranking/);
    assert.doesNotMatch(readme, new RegExp(INDEXNOW_KEY));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Pages workflow is manual, least-privilege and validates committed output before deployment", async () => {
  const workflow = await readFile(join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /permissions:\n  contents: read\n  pages: write\n  id-token: write/);
  for (const command of ["npm test", "npm run check", "npm run check:http", "git diff --exit-code"]) {
    assert.ok(workflow.includes(command), `Pages workflow omits ${command}`);
  }
  const validation = workflow.indexOf("npm test");
  const upload = workflow.indexOf("actions/upload-pages-artifact@v3");
  const deployment = workflow.indexOf("actions/deploy-pages@v4");
  assert.ok(validation >= 0 && validation < upload && upload < deployment);
  assert.match(workflow, /path: \.\/dist/);
});

test("the site check rejects concatenated evidence status and question text", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const indexPath = join(root, "cases", "unsupported-citation", "index.html");
    const html = await readFile(indexPath, "utf8");
    assert.match(html, /<\/span> <strong>/);
    await writeFile(indexPath, html.replace(/<\/span> <strong>/g, "</span><strong>"));
    const result = await checkSite(root);
    assert.ok(result.errors.includes("cases/unsupported-citation/: evidence status is concatenated with its question"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the visitor-first design stays bounded, useful and code-native", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const home = await readFile(join(root, "index.html"), "utf8");
    const citation = await readFile(join(root, "cases", "unsupported-citation", "index.html"), "utf8");
    const styles = await readFile(join(root, "assets", "styles.css"), "utf8");

    assert.equal((home.match(/data-home-preview="unsupported-citation"/g) ?? []).length, 1);
    assert.equal((home.match(/data-synthetic-case/g) ?? []).length, 1);
    assert.equal((home.match(/data-spine-case=/g) ?? []).length, 6);
    assert.match(home, /Check whether an AI answer is backed by the evidence\./);
    assert.match(home, /This site helps anyone reviewing an AI answer compare the claim with the evidence it would need and the record that exists\./);
    assert.match(home, /Featured synthetic case 03/);
    assert.match(home, /<dt>Claim<\/dt><dd>30 days<\/dd>/);
    assert.match(home, /<dt>Required evidence<\/dt><dd>30 days<\/dd>/);
    assert.match(home, /<dt>Observed record<\/dt><dd>7 days<\/dd>/);
    assert.match(home, /<dt>Finding<\/dt><dd>Choose, then reveal<\/dd>/);
    const featured = home.slice(home.indexOf('class="featured-case-panel"'), home.indexOf("</a>", home.indexOf('class="featured-case-panel"')));
    assert.match(featured, /Open the case and make the narrowest call the evidence supports\./);
    assert.doesNotMatch(featured, /Contradicted|The cited passage does not support the answer\./);
    assert.match(home, /href="#method-overview"/);
    assert.match(home, /id="method-overview"/);
    assert.match(home, /id="practice-cases"/);
    assert.doesNotMatch(home, /hero-evidence-object|case-index-band/);
    const homeOrder = ["home-opening", "method-band", "home-case-index", "trust-band", "challenge-band"]
      .map((className) => home.indexOf(`class="${className}`));
    assert.ok(homeOrder.every((position, index) => position >= 0 && (index === 0 || position > homeOrder[index - 1])));
    assert.ok(citation.indexOf("case-record-band") < citation.indexOf("case-spine-band"));
    assert.match(citation, /Choose another practice case/);
    for (const part of ["claim", "required-evidence", "observed-record", "finding"]) {
      assert.match(citation, new RegExp(`data-composition-part="${part}"`));
    }
    assert.match(citation, /data-evidence-rail/);
    assert.match(citation, /data-artifact-id="unsupported-citation"/);
    assert.match(citation, /Intent: not assessed/);
    assert.doesNotMatch(styles, /(?:linear|radial|conic)-gradient\s*\(/i);
    assert.doesNotMatch(styles, /@import|url\(\s*["']?https?:/i);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("people and automated readers receive one truthful discovery contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const home = await readFile(join(root, "index.html"), "utf8");
    const method = await readFile(join(root, "method", "index.html"), "utf8");
    const about = await readFile(join(root, "about", "index.html"), "utf8");
    const cases = await readFile(join(root, "cases", "index.html"), "utf8");
    const citation = await readFile(join(root, "cases", "unsupported-citation", "index.html"), "utf8");
    const llms = await readFile(join(root, "llms.txt"), "utf8");
    const robots = await readFile(join(root, "robots.txt"), "utf8");
    const sitemap = await readFile(join(root, "sitemap.xml"), "utf8");

    assert.match(home, /<title>Detecting AI Deception: Check AI Claims Against Evidence<\/title>/);
    assert.match(method, /<title>How to Check AI Claims Against Evidence · Detecting AI Deception<\/title>/);
    assert.match(method, /How do I check whether an AI answer is supported\?/);
    assert.match(method, /How do I verify an AI citation\?/);
    assert.match(method, /What is the difference between contradicted and insufficient evidence\?/);
    assert.match(method, /Does an unsupported claim prove AI deception or intent\?/);
    assert.match(method, /AI hallucination/);
    assert.match(method, /fabricated citation/);
    assert.match(method, /href="\.\.\/cases\/unsupported-citation\/"/);
    assert.doesNotMatch(method, /"@type":"FAQPage"|<meta\s+name="keywords"/i);

    assert.doesNotMatch(home, /class="breadcrumbs"/);
    for (const html of [method, about, cases, citation]) {
      assert.match(html, /class="breadcrumbs" aria-label="Breadcrumb"/);
      assert.match(html, /"@type":"BreadcrumbList"/);
      assert.match(html, /"@type":"WebSite"/);
      assert.match(html, /"alternateName":"DAID"/);
      assert.match(html, /<link rel="describedby" href="[^"]*llms\.txt" type="text\/markdown">/);
    }

    const casesGraph = JSON.parse(cases.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])["@graph"];
    const dataset = casesGraph.find((item) => item["@type"] === "Dataset");
    assert.equal(dataset.version, "deception_case_pack_v1");
    assert.equal(dataset.dateModified, "2026-08-23");
    assert.equal(dataset.license, "https://creativecommons.org/licenses/by/4.0/");
    assert.deepEqual(dataset.distribution, {
      "@type": "DataDownload",
      name: "Six-case JSON pack",
      encodingFormat: "application/json",
      contentUrl: "https://thedarknitefalls.github.io/detecting-ai-deception/data/deception-cases.v1.json",
    });
    assert.equal(dataset.hasPart.length, 6);

    const caseGraph = JSON.parse(citation.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])["@graph"];
    const caseWebPage = caseGraph.find((item) => item["@type"] === "WebPage");
    const learningResource = caseGraph.find((item) => item["@type"] === "LearningResource");
    assert.equal(caseWebPage.dateModified, "2026-08-27");
    assert.equal(learningResource.learningResourceType, "Synthetic practice case");
    assert.equal(learningResource.educationalUse, "Practice");
    assert.equal(learningResource.dateModified, "2026-08-23");
    assert.deepEqual(learningResource.about, [
      { "@type": "Thing", name: "Finding: Contradicted" },
      { "@type": "Thing", name: "Intent: not assessed" },
      { "@type": "Thing", name: "Synthetic practice case" },
    ]);
    assert.equal("additionalProperty" in learningResource, false);
    assert.match(cases, /<link rel="alternate" href="\.\.\/data\/deception-cases\.v1\.json" type="application\/json"/);
    assert.doesNotMatch(citation, /<link rel="alternate"[^>]+type="application\/json"/);

    for (const marker of ["# Detecting AI Deception", "## Exact practice-case records", "## Machine-readable evidence", "## Evidence boundaries"]) {
      assert.ok(llms.includes(marker), `llms.txt omits ${marker}`);
    }
    for (const id of ["missing-file", "reassuring-average", "unsupported-citation", "wrong-product-identity", "lost-response", "revision-bound-claim"]) {
      assert.match(llms, new RegExp(`/cases/${id}/`));
    }
    assert.match(llms, /Intent is always not assessed\./);
    assert.doesNotMatch(llms, /prevalence estimate|time to complete/i);
    assert.match(llms, /It does not claim search ranking or inclusion\./);
    const llmsSections = llms.split(/^## /m).slice(1);
    assert.ok(llmsSections.length > 0);
    for (const section of llmsSections) {
      const lines = section.split("\n").slice(1).filter(Boolean);
      assert.ok(lines.length > 0);
      assert.ok(lines.every((line) => /^- \[[^\]]+\]\(https:\/\/[^)]+\): .+/.test(line)));
    }

    for (const agent of ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "*"]) {
      assert.ok(robots.includes(`User-agent: ${agent}\nAllow: /`));
    }
    assert.match(robots, /Sitemap: https:\/\/thedarknitefalls\.github\.io\/detecting-ai-deception\/sitemap\.xml/);

    const sitemapEntries = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)];
    assert.equal(sitemapEntries.length, 12);
    for (const [, , date] of sitemapEntries) assert.equal(date, "2026-08-27");
    assert.doesNotMatch(sitemap, /<(?:priority|changefreq)>/);

    for (const route of ["llms.txt", "data/deception-cases.v1.json", "schemas/deception-case-v1.schema.json", "data/source-map.v1.json", "tools/", "challenge/"]) {
      assert.ok(about.includes(route), `automated-reader section omits ${route}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persona-flow repairs preserve blind practice, progressive disclosure and exact evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const relativePages = [
      "index.html", "cases/index.html", "method/index.html", "tools/index.html", "challenge/index.html", "about/index.html",
      "cases/missing-file/index.html", "cases/reassuring-average/index.html", "cases/unsupported-citation/index.html",
      "cases/wrong-product-identity/index.html", "cases/lost-response/index.html", "cases/revision-bound-claim/index.html",
    ];
    for (const path of relativePages) {
      const html = await readFile(join(root, path), "utf8");
      const header = html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
      const order = ["Cases", "Method", "Tools", "Challenge", "About"].map((label) => header.indexOf(`>${label}</a>`));
      assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])), `${path} nav order`);
      assert.match(header, /class="mobile-cases-link"/);
      assert.match(header, /aria-label="Mobile primary"/);
      assert.match(header, />Intent boundary<\/a>/);
      assert.match(header, /about\/#intent-boundary/);
    }

    const home = await readFile(join(root, "index.html"), "utf8");
    const featuredStart = home.indexOf('class="featured-case-panel"');
    const featured = home.slice(featuredStart, home.indexOf("</a>", featuredStart));
    for (const pair of [["Claim", "30 days"], ["Required evidence", "30 days"], ["Observed record", "7 days"], ["Finding", "Choose, then reveal"]]) {
      assert.ok(featured.includes(`<dt>${pair[0]}</dt><dd>${pair[1]}</dd>`));
    }
    assert.doesNotMatch(featured, /Contradicted|The cited passage does not support the answer\./);

    const cases = await readFile(join(root, "cases", "index.html"), "utf8");
    assert.ok(cases.indexOf('class="archive-records"') < cases.indexOf("Browse all six cases"));
    assert.equal((cases.match(/data-library-outcome hidden/g) ?? []).length, 6);
    assert.match(cases, /Filtering by finding reveals the case outcomes before you open them\./);
    assert.match(cases, /No cases match both filters\. Change a filter or browse all six below\./);

    const method = await readFile(join(root, "method", "index.html"), "utf8");
    assert.match(method, /Use this four-line record on another AI answer/);
    assert.ok(method.includes("Claim:\nRequired evidence:\nObserved record (source, exact revision or date, passage):\nFinding: Supported / Contradicted / Insufficient evidence — Intent: not assessed"));
    for (const marker of ["Practice the template on Case 03", "Browse all six cases", "Choose your next step", 'href="../challenge/"']) assert.ok(method.includes(marker));

    const pack = JSON.parse(await readFile(join(ROOT, "data", "deception-cases.v1.json"), "utf8"));
    for (const record of pack.cases) {
      const html = await readFile(join(root, "cases", record.id, "index.html"), "utf8");
      for (const marker of [
        'aria-label="On this case"', 'href="#make-your-call"', 'href="#read-plainly"', 'href="#technical-record"',
        'id="make-your-call"', 'id="read-plainly"', 'id="technical-record"', 'href="../../challenge/"',
      ]) assert.ok(html.includes(marker), `${record.id} omits ${marker}`);
      assert.ok(html.includes(`<code>${record.reproduction.command}</code>`), `${record.id} command bytes changed`);
    }

    const challenge = await readFile(join(root, "challenge", "index.html"), "utf8");
    assert.match(challenge, /Have public-safe evidence that could change a finding\? Choose a route below\. Local reproduction is optional and can help others verify the result\./);
    const challengeOrder = ["Counterexample", "Reproduction result", "New synthetic case", "Accessibility or site defect", "Optional local checker", "Public-safety boundary"]
      .map((label) => challenge.indexOf(label));
    assert.ok(challengeOrder.every((position, index) => position >= 0 && (index === 0 || position > challengeOrder[index - 1])));

    const about = await readFile(join(root, "about", "index.html"), "utf8");
    assert.match(about, /<h2 id="intent-boundary">What this is not<\/h2>/);
    const styles = await readFile(join(root, "assets", "styles.css"), "utf8");
    assert.match(styles, /@media \(max-width: 40rem\)[\s\S]*?\.code-block\s*\{[^}]*overflow-x:\s*visible;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-wrap;/s);
    const mobileNavigationStyles = styles.match(/@media \(max-width: 64rem\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    assert.match(mobileNavigationStyles, /\.mobile-cases-link\s*\{[^}]*display:\s*inline-flex;[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/s);
    const mobileStyles = styles.match(/@media \(max-width: 40rem\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    assert.match(mobileStyles, /\.wordmark\s*\{[^}]*font-size:\s*0\.75rem;[^}]*letter-spacing:\s*0\.1em;/s);
    assert.match(mobileStyles, /\.opening-grid\s*\{[^}]*gap:\s*1\.25rem;[^}]*padding:\s*1\.5rem 0 1\.75rem;/s);
    assert.match(mobileStyles, /\.opening-copy h1\s*\{[^}]*font-size:\s*clamp\(2\.5rem, 10\.75vw, 2\.625rem\);[^}]*line-height:\s*0\.92;/s);
    assert.match(mobileStyles, /\.hero-explanation\s*\{[^}]*margin-bottom:\s*1\.1rem;[^}]*font-size:\s*1rem;[^}]*line-height:\s*1\.45;/s);
    assert.match(mobileStyles, /\.hero-actions\s*\{[^}]*gap:\s*0\.5rem;[^}]*grid-template-columns:\s*1fr;/s);
    assert.match(mobileStyles, /\.hero-actions \.primary-button,[\s\S]*?\.hero-actions \.secondary-button\s*\{[^}]*min-height:\s*3rem;[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
    assert.match(mobileStyles, /\.featured-case-panel\s*\{[^}]*margin-top:\s*0;/s);

    for (const path of ["data/deception-cases.v1.json", "data/source-map.v1.json", "schemas/deception-case-v1.schema.json"]) {
      assert.deepEqual(await readFile(join(root, path)), await readFile(join(ROOT, path)), `${path} changed during generation`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated persona-flow builds are byte-for-byte deterministic", async () => {
  const first = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  const second = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    const firstDigest = await build(first);
    const secondDigest = await build(second);
    assert.equal(firstDigest, secondDigest);
    assert.deepEqual(await readFile(join(first, "build-manifest.json")), await readFile(join(second, "build-manifest.json")));
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("contrast, responsive case selectors and the preserved sculpture asset remain regression-bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const styles = await readFile(join(root, "assets", "styles.css"), "utf8");
    const sourceSculpture = await readFile(join(ROOT, "src", "site", "assets", "claim-record-evidence-sculpture.png"));
    const builtSculpture = await readFile(join(root, "assets", "claim-record-evidence-sculpture.png"));

    assert.ok(contrastRatio("#f3f0e8", "#704ce9") >= 4.5);
    assert.ok(contrastRatio("#020303", "#7958ff") >= 4.5);
    assert.doesNotMatch(styles, /data:image\/png;base64/);
    assert.match(styles, /--evidence-sculpture: url\("\.\/claim-record-evidence-sculpture\.png"\)/);
    assert.match(styles, /\.home-row-title\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s);
    assert.match(styles, /\.finding-summary h3\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s);
    assert.match(styles, /body\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s);
    assert.match(styles, /@media \(max-width: 22\.5rem\)[\s\S]*?\.home-case-grid\s*\{\s*grid-template-columns:\s*1fr;/s);
    assert.match(styles, /@media \(max-width: 52rem\)[\s\S]*?\.home-case-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    assert.doesNotMatch(styles, /\.case-short-label\s*\{[^}]*color:\s*var\(--cobalt\)/s);
    assert.deepEqual(builtSculpture, sourceSculpture);
    assert.equal(createHash("sha256").update(builtSculpture).digest("hex"), "8c9080e23d909c3d80835c7d5f1f8e52843ba32cc30883a91ec3e434a8b0a4a6");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
