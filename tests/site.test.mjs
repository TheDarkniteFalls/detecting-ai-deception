import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isSameDocumentFragmentHref } from "../src/site/app.mjs";
import { build } from "../tools/build.mjs";
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

test("the complete static site builds and passes its semantic contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    const digest = await build(root);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const result = await checkSite(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.html_count, 12);
    assert.equal(result.permanent_case_count, 6);
    assert.equal(result.file_count, 25);
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
  assert.equal(result.route_count, 15);
  assert.ok(result.routes.every(({ status, bytes }) => status === 200 && bytes > 0));
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
    assert.match(home, /<dt>Finding<\/dt><dd>Contradicted<\/dd>/);
    assert.match(home, /The cited passage does not support the answer\./);
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
