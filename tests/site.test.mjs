import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("the complete static site builds and passes its semantic contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    const digest = await build(root);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const result = await checkSite(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.html_count, 12);
    assert.equal(result.permanent_case_count, 6);
    assert.equal(result.file_count, 24);
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

test("the Claim / Record design contract stays bounded and code-native", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const home = await readFile(join(root, "index.html"), "utf8");
    const citation = await readFile(join(root, "cases", "unsupported-citation", "index.html"), "utf8");
    const styles = await readFile(join(root, "assets", "styles.css"), "utf8");

    assert.equal((home.match(/data-home-preview="unsupported-citation"/g) ?? []).length, 1);
    assert.equal((home.match(/data-synthetic-case/g) ?? []).length, 1);
    assert.equal((home.match(/data-spine-case=/g) ?? []).length, 6);
    assert.match(home, /Existing synthetic case · 03 of 06/);
    assert.match(home, /Confidence is a style\. Support is a relationship you can inspect\./);
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

test("contrast, 320px case rows and the extracted sculpture remain regression-bound", async () => {
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
    assert.match(styles, /@media \(max-width: 22rem\)[\s\S]*?grid-template-columns:\s*3\.25rem minmax\(0, 1fr\) 4rem 1\.5rem;/s);
    assert.deepEqual(builtSculpture, sourceSculpture);
    assert.equal(createHash("sha256").update(builtSculpture).digest("hex"), "8c9080e23d909c3d80835c7d5f1f8e52843ba32cc30883a91ec3e434a8b0a4a6");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
