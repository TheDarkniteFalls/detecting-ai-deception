import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "../tools/build.mjs";
import { checkHttp } from "../tools/check-http.mjs";
import { checkSite } from "../tools/check-site.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the complete static site builds and passes its semantic contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    const digest = await build(root);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const result = await checkSite(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.html_count, 12);
    assert.equal(result.permanent_case_count, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the site check rejects concatenated evidence status and question text", async () => {
  const root = await mkdtemp(join(tmpdir(), "detecting-ai-deception-site-test-"));
  try {
    await build(root);
    const indexPath = join(root, "index.html");
    const html = await readFile(indexPath, "utf8");
    assert.match(html, /<\/span> <strong>/);
    await writeFile(indexPath, html.replace(/<\/span> <strong>/g, "</span><strong>"));
    const result = await checkSite(root);
    assert.ok(result.errors.includes(": evidence status is concatenated with its question"));
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
