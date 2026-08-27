#!/usr/bin/env node
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files.sort();
}

export async function checkRepository() {
  const errors = [];
  const files = await listFiles(ROOT);
  const paths = new Set(files.map((path) => relative(ROOT, path).split(sep).join("/")));
  const required = [
    "README.md", "LICENSE", "LICENSE-CONTENT", "LICENSING.md", "NOTICE",
    "THIRD_PARTY_NOTICES.md", "CONTRIBUTING.md", "SECURITY.md", "package.json",
    "data/deception-cases.v1.json", "data/source-map.v1.json",
    "schemas/deception-case-v1.schema.json", "src/classifier.mjs",
    "src/site/styles.css", "tools/build.mjs", "tests/site.test.mjs",
    "tools/check-cases.mjs", "tools/check-site.mjs", "tools/check-all.mjs",
    "tools/check-http.mjs",
    ".github/workflows/checks.yml",
    ".github/ISSUE_TEMPLATE/reproduction.yml",
    ".github/ISSUE_TEMPLATE/counterexample.yml",
    ".github/ISSUE_TEMPLATE/new-case.yml",
    ".github/ISSUE_TEMPLATE/accessibility.yml",
  ];
  for (const path of required) if (!paths.has(path)) errors.push(`missing repository surface ${path}`);

  for (const path of files) {
    const item = relative(ROOT, path).split(sep).join("/");
    const info = await lstat(path);
    if (info.isSymbolicLink()) errors.push(`symlink is not allowed: ${item}`);
    if (info.size === 0 && item !== "dist/.nojekyll") errors.push(`unexpected empty file: ${item}`);
    if (!/\.(?:svg|png|jpg|jpeg|gif|woff2?)$/i.test(item)) {
      const text = await readFile(path, "utf8");
      if (text.includes("\r")) errors.push(`CRLF content: ${item}`);
      if (text.split("\n").some((line) => /[ \t]+$/.test(line))) errors.push(`trailing whitespace: ${item}`);
    }
  }

  const apache = await readFile(join(ROOT, "LICENSE"), "utf8");
  if (!apache.includes("Apache License") || !apache.includes("Version 2.0, January 2004") || !apache.includes("END OF TERMS AND CONDITIONS")) errors.push("Apache-2.0 legal text is incomplete");
  const cc = await readFile(join(ROOT, "LICENSE-CONTENT"), "utf8");
  if (!cc.includes("Creative Commons Attribution 4.0 International Public License") || !cc.includes("Section 8 -- Interpretation")) errors.push("CC BY 4.0 legal text is incomplete");

  const pack = JSON.parse(await readFile(join(ROOT, "data", "deception-cases.v1.json"), "utf8"));
  for (const record of pack.cases) {
    if (record.creator !== pack.creator || record.license !== pack.license) errors.push(`${record.id}: creator/license differs from pack`);
    if (!record.canonical_source.endsWith(`/cases/${record.id}/`)) errors.push(`${record.id}: canonical source does not match id`);
    if (record.intent_assessment !== "not-assessed") errors.push(`${record.id}: intent must remain not-assessed`);
  }
  const sourceMap = JSON.parse(await readFile(join(ROOT, "data", "source-map.v1.json"), "utf8"));
  if (sourceMap.sources.length !== 6) errors.push("source map must contain six curated routes");
  for (const source of sourceMap.sources) {
    if (!/^[0-9a-f]{40}$/.test(source.revision)) errors.push(`${source.id}: source revision must be exact`);
    if (!source.revision_url.endsWith(source.revision)) errors.push(`${source.id}: revision URL mismatch`);
    if (!source.non_claim) errors.push(`${source.id}: missing non-claim`);
  }

  for (const name of ["reproduction.yml", "counterexample.yml", "new-case.yml", "accessibility.yml"]) {
    const text = await readFile(join(ROOT, ".github", "ISSUE_TEMPLATE", name), "utf8");
    for (const term of ["credentials", "personal data", "private logs", "unpublished material", "sensitive vulnerability detail"]) {
      if (!text.includes(term)) errors.push(`${name}: missing public-safety rejection for ${term}`);
    }
  }
  const workflow = await readFile(join(ROOT, ".github", "workflows", "checks.yml"), "utf8");
  if (workflow.includes("pull_request_target") || /contents:\s*write/.test(workflow)) errors.push("workflow has unsafe trigger or permission");
  if (!workflow.includes("npm test") || !workflow.includes("npm run check") || !workflow.includes("git diff --exit-code")) errors.push("workflow misses required checks");

  const runtime = `${await readFile(join(ROOT, "src", "site", "app.mjs"), "utf8")}\n${await readFile(join(ROOT, "src", "classifier.mjs"), "utf8")}`;
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "sendBeacon", "WebSocket", "XMLHttpRequest", "navigator.sendBeacon"]) {
    if (runtime.includes(forbidden)) errors.push(`runtime contains forbidden primitive ${forbidden}`);
  }
  if (/fetch\s*\(\s*["']https?:/i.test(runtime)) errors.push("runtime performs an external request");

  const buildSource = await readFile(join(ROOT, "tools", "build.mjs"), "utf8");
  for (const marker of [
    'const SITE_UPDATED = "2026-08-27";',
    '"@type": "WebSite"',
    '"@type": "BreadcrumbList"',
    '"@type": "Dataset"',
    '"@type": "LearningResource"',
    'about: [',
    'name: "Intent: not assessed"',
    'name: "Synthetic practice case"',
    'await write(outRoot, "llms.txt", llmsText(pack));',
    'User-agent: ${agent}\\nAllow: /',
  ]) if (!buildSource.includes(marker)) errors.push(`build source lacks discoverability contract ${marker}`);
  for (const forbidden of ["llms-full.txt", "additionalProperty:", 'name="keywords"', '"@type": "FAQPage"', "changefreq", "<priority>"]) {
    if (buildSource.includes(forbidden)) errors.push(`build source includes prohibited search surface ${forbidden}`);
  }

  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  for (const marker of [
    "https://thedarknitefalls.github.io/detecting-ai-deception/",
    "AI answer verification",
    "claim checking",
    "citation verification",
    "AI hallucination",
    "Detecting AI Deception (DAID) asks the narrower question",
    "intent as `not-assessed`",
  ]) if (!readme.includes(marker)) errors.push(`README lacks bounded discovery language ${marker}`);
  if (/sixty-second|minutes? to complete/i.test(readme)) errors.push("README includes an unproven time-to-complete claim");

  return { schema_version: "detecting_ai_deception_repository_check_v1", result: errors.length ? "fail" : "pass", errors, file_count: files.length };
}

async function main() {
  const result = await checkRepository();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
