#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCase } from "../src/classifier.mjs";
import { validateCase, validatePack } from "../src/validate-case.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_PATH = join(ROOT, "data", "deception-cases.v1.json");
const FIXTURE_DIR = join(ROOT, "fixtures", "known-bad");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function json(value) {
  return JSON.stringify(stable(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function includesError(errors, expected) {
  return errors.some((error) => error.includes(expected));
}

function applyFixture(fixture, pack) {
  if (fixture.fixture_version === "known_bad_pack_v1") {
    const mutated = clone(pack);
    const source = mutated.cases.find((item) => item.id === fixture.duplicate_case);
    mutated.cases.push(clone(source));
    return validatePack(mutated);
  }
  if (fixture.fixture_version !== "known_bad_mutation_v1") {
    return ["fixture_version is invalid"];
  }
  const source = pack.cases.find((item) => item.id === fixture.base_case);
  if (!source) return [`fixture base case missing: ${fixture.base_case}`];
  const record = clone(source);
  Object.assign(record, fixture.set ?? {});
  if (fixture.set_observation_requirement) {
    const { index, value } = fixture.set_observation_requirement;
    record.observed_evidence[index].requirement_id = value;
  }
  if (Number.isInteger(fixture.remove_observation)) {
    record.observed_evidence.splice(fixture.remove_observation, 1);
  }
  return validateCase(record);
}

export async function runSelfTest() {
  const packText = await readFile(PACK_PATH, "utf8");
  const pack = JSON.parse(packText);
  const errors = validatePack(pack);
  if (errors.length) throw new Error(`case pack failed validation:\n${errors.join("\n")}`);
  if (pack.cases.length !== 6) throw new Error(`expected 6 cases, found ${pack.cases.length}`);

  const counts = { supported: 0, contradicted: 0, "insufficient-evidence": 0 };
  for (const record of pack.cases) counts[classifyCase(record)] += 1;

  const fixtureNames = (await readdir(FIXTURE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const fixtureResults = [];
  for (const name of fixtureNames) {
    const fixture = JSON.parse(await readFile(join(FIXTURE_DIR, name), "utf8"));
    const fixtureErrors = applyFixture(fixture, pack);
    if (!includesError(fixtureErrors, fixture.expected_error)) {
      throw new Error(`${name} did not fail as expected: ${fixtureErrors.join(" | ")}`);
    }
    fixtureResults.push({ name, result: "rejected" });
  }

  return {
    schema_version: "detecting_ai_deception_case_check_v1",
    result: "pass",
    case_count: pack.cases.length,
    classifications: counts,
    known_bad_fixture_count: fixtureResults.length,
    known_bad_fixtures: fixtureResults,
    pack_sha256: createHash("sha256").update(packText).digest("hex"),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  if (args.includes("--self-test")) {
    process.stdout.write(`${JSON.stringify(stable(await runSelfTest()), null, 2)}\n`);
    return;
  }
  const caseIndex = args.indexOf("--case");
  if (caseIndex >= 0) {
    const id = args[caseIndex + 1];
    const record = pack.cases.find((item) => item.id === id);
    if (!record) throw new Error(`unknown case: ${id ?? "missing"}`);
    process.stdout.write(`${json({ schema_version: "detecting_ai_deception_case_result_v1", id, finding: classifyCase(record), intent_assessment: record.intent_assessment })}\n`);
    return;
  }
  throw new Error("usage: node tools/check-cases.mjs --self-test | --case <id>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
