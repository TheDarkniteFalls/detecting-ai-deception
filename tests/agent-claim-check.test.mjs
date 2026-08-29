import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ERROR_SCHEMA_VERSION,
  INPUT_SCHEMA_VERSION,
  RECEIPT_SCHEMA_VERSION,
  canonicalJson,
  evaluateAgentClaimBytes,
  validateAgentClaimInput,
} from "../src/agent-claim-check.mjs";
import {
  mapSyntheticHarnessEvent,
  runSyntheticAdapter,
} from "../tools/agent-claim-check-synthetic-adapter.mjs";

const repoRoot = new URL("../", import.meta.url);
const fixturePack = JSON.parse(await readFile(new URL("../fixtures/agent-claim-check-v1/cases.json", import.meta.url), "utf8"));

function evaluate(value) {
  return evaluateAgentClaimBytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function validInput() {
  return structuredClone(fixturePack.cases[0].input);
}

test("the fixture pack contains exactly the six frozen semantic fixtures", () => {
  assert.equal(fixturePack.cases.length, 6);
  assert.deepEqual(
    fixturePack.cases.map(({ id, expected_finding: finding }) => ({ id, finding })),
    [
      { id: "supported-artifact-control", finding: "supported" },
      { id: "false-file-completion-claim", finding: "contradicted" },
      { id: "wrong-product-identity", finding: "contradicted" },
      { id: "unsupported-citation", finding: "insufficient_evidence" },
      { id: "evaluation-not-captured", finding: "insufficient_evidence" },
      { id: "ambiguous-external-effect", finding: "insufficient_evidence" },
    ],
  );
});

test("all six semantic fixtures produce their frozen findings and preserve evidence", () => {
  for (const fixture of fixturePack.cases) {
    const result = evaluate(fixture.input);
    assert.equal(result.accepted, true, fixture.id);
    assert.equal(result.value.schema_version, RECEIPT_SCHEMA_VERSION, fixture.id);
    assert.equal(result.value.finding, fixture.expected_finding, fixture.id);
    assert.deepEqual(result.value.evidence_results, fixture.input.evidence, fixture.id);
    assert.deepEqual(result.value.capture, fixture.input.capture, fixture.id);
    assert.equal(result.value.intent_assessment, "not-assessed", fixture.id);
    assert.equal(result.value.downstream_action_authorized, false, fixture.id);
  }
});

test("contradiction has precedence over absent evidence and incomplete capture", () => {
  const input = validInput();
  input.evidence[0].state = "absent";
  input.evidence[1].state = "contradictory";
  input.capture.completeness = "partial";
  input.capture.adapter_warnings = ["synthetic warning"];
  assert.equal(evaluate(input).value.finding, "contradicted");
});

test("supported requires complete capture, no warnings, and support from every item", () => {
  for (const change of [
    (input) => { input.evidence[0].state = "unknown"; },
    (input) => { input.capture.completeness = "partial"; },
    (input) => { input.capture.adapter_warnings = ["synthetic warning"]; },
  ]) {
    const input = validInput();
    change(input);
    assert.equal(evaluate(input).value.finding, "insufficient_evidence");
  }
});

test("successful receipts expose exact non-claims and not-run boundaries", () => {
  const receipt = evaluate(validInput()).value;
  assert.deepEqual(receipt.does_not_establish, [
    "correctness",
    "safety",
    "identity",
    "successful-execution",
    "authority",
    "permission",
  ]);
  assert.deepEqual(receipt.checks, [
    { id: "input-contract", state: "passed" },
    { id: "evidence-classification", state: "passed" },
    { id: "external-execution", state: "not-run" },
    { id: "identity-authentication", state: "not-run" },
    { id: "permission-validation", state: "not-run" },
    { id: "intent-assessment", state: "not-run" },
  ]);
});

test("empty optional observation strings are valid and preserved", () => {
  const input = validInput();
  for (const field of ["observed_value", "source_ref", "source_revision", "observed_channel"]) {
    input.evidence[0][field] = "";
  }
  const result = evaluate(input);
  assert.equal(result.accepted, true);
  assert.equal(result.value.finding, "supported");
  for (const field of ["observed_value", "source_ref", "source_revision", "observed_channel"]) {
    assert.equal(result.value.evidence_results[0][field], "");
  }
});

test("canonical JSON is recursively sorted, compact, UTF-8, and has one terminal LF", () => {
  const output = canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] });
  assert.equal(output, '{"a":{"b":3,"y":2},"list":[{"c":5,"d":4}],"z":1}\n');
  assert.equal(output.endsWith("\n"), true);
  assert.equal(output.endsWith("\n\n"), false);
  assert.equal(Buffer.from(output, "utf8").toString("utf8"), output);
});

test("identical input bytes produce byte-identical receipts", () => {
  const bytes = Buffer.from(canonicalJson(validInput()), "utf8");
  const first = evaluateAgentClaimBytes(bytes);
  const second = evaluateAgentClaimBytes(bytes);
  assert.equal(first.output, second.output);
  assert.deepEqual(first.value, second.value);
});

test("key order and whitespace change only the raw hash", () => {
  const input = validInput();
  const ordered = Buffer.from(canonicalJson(input), "utf8");
  const reordered = Buffer.from(JSON.stringify({
    capture: input.capture,
    evidence: input.evidence,
    claim: input.claim,
    schema_version: input.schema_version,
  }, null, 2), "utf8");
  const first = evaluateAgentClaimBytes(ordered).value;
  const second = evaluateAgentClaimBytes(reordered).value;
  assert.notEqual(first.raw_input_sha256, second.raw_input_sha256);
  assert.equal(first.canonical_input_sha256, second.canonical_input_sha256);
  assert.equal(first.finding, second.finding);
});

test("all frozen invalid-input classes fail closed with no finding", () => {
  const cases = [
    { code: "malformed_json", bytes: Buffer.from("{", "utf8") },
    { code: "duplicate_key", bytes: Buffer.from('{"schema_version":"x","schema_version":"y"}', "utf8") },
    { code: "trailing_content", bytes: Buffer.from(`${JSON.stringify(validInput())} false`, "utf8") },
    { code: "missing_field", mutate: (input) => { delete input.claim; } },
    { code: "unknown_field", mutate: (input) => { input.extra = true; } },
    { code: "wrong_type", mutate: (input) => { input.capture.adapter_warnings = "none"; } },
    { code: "empty_value", mutate: (input) => { input.claim.text = " "; } },
    { code: "duplicate_evidence_id", mutate: (input) => { input.evidence[1].id = input.evidence[0].id; } },
    { code: "unknown_enum", mutate: (input) => { input.evidence[0].state = "maybe"; } },
    { code: "invalid_sha256", mutate: (input) => { input.evidence[0].source_sha256 = "ABC"; } },
    { code: "non_nfc_string", mutate: (input) => { input.claim.text = "Cafe\u0301"; } },
  ];
  for (const item of cases) {
    let bytes = item.bytes;
    if (!bytes) {
      const input = validInput();
      item.mutate(input);
      bytes = Buffer.from(JSON.stringify(input), "utf8");
    }
    const result = evaluateAgentClaimBytes(bytes);
    assert.equal(result.accepted, false, item.code);
    assert.equal(result.value.schema_version, ERROR_SCHEMA_VERSION, item.code);
    assert.equal(result.value.errors.some(({ code }) => code === item.code), true, item.code);
    assert.equal(Object.hasOwn(result.value, "finding"), false, item.code);
    assert.equal(result.value.intent_assessment, "not-assessed", item.code);
    assert.equal(result.value.downstream_action_authorized, false, item.code);
  }
});

test("prototype-named members cannot bypass strict unknown-field rejection", () => {
  for (const { target, path } of [
    { target: (input) => input, path: "/__proto__" },
    { target: (input) => input.claim, path: "/claim/__proto__" },
  ]) {
    const input = validInput();
    Object.defineProperty(target(input), "__proto__", {
      value: { synthetic: true },
      enumerable: true,
    });
    const bytes = Buffer.from(JSON.stringify(input), "utf8");
    assert.equal(bytes.includes(Buffer.from('"__proto__"')), true);
    const result = evaluateAgentClaimBytes(bytes);
    assert.equal(result.accepted, false, path);
    assert.equal(result.value.errors.some((item) => item.code === "unknown_field" && item.path === path), true, path);
    assert.equal(Object.hasOwn(result.value, "finding"), false, path);
    assert.equal(Object.hasOwn(result.value, "canonical_input_sha256"), false, path);
  }
});

test("direct validation rejects objects with non-JSON prototypes", () => {
  for (const target of [(input) => input, (input) => input.claim]) {
    const input = validInput();
    Object.setPrototypeOf(target(input), { synthetic: true });
    assert.equal(validateAgentClaimInput(input).some((item) => item.code === "wrong_type"), true);
  }
});

test("non-NFC object keys are rejected as strings before classification", () => {
  const input = validInput();
  Object.defineProperty(input, "cafe\u0301", { value: true, enumerable: true });
  const result = evaluateAgentClaimBytes(Buffer.from(JSON.stringify(input), "utf8"));
  assert.equal(result.accepted, false);
  assert.equal(result.value.errors[0].code, "non_nfc_string");
  assert.equal(Object.hasOwn(result.value, "finding"), false);
});

test("invalid UTF-8 is rejected as malformed JSON", () => {
  const result = evaluateAgentClaimBytes(Buffer.from([0xff]));
  assert.equal(result.accepted, false);
  assert.equal(result.value.errors[0].code, "malformed_json");
  assert.equal(Object.hasOwn(result.value, "finding"), false);
});

test("deep JSON nesting returns the fail-closed envelope and CLI exit 2", () => {
  const bytes = Buffer.from(`${"[".repeat(5_000)}0${"]".repeat(5_000)}`, "utf8");
  const result = evaluateAgentClaimBytes(bytes);
  assert.equal(result.accepted, false);
  assert.equal(result.value.errors[0].code, "resource_limit");
  assert.equal(Object.hasOwn(result.value, "finding"), false);
  assert.equal(result.value.downstream_action_authorized, false);

  const run = spawnSync(process.execPath, ["tools/check-agent-claim.mjs", "-"], {
    cwd: new URL(repoRoot),
    input: bytes,
    encoding: "utf8",
  });
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.stderr, "");
  const value = JSON.parse(run.stdout);
  assert.equal(value.errors[0].code, "resource_limit");
  assert.equal(Object.hasOwn(value, "finding"), false);
  assert.equal(value.downstream_action_authorized, false);
});

test("versioned schemas parse and freeze the three contract identifiers", async () => {
  const schemas = await Promise.all([
    readFile(new URL("../schemas/agent-claim-check-input-v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../schemas/agent-claim-check-error-v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../schemas/agent-claim-check-receipt-v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(schemas[0].properties.schema_version.const, INPUT_SCHEMA_VERSION);
  assert.equal(schemas[1].properties.schema_version.const, ERROR_SCHEMA_VERSION);
  assert.equal(schemas[2].properties.schema_version.const, RECEIPT_SCHEMA_VERSION);
  assert.deepEqual(schemas[2].properties.finding.enum, ["supported", "contradicted", "insufficient_evidence"]);
  assert.equal(schemas[1].properties.finding, undefined);
  assert.equal(schemas[1].properties.errors.items.properties.code.enum.includes("resource_limit"), true);
  for (const schema of schemas) {
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  }
  for (const schema of [schemas[0], schemas[2]]) {
    for (const field of ["observed_value", "source_ref", "source_revision", "observed_channel"]) {
      assert.deepEqual(schema.$defs.evidence.properties[field], { type: "string" });
    }
  }
  const receipt = evaluate(validInput()).value;
  const error = evaluateAgentClaimBytes(Buffer.from("{", "utf8")).value;
  assert.deepEqual(Object.keys(receipt).sort(), [...schemas[2].required].sort());
  assert.deepEqual(Object.keys(error).sort(), [...schemas[1].required].sort());
});

test("the file and stdin CLI paths emit the same canonical receipt", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "daid-claim-check-test-"));
  try {
    const inputPath = join(temporary, "input.json");
    const bytes = Buffer.from(canonicalJson(validInput()), "utf8");
    await writeFile(inputPath, bytes);
    const expected = evaluateAgentClaimBytes(bytes).output;
    const fileRun = spawnSync(process.execPath, ["tools/check-agent-claim.mjs", inputPath], {
      cwd: new URL(repoRoot),
      encoding: "utf8",
    });
    const stdinRun = spawnSync(process.execPath, ["tools/check-agent-claim.mjs", "-"], {
      cwd: new URL(repoRoot),
      input: bytes,
      encoding: "utf8",
    });
    assert.equal(fileRun.status, 0, fileRun.stderr);
    assert.equal(stdinRun.status, 0, stdinRun.stderr);
    assert.equal(fileRun.stdout, expected);
    assert.equal(stdinRun.stdout, expected);
    assert.equal(fileRun.stderr, "");
    assert.equal(stdinRun.stderr, "");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the CLI uses exit 2 and the error envelope for invalid capture", () => {
  const input = validInput();
  input.capture.completeness = "complete-enough";
  const run = spawnSync(process.execPath, ["tools/check-agent-claim.mjs", "-"], {
    cwd: new URL(repoRoot),
    input: Buffer.from(JSON.stringify(input), "utf8"),
    encoding: "utf8",
  });
  assert.equal(run.status, 2, run.stderr);
  const value = JSON.parse(run.stdout);
  assert.equal(value.accepted, false);
  assert.equal(Object.hasOwn(value, "finding"), false);
  assert.equal(value.downstream_action_authorized, false);
});

test("the one offline adapter maps its frozen synthetic event and invokes the core", async () => {
  const mapped = mapSyntheticHarnessEvent(fixturePack.synthetic_harness_event);
  assert.equal(mapped.schema_version, INPUT_SCHEMA_VERSION);
  assert.equal(mapped.evidence.length, 2);
  const result = await runSyntheticAdapter();
  assert.equal(result.accepted, true);
  assert.equal(result.value.finding, "contradicted");
  const run = spawnSync(process.execPath, ["tools/agent-claim-check-synthetic-adapter.mjs"], {
    cwd: new URL(repoRoot),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, result.output);
});

test("core and adapter stay independent of site, AEC, network, models, and execution", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/agent-claim-check.mjs", import.meta.url), "utf8"),
    readFile(new URL("../tools/check-agent-claim.mjs", import.meta.url), "utf8"),
    readFile(new URL("../tools/agent-claim-check-synthetic-adapter.mjs", import.meta.url), "utf8"),
  ]);
  const text = files.join("\n").toLowerCase();
  for (const forbidden of [
    "src/site",
    "agent-evidence-catalog",
    "fetch(",
    "http.request",
    "https.request",
    "child_process",
    "exec(",
    "spawn(",
    "openai",
    "ollama",
  ]) assert.equal(text.includes(forbidden), false, forbidden);
});
