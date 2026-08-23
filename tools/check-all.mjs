#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";
import { runSelfTest } from "./check-cases.mjs";
import { checkSite } from "./check-site.mjs";
import { checkRepository } from "./check-repository.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main() {
  const first = await mkdtemp(join(tmpdir(), "detecting-ai-deception-build-a-"));
  const second = await mkdtemp(join(tmpdir(), "detecting-ai-deception-build-b-"));
  try {
    const caseCheck = await runSelfTest();
    const repositoryCheck = await checkRepository();
    if (repositoryCheck.errors.length) throw new Error(repositoryCheck.errors.join("\n"));
    const distDigest = await build(join(ROOT, "dist"));
    const firstDigest = await build(first);
    const secondDigest = await build(second);
    if (distDigest !== firstDigest || firstDigest !== secondDigest) throw new Error("deterministic build digest mismatch");
    const distManifest = await readFile(join(ROOT, "dist", "build-manifest.json"), "utf8");
    const firstManifest = await readFile(join(first, "build-manifest.json"), "utf8");
    const secondManifest = await readFile(join(second, "build-manifest.json"), "utf8");
    if (distManifest !== firstManifest || firstManifest !== secondManifest) throw new Error("deterministic build manifest mismatch");
    const siteCheck = await checkSite(join(ROOT, "dist"));
    if (siteCheck.errors.length) throw new Error(siteCheck.errors.join("\n"));
    process.stdout.write(`${JSON.stringify({
      schema_version: "detecting_ai_deception_complete_check_v1",
      result: "pass",
      deterministic_build_digest: distDigest,
      case_count: caseCheck.case_count,
      known_bad_fixture_count: caseCheck.known_bad_fixture_count,
      html_count: siteCheck.html_count,
      output_file_count: siteCheck.file_count,
      repository_file_count: repositoryCheck.file_count,
    }, null, 2)}\n`);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
