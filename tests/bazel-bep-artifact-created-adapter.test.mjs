import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADAPTER_ERROR_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  adaptBazelBepArtifactCreated,
  runBazelBepArtifactCreatedCli,
} from "../tools/adapt-bazel-bep-artifact-created.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_ROOT = join(ROOT, "fixtures", "bazel-bep-artifact-created-v1");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const FIXTURES = [
  ["supported-complete", "expected.receipt.json", 0, "supported"],
  ["contradicted-digest", "expected.receipt.json", 0, "contradicted"],
  ["insufficient-target-success-truncated", "expected.receipt.json", 0, "insufficient_evidence"],
  ["invalid-malformed-jsonl", "expected.adapter-error.json", 2, null],
];

const FIXTURE_SHA256 = Object.freeze({
  "contradicted-digest/events.bep.jsonl": "51f2f2d029b0b5e501b6a659a625a025a2fbb16958e94b5ed9749f3e535d5822",
  "contradicted-digest/expected.receipt.json": "e3d1cb0edcd000a2ad55218d8f7365c1c947b3b3e7a77c468ab0545f9c1b3e62",
  "contradicted-digest/request.json": "49ab082e498813ae61da9c3728f1f0be1dcc1a8b4f5b0859c7376c8b3b768001",
  "insufficient-target-success-truncated/events.bep.jsonl": "6269e5373f6d659b90049486193fc1cfaf5dc7f6cc8a576e6c959118eb716eed",
  "insufficient-target-success-truncated/expected.receipt.json": "fdbd6070f5b0a103d7752dbfe45204b01a963d1284852c9720a8871f2470ba0b",
  "insufficient-target-success-truncated/request.json": "eae3fb9347848bbdf19e3388cd1dac3550accc06bbf14d4ebe371ea76da6134e",
  "invalid-malformed-jsonl/events.bep.jsonl": "18a501d0446b03751702dd46a0079bf9dfa24683388a2872977b4549fc4e2171",
  "invalid-malformed-jsonl/expected.adapter-error.json": "0149d40acfbd2978df104209a3b4bdd3d8a15c45bfe7e45aad5f1d7d9569ca81",
  "invalid-malformed-jsonl/request.json": "663ea9cc3f3fa80c2d85f168348b67243c5342efeb30741bb5c6d652ae8c314b",
  "supported-complete/events.bep.jsonl": "6e7ff7dd3108d4d922fbdc621ce836331f69d468782b2c6f9dd3814b1fcd7406",
  "supported-complete/expected.receipt.json": "b4286be9437e778cc9e5c4a8d1d3373f54e3b098b4c76cd0c1bbcde49c03ec73",
  "supported-complete/request.json": "b6c3d5fce5c8909c785f2adce533478bc682748519793506ba76d22b608f60aa",
});

function requestFor(sourceBytes, mutate = () => {}) {
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    claim_id: "claim-bep-test",
    source: {
      format: "bazel-build-event-protocol-json",
      version: "8.7.0",
      sha256: sha256(sourceBytes),
    },
    selection: {
      build_uuid: "11111111-2222-3333-4444-555555555555",
      target_label: "//reports:summary",
      configuration_id: "cfg-k8-fastbuild",
      output_group: "default",
      artifact: {
        label: "summary-output",
        path_prefix: ["bazel-out", "k8-fastbuild", "bin", "reports"],
        name: "summary.json",
        digest: "a".repeat(64),
        length: "184",
      },
    },
  };
  mutate(request);
  return request;
}

function baseEvents() {
  const targetId = { targetCompleted: { label: "//reports:summary", configuration: { id: "cfg-k8-fastbuild" } } };
  const setId = { namedSet: { id: "set-summary" } };
  const finishId = { buildFinished: {} };
  return [
    {
      id: { started: {} },
      children: [targetId, finishId],
      started: {
        uuid: "11111111-2222-3333-4444-555555555555",
        buildToolVersion: "8.7.0",
        command: "build",
      },
    },
    {
      id: targetId,
      children: [setId],
      completed: {
        success: true,
        outputGroup: [{ name: "default", fileSets: [{ id: "set-summary" }] }],
      },
    },
    {
      id: setId,
      namedSetOfFiles: {
        files: [{
          pathPrefix: ["bazel-out", "k8-fastbuild", "bin", "reports"],
          name: "summary.json",
          digest: "a".repeat(64),
          length: "184",
          uri: "file:///synthetic/output/summary.json",
        }],
      },
    },
    {
      id: finishId,
      lastMessage: true,
      finished: { exitCode: { code: 0, name: "SUCCESS" }, finishTime: "2026-08-31T12:34:56.123456789Z" },
    },
  ];
}

function jsonl(events) {
  return Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

function runBytes(sourceBytes, mutateRequest = () => {}, options = {}) {
  const request = requestFor(sourceBytes, mutateRequest);
  const requestBytes = Buffer.from(JSON.stringify(request), "utf8");
  const first = adaptBazelBepArtifactCreated(requestBytes, sourceBytes, options);
  const second = adaptBazelBepArtifactCreated(requestBytes, sourceBytes, options);
  assert.equal(second.exitCode, first.exitCode);
  assert.equal(second.coreInvoked, first.coreInvoked);
  assert.equal(second.output, first.output);
  assert.deepEqual(second.value, first.value);
  assert.deepEqual(second.generatedInput, first.generatedInput);
  return first;
}

function runEvents(events, mutateRequest = () => {}, options = {}) {
  return runBytes(jsonl(events), mutateRequest, options);
}

function errorCodes(result) {
  return result.value.errors.map(({ code }) => code);
}

const FROZEN_ERROR_MESSAGES = Object.freeze({
  request_unreadable: "Request could not be read.",
  request_too_large: "Request exceeds 65536 bytes.",
  request_invalid_utf8: "Request is not valid UTF-8.",
  request_depth_exceeded: "Request nesting depth exceeds 16.",
  request_malformed_json: "Request is not one complete JSON object.",
  request_duplicate_key: "Request contains a duplicate key.",
  request_explicit_null: "Null is not allowed.",
  request_unknown_field: "Field is not allowed.",
  request_missing_field: "Required field is missing.",
  request_wrong_type: "Field has the wrong type.",
  request_non_nfc: "String is not NFC.",
  request_invalid_value: "Value conflicts with the frozen request contract.",
  source_unreadable: "Source could not be read.",
  source_too_large: "Source exceeds 8388608 bytes.",
  source_sha256_mismatch: "Source SHA-256 does not match the request.",
  source_invalid_utf8: "Source is not valid UTF-8.",
  source_empty: "Source contains no events.",
  source_too_many_events: "Source exceeds 10000 non-empty events.",
  event_malformed_json: "Event is not one complete JSON object.",
  event_duplicate_key: "Event contains a duplicate key.",
  event_explicit_null: "Null is not allowed.",
  event_top_level_wrong_type: "Event must be an object.",
  event_depth_exceeded: "Event nesting depth exceeds 64.",
  unknown_event_field: "Event field is not allowed by the frozen Bazel 8.7.0 profile.",
  event_non_nfc: "String is not NFC.",
  event_missing_id: "Event id is missing.",
  event_id_invalid: "Event id is invalid.",
  event_children_wrong_type: "Children must be an array.",
  event_child_id_invalid: "Child event id is invalid.",
  last_message_wrong_type: "lastMessage must be a boolean.",
  payload_oneof_multiple: "Event contains more than one recognized payload member.",
  payload_wrong_type: "Recognized payload has the wrong type.",
  file_oneof_invalid: "File form is invalid.",
  contents_invalid_base64: "File contents is not canonical base64.",
  digest_invalid: "File digest is not hexadecimal.",
  int64_invalid: "Integer field is not in the frozen ProtoJSON form.",
  aborted_reason_invalid: "Aborted reason is invalid.",
  timestamp_invalid: "Timestamp is not in the frozen canonical form.",
  unsupported_bazel_version: "Build tool version is not the frozen 8.7.0 profile.",
  started_payload_missing: "Root started payload is missing.",
  payload_id_mismatch: "Profile-governed event id and payload do not match.",
  missing_root: "Root started event is missing.",
  root_not_first: "Root started event is not event 0.",
  multiple_root_events: "More than one root started event was posted.",
  duplicate_event_id: "Event id was posted more than once.",
  duplicate_child_id: "Child id is repeated by one event.",
  event_not_preannounced: "Event id was not announced by an earlier event.",
  orphan_event: "Event is not reachable from the root.",
  event_graph_cycle: "Event graph is cyclic.",
  last_message_not_final: "lastMessage true is not on the final event.",
  multiple_last_message: "lastMessage true appears more than once.",
  last_message_with_missing_announced: "lastMessage true conflicts with unposted announced events.",
  mapping_invariant_failed: "Selected evidence mapping violated a frozen invariant.",
  core_rejected_generated_input: "Agent Claim Check rejected adapter-generated input.",
  internal_adapter_failure: "Adapter failed without a valid receipt.",
});

function issue(code, path) {
  return { code, path, message: FROZEN_ERROR_MESSAGES[code] };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function assertExactError(result, {
  stage,
  errors,
  exitCode = 2,
  sourceBytes,
  coreInvoked = false,
}) {
  assert.equal(result.accepted, false);
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.coreInvoked, coreInvoked);
  assert.equal(result.value.schema_version, ADAPTER_ERROR_SCHEMA_VERSION);
  assert.equal(result.value.stage, stage);
  assert.deepEqual(result.value.errors, errors);
  if (sourceBytes === undefined) assert.equal(Object.hasOwn(result.value, "source_sha256"), false);
  else assert.equal(result.value.source_sha256, sha256(sourceBytes));
  assert.equal(Object.hasOwn(result.value, "finding"), false);
  assert.equal(Object.hasOwn(result.value, "canonical_input_sha256"), false);
  assert.equal(Object.hasOwn(result.value, "intent_assessment"), false);
  assert.equal(result.value.downstream_action_authorized, false);
  assert.deepEqual(Object.keys(result.value).sort(), [
    "accepted", "downstream_action_authorized", "errors", "schema_version", "stage",
    ...(sourceBytes === undefined ? [] : ["source_sha256"]),
  ].sort());
  assert.equal(result.output, `${JSON.stringify(canonicalJson(result.value))}\n`, "envelope must be canonical");
  assert.equal(result.output.endsWith("\n\n"), false);
}

function assertError(result, stage, code, exitCode = 2) {
  assert.equal(result.accepted, false);
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.value.schema_version, ADAPTER_ERROR_SCHEMA_VERSION);
  assert.equal(result.value.stage, stage);
  assert.equal(errorCodes(result).includes(code), true, `${stage}:${code}: ${result.output}`);
  assert.equal(Object.hasOwn(result.value, "finding"), false);
  assert.equal(Object.hasOwn(result.value, "canonical_input_sha256"), false);
  assert.equal(result.value.downstream_action_authorized, false);
  assert.equal(result.output.endsWith("\n"), true);
  assert.equal(result.output.endsWith("\n\n"), false);
}

function evidence(result, id) {
  return result.value.evidence_results.find((item) => item.id === id);
}

test("the four public-safe logical fixtures run twice with frozen bytes and exact outputs", async () => {
  for (const [name, expectedName, exit, finding] of FIXTURES) {
    const directory = join(FIXTURE_ROOT, name);
    const request = await readFile(join(directory, "request.json"));
    const source = await readFile(join(directory, "events.bep.jsonl"));
    const expected = await readFile(join(directory, expectedName), "utf8");
    const first = adaptBazelBepArtifactCreated(request, source);
    const second = adaptBazelBepArtifactCreated(request, source);
    const cliFirst = spawnSync(process.execPath, [
      "tools/adapt-bazel-bep-artifact-created.mjs", join(directory, "request.json"), join(directory, "events.bep.jsonl"),
    ], { cwd: ROOT, encoding: "utf8" });
    const cliSecond = spawnSync(process.execPath, [
      "tools/adapt-bazel-bep-artifact-created.mjs", join(directory, "request.json"), join(directory, "events.bep.jsonl"),
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(first.exitCode, exit, name);
    assert.equal(first.output, second.output, name);
    assert.equal(sha256(Buffer.from(first.output)), sha256(Buffer.from(second.output)), name);
    assert.equal(first.output, expected, name);
    assert.equal(cliFirst.status, exit, name);
    assert.equal(cliSecond.status, exit, name);
    assert.equal(cliFirst.stderr, "", name);
    assert.equal(cliSecond.stderr, "", name);
    assert.equal(cliFirst.stdout, expected, name);
    assert.equal(cliSecond.stdout, expected, name);
    assert.equal(first.value.downstream_action_authorized, false, name);
    if (finding) {
      assert.equal(first.value.finding, finding, name);
      assert.equal(first.value.intent_assessment, "not-assessed", name);
      assert.deepEqual(first.value.does_not_establish, [
        "correctness", "safety", "identity", "successful-execution", "authority", "permission",
      ], name);
      assert.deepEqual(first.value.evidence_results.map(({ state }) => state),
        name === "supported-complete" ? ["supports", "supports", "supports", "supports", "supports"]
          : name === "contradicted-digest" ? ["supports", "supports", "contradictory", "supports", "supports"]
            : ["supports", "supports", "supports", "unknown", "absent"]);
    } else {
      assertError(first, "source-json", "event_malformed_json");
      assert.equal(first.coreInvoked, false);
    }
  }
});

test("every request, source, and expected-output fixture byte is hash-frozen", async () => {
  assert.equal(Object.keys(FIXTURE_SHA256).length, 12);
  for (const [path, digest] of Object.entries(FIXTURE_SHA256)) {
    const bytes = await readFile(join(FIXTURE_ROOT, path));
    assert.equal(sha256(bytes), digest, path);
    assert.equal(bytes.at(-1), 0x0a, `${path} lacks one terminal LF`);
    assert.notEqual(bytes.at(-2), 0x0a, `${path} has extra terminal LF`);
  }
});

test("the north-star truncated fixture cannot turn target success plus a named output into support", async () => {
  const directory = join(FIXTURE_ROOT, "insufficient-target-success-truncated");
  const result = adaptBazelBepArtifactCreated(
    await readFile(join(directory, "request.json")),
    await readFile(join(directory, "events.bep.jsonl")),
  );
  assert.equal(result.value.finding, "insufficient_evidence");
  assert.deepEqual(result.value.capture, {
    completeness: "partial",
    adapter_warnings: ["missing_last_message", "missing_announced_events"],
  });
  assert.equal(evidence(result, "bep-target-result").state, "supports");
  assert.equal(evidence(result, "bep-artifact-record").state, "supports");
  assert.equal(evidence(result, "bep-build-terminal").state, "unknown");
  assert.equal(evidence(result, "bep-stream-completeness").state, "absent");
});

test("request-stage validation covers every frozen code, exact depth boundary, and hash absence", async () => {
  const source = jsonl(baseEvents());
  const valid = requestFor(source);
  const cases = [
    ["request_too_large", Buffer.alloc(65_537, 0x20)],
    ["request_invalid_utf8", Buffer.from([0xff])],
    ["request_malformed_json", Buffer.from("{", "utf8")],
    ["request_duplicate_key", Buffer.from(JSON.stringify(valid).replace('"claim_id":', '"claim_id":"duplicate","claim_id":'), "utf8")],
    ["request_explicit_null", Buffer.from(JSON.stringify({ ...valid, claim_id: null }), "utf8")],
    ["request_unknown_field", Buffer.from(JSON.stringify({ ...valid, extra: true }), "utf8")],
    ["request_missing_field", Buffer.from(JSON.stringify((({ claim_id: _removed, ...rest }) => rest)(valid)), "utf8")],
    ["request_wrong_type", Buffer.from(JSON.stringify({ ...valid, claim_id: 4 }), "utf8")],
    ["request_non_nfc", Buffer.from(JSON.stringify({ ...valid, claim_id: "Cafe\u0301" }), "utf8")],
    ["request_invalid_value", Buffer.from(JSON.stringify({ ...valid, schema_version: "v2" }), "utf8")],
  ];
  for (const [code, requestBytes] of cases) {
    const result = adaptBazelBepArtifactCreated(requestBytes, source);
    assertError(result, "request", code);
    assert.equal(Object.hasOwn(result.value, "source_sha256"), false, code);
  }

  const nested = (count) => {
    let value = "leaf";
    for (let index = 0; index < count; index += 1) value = [value];
    return value;
  };
  const atLimit = Buffer.from(JSON.stringify({ ...valid, depthProbe: nested(15) }), "utf8");
  const beyond = Buffer.from(JSON.stringify({ ...valid, depthProbe: nested(16) }), "utf8");
  const acceptedDepth = adaptBazelBepArtifactCreated(atLimit, source);
  assertError(acceptedDepth, "request", "request_unknown_field");
  assert.equal(errorCodes(acceptedDepth).includes("request_depth_exceeded"), false);
  const rejectedDepth = adaptBazelBepArtifactCreated(beyond, source);
  assert.deepEqual(errorCodes(rejectedDepth), ["request_depth_exceeded"]);
  assert.equal(rejectedDepth.value.errors[0].path, "/request");

  const unreadable = await runBazelBepArtifactCreatedCli([join(ROOT, "missing-request.json"), join(ROOT, "missing-source.json")]);
  assertError(unreadable, "request", "request_unreadable", 1);
});

test("request values reject unknowns, traversal segments, noncanonical lengths, and unsupported profiles", () => {
  const source = jsonl(baseEvents());
  const mutations = [
    (request) => { request.source.format = "other"; },
    (request) => { request.source.version = "8.8.0"; },
    (request) => { request.source.sha256 = "A".repeat(64); },
    (request) => { request.selection.output_group = "all"; },
    (request) => { request.selection.artifact.label = "unsafe label"; },
    (request) => { request.selection.artifact.path_prefix = []; },
    (request) => { request.selection.artifact.path_prefix[0] = ".."; },
    (request) => { request.selection.artifact.path_prefix[0] = "a/b"; },
    (request) => { request.selection.artifact.name = "."; },
    (request) => { request.selection.artifact.digest = "ABC"; },
    (request) => { request.selection.artifact.length = "00"; },
  ];
  for (const mutate of mutations) assertError(runBytes(source, mutate), "request", "request_invalid_value");
});

test("the strict request contract covers every required field, nesting level, and frozen value class", () => {
  const source = jsonl(baseEvents());
  const exactRequestError = (mutate, code, path) => {
    const result = runBytes(source, mutate);
    assertExactError(result, { stage: "request", errors: [issue(code, path)] });
  };

  const unknowns = [
    [(request) => { request.extra = true; }, "/request/extra"],
    [(request) => { request.source.extra = true; }, "/request/source/extra"],
    [(request) => { request.selection.extra = true; }, "/request/selection/extra"],
    [(request) => { request.selection.artifact.extra = true; }, "/request/selection/artifact/extra"],
  ];
  unknowns.forEach(([mutate, path]) => exactRequestError(mutate, "request_unknown_field", path));

  const missing = [
    [(request) => { delete request.schema_version; }, "/request/schema_version"],
    [(request) => { delete request.claim_id; }, "/request/claim_id"],
    [(request) => { delete request.source; }, "/request/source"],
    [(request) => { delete request.selection; }, "/request/selection"],
    [(request) => { delete request.source.format; }, "/request/source/format"],
    [(request) => { delete request.source.version; }, "/request/source/version"],
    [(request) => { delete request.source.sha256; }, "/request/source/sha256"],
    [(request) => { delete request.selection.build_uuid; }, "/request/selection/build_uuid"],
    [(request) => { delete request.selection.target_label; }, "/request/selection/target_label"],
    [(request) => { delete request.selection.configuration_id; }, "/request/selection/configuration_id"],
    [(request) => { delete request.selection.output_group; }, "/request/selection/output_group"],
    [(request) => { delete request.selection.artifact; }, "/request/selection/artifact"],
    [(request) => { delete request.selection.artifact.label; }, "/request/selection/artifact/label"],
    [(request) => { delete request.selection.artifact.path_prefix; }, "/request/selection/artifact/path_prefix"],
    [(request) => { delete request.selection.artifact.name; }, "/request/selection/artifact/name"],
    [(request) => { delete request.selection.artifact.digest; }, "/request/selection/artifact/digest"],
    [(request) => { delete request.selection.artifact.length; }, "/request/selection/artifact/length"],
  ];
  missing.forEach(([mutate, path]) => exactRequestError(mutate, "request_missing_field", path));

  const wrongTypes = [
    [(request) => { request.claim_id = 1; }, "/request/claim_id"],
    [(request) => { request.source = "source"; }, "/request/source"],
    [(request) => { request.source.format = 1; }, "/request/source/format"],
    [(request) => { request.selection = []; }, "/request/selection"],
    [(request) => { request.selection.build_uuid = 1; }, "/request/selection/build_uuid"],
    [(request) => { request.selection.artifact = "artifact"; }, "/request/selection/artifact"],
    [(request) => { request.selection.artifact.path_prefix = "path"; }, "/request/selection/artifact/path_prefix"],
    [(request) => { request.selection.artifact.path_prefix[0] = 1; }, "/request/selection/artifact/path_prefix/0"],
    [(request) => { request.selection.artifact.length = 1; }, "/request/selection/artifact/length"],
  ];
  wrongTypes.forEach(([mutate, path]) => exactRequestError(mutate, "request_wrong_type", path));

  const invalidValues = [
    [(request) => { request.claim_id = ""; }, "/request/claim_id"],
    [(request) => { request.source.format = "other"; }, "/request/source/format"],
    [(request) => { request.source.version = "8.8.0"; }, "/request/source/version"],
    [(request) => { request.source.sha256 = "A".repeat(64); }, "/request/source/sha256"],
    [(request) => { request.selection.build_uuid = ""; }, "/request/selection/build_uuid"],
    [(request) => { request.selection.target_label = ""; }, "/request/selection/target_label"],
    [(request) => { request.selection.configuration_id = ""; }, "/request/selection/configuration_id"],
    [(request) => { request.selection.output_group = "other"; }, "/request/selection/output_group"],
    [(request) => { request.selection.artifact.label = ""; }, "/request/selection/artifact/label"],
    [(request) => { request.selection.artifact.label = `A${"a".repeat(64)}`; }, "/request/selection/artifact/label"],
    [(request) => { request.selection.artifact.path_prefix = []; }, "/request/selection/artifact/path_prefix"],
    [(request) => { request.selection.artifact.path_prefix[0] = ""; }, "/request/selection/artifact/path_prefix/0"],
    [(request) => { request.selection.artifact.path_prefix[0] = "."; }, "/request/selection/artifact/path_prefix/0"],
    [(request) => { request.selection.artifact.path_prefix[0] = ".."; }, "/request/selection/artifact/path_prefix/0"],
    [(request) => { request.selection.artifact.path_prefix[0] = "a/b"; }, "/request/selection/artifact/path_prefix/0"],
    [(request) => { request.selection.artifact.path_prefix[0] = "a\0b"; }, "/request/selection/artifact/path_prefix/0"],
    [(request) => { request.selection.artifact.name = ""; }, "/request/selection/artifact/name"],
    [(request) => { request.selection.artifact.name = "."; }, "/request/selection/artifact/name"],
    [(request) => { request.selection.artifact.name = ".."; }, "/request/selection/artifact/name"],
    [(request) => { request.selection.artifact.name = "a/b"; }, "/request/selection/artifact/name"],
    [(request) => { request.selection.artifact.name = "a\0b"; }, "/request/selection/artifact/name"],
    [(request) => { request.selection.artifact.digest = ""; }, "/request/selection/artifact/digest"],
    [(request) => { request.selection.artifact.digest = "ABC"; }, "/request/selection/artifact/digest"],
    [(request) => { request.selection.artifact.digest = "xyz"; }, "/request/selection/artifact/digest"],
    ...["", "00", "+1", "-1", "1.0", "1e0"].map((value) => [
      (request) => { request.selection.artifact.length = value; }, "/request/selection/artifact/length",
    ]),
  ];
  invalidValues.forEach(([mutate, path]) => exactRequestError(mutate, "request_invalid_value", path));

  const boundaryResult = runBytes(source, (request) => {
    request.selection.artifact.label = `A${"a".repeat(63)}`;
  });
  assert.equal(boundaryResult.accepted, true, boundaryResult.output);
});

test("source read and integrity stages precede JSON and include the source hash only after a bounded read", async () => {
  const validDirectory = join(FIXTURE_ROOT, "supported-complete");
  const unreadable = await runBazelBepArtifactCreatedCli([
    join(validDirectory, "request.json"), join(ROOT, "missing-events.bep.jsonl"),
  ]);
  assertError(unreadable, "source-read", "source_unreadable", 1);
  assert.equal(Object.hasOwn(unreadable.value, "source_sha256"), false);

  const huge = Buffer.alloc(8_388_609, 0x20);
  const hugeRequest = Buffer.from(JSON.stringify(requestFor(huge)), "utf8");
  const tooLarge = adaptBazelBepArtifactCreated(hugeRequest, huge);
  assertError(tooLarge, "source-read", "source_too_large");
  assert.equal(Object.hasOwn(tooLarge.value, "source_sha256"), false);

  const source = jsonl(baseEvents());
  const mismatch = runBytes(source, (request) => { request.source.sha256 = "0".repeat(64); });
  assertError(mismatch, "source-integrity", "source_sha256_mismatch");
  assert.equal(mismatch.value.source_sha256, sha256(source));

  const invalidUtf8 = Buffer.from([0xff]);
  const utf8 = runBytes(invalidUtf8);
  assertError(utf8, "source-integrity", "source_invalid_utf8");
  assert.equal(utf8.value.source_sha256, sha256(invalidUtf8));

  const empty = Buffer.from(" \n\r\n", "utf8");
  assertError(runBytes(empty), "source-integrity", "source_empty");
  const many = Buffer.from(`${Array.from({ length: 10_001 }, () => "{}").join("\n")}\n`, "utf8");
  assertError(runBytes(many), "source-integrity", "source_too_many_events");
});

test("request bytes, source bytes, and event counts accept their exact maximum boundary", () => {
  const source = jsonl(baseEvents());
  const request = Buffer.from(JSON.stringify(requestFor(source)), "utf8");
  const requestAtLimit = Buffer.concat([request, Buffer.alloc(65_536 - request.length, 0x20)]);
  const requestFirst = adaptBazelBepArtifactCreated(requestAtLimit, source);
  const requestSecond = adaptBazelBepArtifactCreated(requestAtLimit, source);
  assert.equal(requestFirst.accepted, true, requestFirst.output);
  assert.equal(requestSecond.output, requestFirst.output);

  const sourceAtLimit = Buffer.concat([source, Buffer.alloc(8_388_608 - source.length, 0x20)]);
  const sourceLimitResult = runBytes(sourceAtLimit);
  assert.equal(sourceLimitResult.accepted, true, sourceLimitResult.output);

  const ids = Array.from({ length: 9_999 }, (_unused, index) => ({ progress: { opaqueCount: index + 1 } }));
  const events = [{ id: { started: {} }, children: ids, started: { buildToolVersion: "8.7.0" } }];
  ids.forEach((id, index) => events.push({ id, ...(index === ids.length - 1 ? { lastMessage: true } : {}) }));
  const eventLimitResult = runEvents(events);
  assert.equal(eventLimitResult.accepted, true, eventLimitResult.output);
  assert.equal(evidence(eventLimitResult, "bep-stream-completeness").state, "supports");
});

test("source-json validation covers every frozen code and privacy-safe paths", () => {
  const cases = [];
  cases.push(["event_malformed_json", Buffer.from('{"id":\n', "utf8")]);
  cases.push(["event_duplicate_key", Buffer.from('{"id":{"started":{}},"id":{"started":{}},"started":{"buildToolVersion":"8.7.0"}}\n', "utf8")]);
  cases.push(["event_explicit_null", jsonl([{ id: null, started: { buildToolVersion: "8.7.0" } }])]);
  cases.push(["event_top_level_wrong_type", Buffer.from("4\n", "utf8")]);
  cases.push(["unknown_event_field", jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, extraPayload: true }])]);
  cases.push(["event_non_nfc", jsonl([{ id: { started: {} }, started: { uuid: "Cafe\u0301", buildToolVersion: "8.7.0" } }])]);
  cases.push(["event_missing_id", jsonl([{ started: { buildToolVersion: "8.7.0" } }])]);
  cases.push(["event_id_invalid", jsonl([{ id: { build_finished: {} }, finished: {} }])]);
  cases.push(["event_children_wrong_type", jsonl([{ id: { started: {} }, children: {}, started: { buildToolVersion: "8.7.0" } }])]);
  cases.push(["event_child_id_invalid", jsonl([{ id: { started: {} }, children: [{}], started: { buildToolVersion: "8.7.0" } }])]);
  cases.push(["last_message_wrong_type", jsonl([{ id: { started: {} }, lastMessage: "true", started: { buildToolVersion: "8.7.0" } }])]);
  cases.push(["payload_oneof_multiple", jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, aborted: {} }])]);
  cases.push(["payload_wrong_type", jsonl([{ id: { started: {} }, started: "bad" }])]);

  const fileCases = [
    ["file_oneof_invalid", (file) => { file.contents = ""; }],
    ["contents_invalid_base64", (file) => { delete file.uri; file.contents = "not base64"; }],
    ["digest_invalid", (file) => { file.digest = "not-hex"; }],
    ["int64_invalid", (file) => { file.length = "00"; }],
  ];
  for (const [code, mutate] of fileCases) {
    const events = baseEvents();
    mutate(events[2].namedSetOfFiles.files[0]);
    cases.push([code, jsonl(events)]);
  }
  for (const contents of ["AB==", "AAB="]) {
    const events = baseEvents();
    const file = events[2].namedSetOfFiles.files[0];
    delete file.uri;
    file.contents = contents;
    cases.push(["contents_invalid_base64", jsonl(events)]);
  }
  {
    const events = baseEvents();
    delete events[1].completed;
    events[1].aborted = { reason: 99 };
    cases.push(["aborted_reason_invalid", jsonl(events)]);
  }
  {
    const events = baseEvents();
    events[3].finished.finishTime = "2026-99-99T00:00:00Z";
    cases.push(["timestamp_invalid", jsonl(events)]);
  }

  for (const [code, source] of cases) {
    const result = runBytes(source);
    assertError(result, "source-json", code);
    assert.equal(result.value.source_sha256, sha256(source), code);
    assert.equal(result.output.includes("not-hex"), false, code);
    assert.equal(result.output.includes("extraPayload"), false, code);
  }
});

test("event depth 64 admits only the privacy-safe unknown-field error and depth 65 suppresses it", () => {
  const nested = (count) => {
    let value = "leaf";
    for (let index = 0; index < count; index += 1) value = [value];
    return value;
  };
  const atLimit = jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, extraPayload: nested(63) }]);
  const beyond = jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, extraPayload: nested(64) }]);
  const acceptedDepth = runBytes(atLimit);
  assert.deepEqual(errorCodes(acceptedDepth), ["unknown_event_field"]);
  assert.equal(acceptedDepth.value.errors[0].path, "/events/0");
  const rejectedDepth = runBytes(beyond);
  assert.deepEqual(errorCodes(rejectedDepth), ["event_depth_exceeded"]);
  assert.equal(rejectedDepth.value.errors[0].path, "/events/0");
  assert.equal(rejectedDepth.value.source_sha256, sha256(beyond));
});

test("unknown top-level fields collapse, retain independent allowed-field errors, and hide key names and values", () => {
  const source = Buffer.from('{"id":{},"extraPayload":null,"anotherSecret":"never-emit","started":{},"aborted":{}}\n', "utf8");
  const result = runBytes(source);
  assertError(result, "source-json", "unknown_event_field");
  assert.equal(errorCodes(result).filter((code) => code === "unknown_event_field").length, 1);
  assert.equal(errorCodes(result).includes("event_id_invalid"), true);
  assert.equal(errorCodes(result).includes("payload_oneof_multiple"), true);
  assert.equal(errorCodes(result).includes("event_explicit_null"), false);
  assert.equal(result.output.includes("extraPayload"), false);
  assert.equal(result.output.includes("anotherSecret"), false);
  assert.equal(result.output.includes("never-emit"), false);
});

test("zero, one, and two recognized payloads retain the exact unknown-field contract", () => {
  const cases = [
    [{ id: { progress: {} }, extraPayload: true }, [issue("unknown_event_field", "/events/0")]],
    [{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, extraPayload: null }, [
      issue("unknown_event_field", "/events/0"),
    ]],
    [{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, aborted: {}, extraPayload: true }, [
      issue("payload_oneof_multiple", "/events/0"),
      issue("unknown_event_field", "/events/0"),
    ]],
  ];
  for (const [event, errors] of cases) {
    const source = jsonl([event]);
    assertExactError(runBytes(source), { stage: "source-json", errors, sourceBytes: source });
  }

  const allowedErrorSource = Buffer.from('{"id":{},"children":{},"extraPayload":null,"anotherSecret":"never-emit"}\n', "utf8");
  assertExactError(runBytes(allowedErrorSource), {
    stage: "source-json",
    sourceBytes: allowedErrorSource,
    errors: [
      issue("unknown_event_field", "/events/0"),
      issue("event_children_wrong_type", "/events/0/children"),
      issue("event_id_invalid", "/events/0/id"),
    ],
  });
});

test("the exact allowed top-level event-key and recognized-payload inventory is accepted", () => {
  const payloads = [
    "progress", "aborted", "started", "unstructuredCommandLine", "structuredCommandLine",
    "optionsParsed", "workspaceStatus", "fetch", "configuration", "expanded", "configured",
    "action", "namedSetOfFiles", "completed", "testResult", "testProgress", "testSummary",
    "targetSummary", "finished", "buildToolLogs", "buildMetrics", "workspaceInfo",
    "buildMetadata", "convenienceSymlinksIdentified", "execRequest",
  ];
  const ids = payloads.map((_payload, index) => ({ progress: { opaqueCount: index + 1 } }));
  const events = [{
    id: { started: {} },
    children: ids,
    started: { uuid: "11111111-2222-3333-4444-555555555555", buildToolVersion: "8.7.0", command: "build" },
  }];
  payloads.forEach((payload, index) => {
    events.push({ id: ids[index], [payload]: {}, ...(index === payloads.length - 1 ? { lastMessage: true } : {}) });
  });
  const result = runEvents(events);
  assert.equal(result.accepted, true, result.output);
  assert.equal(evidence(result, "bep-stream-completeness").state, "supports");
});

test("every profile-governed ID enforces its normal, aborted, missing, wrong, and multiple payload boundary", () => {
  assert.equal(runEvents(baseEvents()).accepted, true);
  const governed = [
    [1, "targetCompleted", "completed"],
    [2, "namedSet", "namedSetOfFiles"],
    [3, "buildFinished", "finished"],
  ];
  for (const [index, _member, normal] of governed) {
    const abortedEvents = baseEvents();
    delete abortedEvents[index][normal];
    abortedEvents[index].aborted = { reason: "INCOMPLETE", description: "private-description-must-not-escape" };
    const aborted = runEvents(abortedEvents);
    assert.equal(aborted.accepted, true, aborted.output);

    const missingEvents = baseEvents();
    delete missingEvents[index][normal];
    const missingSource = jsonl(missingEvents);
    assertExactError(runBytes(missingSource), {
      stage: "source-profile", sourceBytes: missingSource,
      errors: [issue("payload_id_mismatch", `/events/${index}`)],
    });

    const wrongEvents = baseEvents();
    delete wrongEvents[index][normal];
    wrongEvents[index].progress = {};
    const wrongSource = jsonl(wrongEvents);
    assertExactError(runBytes(wrongSource), {
      stage: "source-profile", sourceBytes: wrongSource,
      errors: [issue("payload_id_mismatch", `/events/${index}`)],
    });

    const multipleEvents = baseEvents();
    multipleEvents[index].aborted = {};
    const multipleSource = jsonl(multipleEvents);
    assertExactError(runBytes(multipleSource), {
      stage: "source-json", sourceBytes: multipleSource,
      errors: [issue("payload_oneof_multiple", `/events/${index}`)],
    });
  }

  const rootMissing = baseEvents();
  delete rootMissing[0].started;
  const rootMissingSource = jsonl(rootMissing);
  assertExactError(runBytes(rootMissingSource), {
    stage: "source-profile", sourceBytes: rootMissingSource,
    errors: [issue("started_payload_missing", "/events/0")],
  });
  const rootWrong = baseEvents();
  delete rootWrong[0].started;
  rootWrong[0].progress = {};
  const rootWrongSource = jsonl(rootWrong);
  assertExactError(runBytes(rootWrongSource), {
    stage: "source-profile", sourceBytes: rootWrongSource,
    errors: [issue("payload_id_mismatch", "/events/0")],
  });
  const wrongVersion = baseEvents();
  wrongVersion[0].started.buildToolVersion = "8.8.0";
  const wrongVersionSource = jsonl(wrongVersion);
  assertExactError(runBytes(wrongVersionSource), {
    stage: "source-profile", sourceBytes: wrongVersionSource,
    errors: [issue("unsupported_bazel_version", "/events/0/started/buildToolVersion")],
  });
});

test("unrelated graph events accept zero or one recognized payload and reject two", () => {
  const progressId = { progress: { opaqueCount: 1 } };
  for (const payload of [null, { progress: {} }]) {
    const events = baseEvents();
    events[0].children.push(progressId);
    const event = { id: progressId };
    if (payload) Object.assign(event, payload);
    events.splice(-1, 0, event);
    const result = runEvents(events);
    assert.equal(result.accepted, true, result.output);
  }
  const events = baseEvents();
  events[0].children.push(progressId);
  events.splice(-1, 0, { id: progressId, progress: {}, aborted: {} });
  const source = jsonl(events);
  assertExactError(runBytes(source), {
    stage: "source-json", sourceBytes: source,
    errors: [issue("payload_oneof_multiple", "/events/3")],
  });
});

function pairLines(announcement, posting, postPayload = {}) {
  return [
    JSON.stringify({
      id: { started: {} },
      children: [announcement],
      started: { uuid: "11111111-2222-3333-4444-555555555555", buildToolVersion: "8.7.0", command: "build" },
    }),
    JSON.stringify({ id: posting, lastMessage: true, ...postPayload }),
  ];
}

test("schema-aware Event ID normalization joins protobuf-equivalent spellings", () => {
  const pairs = [
    [{ progress: {} }, { progress: { opaqueCount: 0 } }],
    [{ structuredCommandLine: {} }, { structuredCommandLine: { commandLineLabel: "" } }],
    [{ pattern: {} }, { pattern: { pattern: [] } }],
    [{ fetch: {} }, { fetch: { url: "", downloader: 0 } }],
    [{ fetch: { downloader: "UNKNOWN" } }, { fetch: { downloader: 0 } }],
    [{ fetch: { downloader: "HTTP" } }, { fetch: { downloader: 1, url: "" } }],
    [{ configuredLabel: { label: "x", configuration: {} } }, { configuredLabel: { configuration: { id: "" }, label: "x" } }],
  ];
  for (const pair of pairs) {
    for (const [announcement, posting] of [pair, [...pair].reverse()]) {
      const source = Buffer.from(`${pairLines(announcement, posting).join("\n")}\n`, "utf8");
      const result = runBytes(source);
      assert.equal(result.accepted, true, result.output);
      assert.equal(evidence(result, "bep-stream-completeness").state, "supports");
    }
  }

  for (const [announcedZero, postedZero] of [["-0.0", "0e0"], ["0e0", "-0.0"]]) {
    const numericSource = Buffer.from([
      `{"id":{"started":{}},"children":[{"progress":{"opaqueCount":${announcedZero}}}],"started":{"uuid":"11111111-2222-3333-4444-555555555555","buildToolVersion":"8.7.0","command":"build"}}`,
      `{"id":{"progress":{"opaqueCount":${postedZero}}},"lastMessage":true}`,
    ].join("\n") + "\n", "utf8");
    assert.equal(runBytes(numericSource).accepted, true);
  }

  for (const [announcedLabel, postedLabel] of [['"\\u0078"', '"x"'], ['"x"', '"\\u0078"']]) {
    const escapedSource = Buffer.from([
      `{"id":{"started":{}},"children":[{"unconfiguredLabel":{"label":${announcedLabel}}}],"started":{"uuid":"11111111-2222-3333-4444-555555555555","buildToolVersion":"8.7.0","command":"build"}}`,
      `{"id":{"unconfiguredLabel":{"label":${postedLabel}}},"lastMessage":true}`,
    ].join("\n") + "\n", "utf8");
    assert.equal(runBytes(escapedSource).accepted, true);
  }
});

test("every frozen Bazel 8.7.0 Event ID schema row participates in one valid graph", () => {
  const ids = [
    { unstructuredCommandLine: {} },
    { workspaceStatus: {} },
    { optionsParsed: {} },
    { buildFinished: {} },
    { buildToolLogs: {} },
    { buildMetrics: {} },
    { workspace: {} },
    { buildMetadata: {} },
    { convenienceSymlinksIdentified: {} },
    { execRequest: {} },
    { unknown: { details: "synthetic" } },
    { progress: { opaqueCount: 1 } },
    { structuredCommandLine: { commandLineLabel: "synthetic" } },
    { fetch: { url: "synthetic", downloader: "GRPC" } },
    { configuration: { id: "cfg-other" } },
    { targetConfigured: { label: "//other:configured", aspect: "" } },
    { pattern: { pattern: ["//other:one", "//other:two"] } },
    { patternSkipped: { pattern: ["//other:skip"] } },
    { namedSet: { id: "set-other" } },
    { targetCompleted: { label: "//other:target", configuration: { id: "cfg-other" }, aspect: "" } },
    { actionCompleted: { primaryOutput: "synthetic", label: "//other:action", configuration: { id: "cfg-other" } } },
    { unconfiguredLabel: { label: "//other:unconfigured" } },
    { configuredLabel: { label: "//other:label", configuration: { id: "cfg-other" } } },
    { testSummary: { label: "//other:test-summary", configuration: { id: "cfg-other" } } },
    { targetSummary: { label: "//other:target-summary", configuration: { id: "cfg-other" } } },
    { testResult: { label: "//other:test-result", configuration: { id: "cfg-other" }, run: 1, shard: 2, attempt: 3 } },
    { testProgress: { label: "//other:test-progress", configuration: { id: "cfg-other" }, run: 1, shard: 2, attempt: 3, opaqueCount: 4 } },
  ];
  const events = [{
    id: { started: {} },
    children: ids,
    started: { uuid: "11111111-2222-3333-4444-555555555555", buildToolVersion: "8.7.0", command: "build" },
  }];
  ids.forEach((id, index) => {
    const member = Object.keys(id)[0];
    const event = { id };
    if (member === "buildFinished") event.finished = { exitCode: {}, finishTime: "2026-01-01T00:00:00Z" };
    if (member === "namedSet") event.namedSetOfFiles = {};
    if (member === "targetCompleted") event.completed = {};
    if (index === ids.length - 1) event.lastMessage = true;
    events.push(event);
  });
  const result = runEvents(events);
  assert.equal(result.accepted, true, result.output);
  assert.equal(evidence(result, "bep-stream-completeness").state, "supports");
});

test("Event ID message presence remains distinct and co-emits the frozen graph errors", () => {
  const announcement = { configuredLabel: { label: "x" } };
  const posting = { configuredLabel: { label: "x", configuration: {} } };
  const result = runBytes(Buffer.from(`${pairLines(announcement, posting).join("\n")}\n`, "utf8"));
  assertError(result, "event-graph", "event_not_preannounced");
  assert.equal(errorCodes(result).includes("orphan_event"), true);
  assert.equal(errorCodes(result).includes("last_message_with_missing_announced"), true);
  assert.equal(errorCodes(result).includes("duplicate_event_id"), false);
});

test("Event ID array order is significant and child-ID null produces only its exact explicit-null error", () => {
  const arrayOrder = runBytes(Buffer.from(`${pairLines(
    { pattern: { pattern: ["a", "b"] } },
    { pattern: { pattern: ["b", "a"] } },
  ).join("\n")}\n`, "utf8"));
  assertError(arrayOrder, "event-graph", "event_not_preannounced");
  assert.equal(errorCodes(arrayOrder).includes("last_message_with_missing_announced"), true);

  const childNull = runBytes(Buffer.from('{"id":{"started":{}},"children":[{"progress":{"opaqueCount":null}}],"started":{"buildToolVersion":"8.7.0"}}\n', "utf8"));
  assert.deepEqual(errorCodes(childNull), ["event_explicit_null"]);
  assert.equal(childNull.value.errors[0].path, "/events/0/children/0/progress/opaqueCount");
});

test("invalid Event ID shapes and types fail at the exact ID path while ID null emits only explicit-null", () => {
  const invalid = [
    { build_finished: {} },
    { futureMember: {} },
    { progress: { extra: 1 } },
    { progress: { opaqueCount: "0" } },
    { progress: { opaqueCount: 2_147_483_648 } },
    { progress: { opaqueCount: 0.5 } },
    { progress: "wrong" },
    {},
    { progress: {}, started: {} },
  ];
  for (const id of invalid) {
    const result = runBytes(jsonl([{ id, progress: {} }]));
    assertError(result, "source-json", "event_id_invalid");
    assert.equal(result.value.errors.some(({ code, path }) => code === "event_id_invalid" && path === "/events/0/id"), true);
  }
  const nullResult = runBytes(Buffer.from('{"id":{"progress":{"opaqueCount":null}},"progress":{}}\n', "utf8"));
  assert.deepEqual(errorCodes(nullResult), ["event_explicit_null"]);
  assert.equal(nullResult.value.errors[0].path, "/events/0/id/progress/opaqueCount");
});

test("root, announcement, reachability, DAG, duplicate, and marker graph classifications are exact", () => {
  const cases = [];
  cases.push(["missing_root", [{ id: { progress: {} }, lastMessage: true }]]);
  cases.push(["root_not_first", [
    { id: { progress: {} }, children: [{ started: {} }] },
    { id: { started: {} }, lastMessage: true, started: { buildToolVersion: "8.7.0" } },
  ]]);
  cases.push(["multiple_root_events", [
    { id: { started: {} }, children: [{ started: {} }], started: { buildToolVersion: "8.7.0" } },
    { id: { started: {} }, lastMessage: true, started: { buildToolVersion: "8.7.0" } },
  ]]);
  cases.push(["duplicate_event_id", [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" } },
    { id: { progress: {} } },
    { id: { progress: {} }, lastMessage: true },
  ]]);
  cases.push(["duplicate_child_id", [
    { id: { started: {} }, children: [{ progress: {} }, { progress: { opaqueCount: 0 } }], started: { buildToolVersion: "8.7.0" } },
    { id: { progress: {} }, lastMessage: true },
  ]]);
  cases.push(["event_not_preannounced", [
    { id: { started: {} }, started: { buildToolVersion: "8.7.0" } },
    { id: { progress: {} }, lastMessage: true },
  ]]);
  cases.push(["orphan_event", [
    { id: { started: {} }, children: [{ buildFinished: {} }], started: { buildToolVersion: "8.7.0" } },
    { id: { progress: {} }, children: [{ progress: { opaqueCount: 1 } }] },
    { id: { progress: { opaqueCount: 1 } } },
    { id: { buildFinished: {} }, lastMessage: true, finished: { exitCode: {}, finishTime: "2026-01-01T00:00:00Z" } },
  ]]);
  cases.push(["event_graph_cycle", [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" } },
    { id: { progress: {} }, children: [{ started: {} }], lastMessage: true },
  ]]);
  cases.push(["last_message_not_final", [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" }, lastMessage: true },
    { id: { progress: {} } },
  ]]);
  cases.push(["multiple_last_message", [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" }, lastMessage: true },
    { id: { progress: {} }, lastMessage: true },
  ]]);
  cases.push(["last_message_with_missing_announced", [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" }, lastMessage: true },
  ]]);
  for (const [code, events] of cases) assertError(runEvents(events), "event-graph", code);
});

test("an event posted before a later announcement remains not preannounced", () => {
  const posted = { progress: {} };
  const announcer = { progress: { opaqueCount: 1 } };
  const events = [
    { id: { started: {} }, children: [announcer], started: { buildToolVersion: "8.7.0" } },
    { id: posted },
    { id: announcer, children: [posted], lastMessage: true },
  ];
  assertError(runEvents(events), "event-graph", "event_not_preannounced");
});

test("shared DAG parents are valid, while self-edges and child order preserve exact graph semantics", () => {
  const shared = { progress: { opaqueCount: 2 } };
  const left = { progress: { opaqueCount: 0 } };
  const right = { progress: { opaqueCount: 1 } };
  const events = [
    { id: { started: {} }, children: [left, right], started: { buildToolVersion: "8.7.0" } },
    { id: left, children: [shared] },
    { id: right, children: [shared] },
    { id: shared, lastMessage: true },
  ];
  assert.equal(runEvents(events).accepted, true);
  const self = [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" } },
    { id: { progress: {} }, children: [{ progress: { opaqueCount: 0 } }], lastMessage: true },
  ];
  assertError(runEvents(self), "event-graph", "event_graph_cycle");
});

test("omitted and explicit-false lastMessage are valid partial captures, while one final true closes the graph", () => {
  const omitted = baseEvents();
  delete omitted.at(-1).lastMessage;
  const omittedResult = runEvents(omitted);
  assert.equal(omittedResult.accepted, true);
  assert.deepEqual(omittedResult.value.capture, { completeness: "partial", adapter_warnings: ["missing_last_message"] });
  const explicitFalse = baseEvents();
  explicitFalse.at(-1).lastMessage = false;
  assert.deepEqual(runEvents(explicitFalse).value.capture, omittedResult.value.capture);
  assert.equal(evidence(runEvents(baseEvents()), "bep-stream-completeness").state, "supports");
  const nullMarker = baseEvents();
  nullMarker.at(-1).lastMessage = null;
  assertError(runEvents(nullMarker), "source-json", "last_message_wrong_type");
});

test("an unposted announced event is partial without a true marker and invalid with one", () => {
  const partial = [
    { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" } },
  ];
  const partialResult = runEvents(partial);
  assert.equal(partialResult.accepted, true);
  assert.deepEqual(partialResult.value.capture.adapter_warnings, ["missing_last_message", "missing_announced_events"]);
  const asserted = structuredClone(partial);
  asserted[0].lastMessage = true;
  assertError(runEvents(asserted), "event-graph", "last_message_with_missing_announced");
});

test("Aborted dispositions are frozen for every accepted reason and descriptions never escape", () => {
  const reasons = [
    [undefined, "UNKNOWN"], ["UNKNOWN", "UNKNOWN"], ["USER_INTERRUPTED", "USER_INTERRUPTED"],
    ["NO_ANALYZE", "NO_ANALYZE"], ["NO_BUILD", "NO_BUILD"], ["TIME_OUT", "TIME_OUT"],
    ["REMOTE_ENVIRONMENT_FAILURE", "REMOTE_ENVIRONMENT_FAILURE"], ["INTERNAL", "INTERNAL"],
    ["LOADING_FAILURE", "LOADING_FAILURE"], ["ANALYSIS_FAILURE", "ANALYSIS_FAILURE"],
    ["SKIPPED", "SKIPPED"], ["INCOMPLETE", "INCOMPLETE"], ["OUT_OF_MEMORY", "OUT_OF_MEMORY"],
    [0, "UNKNOWN"], [1, "USER_INTERRUPTED"], [8, "NO_ANALYZE"], [9, "NO_BUILD"],
    [2, "TIME_OUT"], [3, "REMOTE_ENVIRONMENT_FAILURE"], [4, "INTERNAL"],
    [5, "LOADING_FAILURE"], [6, "ANALYSIS_FAILURE"], [7, "SKIPPED"],
    [10, "INCOMPLETE"], [11, "OUT_OF_MEMORY"],
  ];
  for (const [reason, normalizedReason] of reasons) {
    const events = baseEvents();
    delete events[1].completed;
    events[1].aborted = { ...(reason === undefined ? {} : { reason }), description: "never-emit-aborted-description" };
    const result = runEvents(events);
    assert.equal(result.value.finding, "contradicted", result.output);
    assert.equal(evidence(result, "bep-target-result").state, "contradictory");
    assert.equal(evidence(result, "bep-artifact-record").state, "absent");
    assert.equal(result.output.includes("never-emit-aborted-description"), false);

    const terminalEvents = baseEvents();
    delete terminalEvents[3].finished;
    terminalEvents[3].aborted = { ...(reason === undefined ? {} : { reason }), description: "terminal-private" };
    const terminalReasonResult = runEvents(terminalEvents);
    assert.equal(evidence(terminalReasonResult, "bep-build-terminal").state, "contradictory");
    assert.equal(evidence(terminalReasonResult, "bep-build-terminal").observed_value, `aborted_reason=${normalizedReason}`);
    assert.equal(terminalReasonResult.output.includes("terminal-private"), false);
  }

  const terminal = baseEvents();
  delete terminal[3].finished;
  terminal[3].aborted = { reason: "TIME_OUT", description: "terminal-private" };
  const terminalResult = runEvents(terminal);
  assert.equal(evidence(terminalResult, "bep-build-terminal").state, "contradictory");
  assert.equal(evidence(terminalResult, "bep-build-terminal").observed_value, "aborted_reason=TIME_OUT");
  assert.equal(terminalResult.output.includes("terminal-private"), false);

  const named = baseEvents();
  delete named[2].namedSetOfFiles;
  named[2].aborted = { reason: "INCOMPLETE", description: "set-private" };
  const namedResult = runEvents(named);
  assert.equal(evidence(namedResult, "bep-artifact-record").state, "unknown");
  assert.equal(namedResult.value.capture.adapter_warnings.includes("selected_named_set_aborted"), true);
  assert.equal(namedResult.output.includes("set-private"), false);

  const partialTarget = baseEvents();
  delete partialTarget[1].completed;
  partialTarget[1].aborted = { reason: "INCOMPLETE" };
  delete partialTarget.at(-1).lastMessage;
  const partialTargetResult = runEvents(partialTarget);
  assert.equal(evidence(partialTargetResult, "bep-target-result").state, "contradictory");
  assert.equal(evidence(partialTargetResult, "bep-artifact-record").state, "unknown");
  assert.equal(partialTargetResult.value.capture.completeness, "partial");

  for (const reason of [-1, 12, 99, 0.5, "FUTURE_REASON", {}, []]) {
    const invalid = baseEvents();
    delete invalid[1].completed;
    invalid[1].aborted = { reason };
    const source = jsonl(invalid);
    assertExactError(runBytes(source), {
      stage: "source-json", sourceBytes: source,
      errors: [issue("aborted_reason_invalid", "/events/1/aborted/reason")],
    });
  }
});

test("unrelated Aborted events are graph-only and leave selected evidence unchanged", () => {
  const events = baseEvents();
  const unrelated = { progress: { opaqueCount: 7 } };
  events[0].children.push(unrelated);
  events.splice(-1, 0, { id: unrelated, aborted: { reason: "SKIPPED", description: "unrelated" } });
  const result = runEvents(events);
  assert.equal(result.value.finding, "supported");
  assert.deepEqual(result.value.evidence_results.map(({ state }) => state), Array(5).fill("supports"));
  assert.equal(result.output.includes("unrelated"), false);
});

test("aspect results remain isolated from the selected base target and never add a warning", () => {
  const explicitEmpty = baseEvents();
  explicitEmpty[0].children[0].targetCompleted.aspect = "";
  explicitEmpty[1].id.targetCompleted.aspect = "";
  const explicitEmptyResult = runEvents(explicitEmpty);
  const omittedResult = runEvents(baseEvents());
  assert.deepEqual(explicitEmptyResult.value.evidence_results.map(({ id, state }) => ({ id, state })),
    omittedResult.value.evidence_results.map(({ id, state }) => ({ id, state })));
  assert.equal(evidence(explicitEmptyResult, "bep-target-result").observed_value,
    evidence(omittedResult, "bep-target-result").observed_value);
  assert.equal(evidence(explicitEmptyResult, "bep-artifact-record").observed_value,
    evidence(omittedResult, "bep-artifact-record").observed_value);
  assert.deepEqual(explicitEmptyResult.value.capture, omittedResult.value.capture);

  const aspectId = {
    targetCompleted: {
      label: "//reports:summary",
      aspect: "//tools:synthetic_aspect.bzl%aspect",
      configuration: { id: "cfg-k8-fastbuild" },
    },
  };
  const events = baseEvents();
  events[0].children.push(aspectId);
  events.splice(-1, 0, { id: aspectId, completed: { success: false } });
  const result = runEvents(events);
  assert.equal(result.value.finding, "supported");
  assert.equal(evidence(result, "bep-target-result").observed_value.includes("aspect_isolated_count=1"), true);
  assert.deepEqual(result.value.capture.adapter_warnings, []);

  const aspectOnly = baseEvents();
  aspectOnly.splice(1, 2);
  aspectOnly[0].children = [aspectId, { buildFinished: {} }];
  aspectOnly.splice(1, 0, { id: aspectId, completed: { success: true } });
  const onlyResult = runEvents(aspectOnly);
  assert.equal(evidence(onlyResult, "bep-target-result").state, "absent");
  assert.equal(evidence(onlyResult, "bep-artifact-record").state, "absent");
  assert.deepEqual(onlyResult.value.capture.adapter_warnings, []);

  const aspectSetOnly = baseEvents();
  const selectedSet = { namedSet: { id: "set-summary" } };
  aspectSetOnly.splice(1, 1);
  aspectSetOnly[0].children = [aspectId, { buildFinished: {} }];
  aspectSetOnly.splice(1, 0, {
    id: aspectId,
    children: [selectedSet],
    completed: {
      success: true,
      outputGroup: [{ name: "default", fileSets: [{ id: "set-summary" }] }],
    },
  });
  const aspectSetOnlyResult = runEvents(aspectSetOnly);
  assert.equal(evidence(aspectSetOnlyResult, "bep-target-result").state, "absent");
  assert.equal(evidence(aspectSetOnlyResult, "bep-artifact-record").state, "absent");
  assert.deepEqual(aspectSetOnlyResult.value.capture.adapter_warnings, []);

  const conflictingAspect = baseEvents();
  const conflictSetId = { namedSet: { id: "set-aspect-conflict" } };
  conflictingAspect[0].children.push(aspectId);
  conflictingAspect.splice(-1, 0, {
    id: aspectId,
    children: [conflictSetId],
    completed: {
      success: false,
      outputGroup: [{ name: "default", fileSets: [{ id: "set-aspect-conflict" }] }],
    },
  }, {
    id: conflictSetId,
    namedSetOfFiles: {
      files: [{
        pathPrefix: ["bazel-out", "k8-fastbuild", "bin", "reports"],
        name: "summary.json",
        digest: "b".repeat(64),
        length: "184",
        uri: "file:///synthetic/aspect-conflict/summary.json",
      }],
    },
  });
  const conflictingAspectResult = runEvents(conflictingAspect);
  assert.equal(evidence(conflictingAspectResult, "bep-target-result").state, "supports");
  assert.equal(evidence(conflictingAspectResult, "bep-artifact-record").state, "supports");
  assert.deepEqual(conflictingAspectResult.value.capture.adapter_warnings, []);

  const sharedSet = baseEvents();
  sharedSet[0].children.push(aspectId);
  sharedSet.splice(-1, 0, {
    id: aspectId,
    children: [selectedSet],
    completed: {
      success: true,
      outputGroup: [{ name: "default", fileSets: [{ id: "set-summary" }] }],
    },
  });
  const sharedSetResult = runEvents(sharedSet);
  assert.equal(sharedSetResult.value.finding, "supported");
  assert.equal(evidence(sharedSetResult, "bep-artifact-record").state, "supports");
  assert.deepEqual(sharedSetResult.value.capture.adapter_warnings, []);
});

test("ProtoJSON scalar and repeated defaults preserve the frozen mapping", () => {
  const omittedSuccess = baseEvents();
  delete omittedSuccess[1].completed.success;
  assert.equal(evidence(runEvents(omittedSuccess), "bep-target-result").state, "contradictory");

  const omittedCode = baseEvents();
  delete omittedCode[3].finished.exitCode.code;
  assert.equal(evidence(runEvents(omittedCode), "bep-build-terminal").state, "supports");

  const missingTimestamp = baseEvents();
  delete missingTimestamp[3].finished.finishTime;
  const missingTimestampResult = runEvents(missingTimestamp);
  assert.equal(evidence(missingTimestampResult, "bep-build-terminal").state, "unknown");
  assert.equal(missingTimestampResult.value.capture.adapter_warnings.includes("terminal_fields_missing"), true);

  const omittedArrays = baseEvents();
  delete omittedArrays[1].completed.outputGroup;
  delete omittedArrays[1].completed.directoryOutput;
  delete omittedArrays[1].completed.importantOutput;
  const omittedArraysResult = runEvents(omittedArrays);
  assert.equal(evidence(omittedArraysResult, "bep-target-result").state, "absent");
  assert.equal(evidence(omittedArraysResult, "bep-artifact-record").state, "absent");

  const explicitNull = baseEvents();
  explicitNull[1].completed.success = null;
  assertError(runEvents(explicitNull), "source-json", "event_explicit_null");
});

test("explicit null is rejected at every request and relied source location", () => {
  const validSource = jsonl(baseEvents());
  const requestCases = [
    ["/request", null],
    ["/request/schema_version", (request) => { request.schema_version = null; }],
    ["/request/claim_id", (request) => { request.claim_id = null; }],
    ["/request/source", (request) => { request.source = null; }],
    ["/request/source/format", (request) => { request.source.format = null; }],
    ["/request/source/version", (request) => { request.source.version = null; }],
    ["/request/source/sha256", (request) => { request.source.sha256 = null; }],
    ["/request/selection", (request) => { request.selection = null; }],
    ["/request/selection/build_uuid", (request) => { request.selection.build_uuid = null; }],
    ["/request/selection/target_label", (request) => { request.selection.target_label = null; }],
    ["/request/selection/configuration_id", (request) => { request.selection.configuration_id = null; }],
    ["/request/selection/output_group", (request) => { request.selection.output_group = null; }],
    ["/request/selection/artifact", (request) => { request.selection.artifact = null; }],
    ["/request/selection/artifact/label", (request) => { request.selection.artifact.label = null; }],
    ["/request/selection/artifact/path_prefix", (request) => { request.selection.artifact.path_prefix = null; }],
    ["/request/selection/artifact/path_prefix/0", (request) => { request.selection.artifact.path_prefix[0] = null; }],
    ["/request/selection/artifact/name", (request) => { request.selection.artifact.name = null; }],
    ["/request/selection/artifact/digest", (request) => { request.selection.artifact.digest = null; }],
    ["/request/selection/artifact/length", (request) => { request.selection.artifact.length = null; }],
  ];
  for (const [path, mutate] of requestCases) {
    let requestBytes;
    if (mutate === null) requestBytes = Buffer.from("null", "utf8");
    else {
      const request = requestFor(validSource);
      mutate(request);
      requestBytes = Buffer.from(JSON.stringify(request), "utf8");
    }
    const result = adaptBazelBepArtifactCreated(requestBytes, validSource);
    assert.equal(result.value.stage, "request", path);
    assert.equal(result.exitCode, 2, path);
    assert.equal(result.coreInvoked, false, path);
    assert.equal(Object.hasOwn(result.value, "source_sha256"), false, path);
    assert.deepEqual(result.value.errors.filter((entry) => entry.code === "request_explicit_null" && entry.path === path),
      [issue("request_explicit_null", path)], path);
  }

  const sourceCases = [
    ["/events/0/id", (events) => { events[0].id = null; }],
    ["/events/1/id/targetCompleted/label", (events) => { events[1].id.targetCompleted.label = null; }],
    ["/events/1/id/targetCompleted/aspect", (events) => { events[1].id.targetCompleted.aspect = null; }],
    ["/events/1/id/targetCompleted/configuration", (events) => { events[1].id.targetCompleted.configuration = null; }],
    ["/events/1/id/targetCompleted/configuration/id", (events) => { events[1].id.targetCompleted.configuration.id = null; }],
    ["/events/0/children", (events) => { events[0].children = null; }],
    ["/events/0/children/0", (events) => { events[0].children[0] = null; }],
    ["/events/0/children/0/targetCompleted/label", (events) => { events[0].children[0].targetCompleted.label = null; }],
    ["/events/3/lastMessage", (events) => { events[3].lastMessage = null; }, "last_message_wrong_type"],
    ["/events/0/started", (events) => { events[0].started = null; }],
    ["/events/0/started/uuid", (events) => { events[0].started.uuid = null; }],
    ["/events/0/started/buildToolVersion", (events) => { events[0].started.buildToolVersion = null; }],
    ["/events/0/started/command", (events) => { events[0].started.command = null; }],
    ["/events/1/completed", (events) => { events[1].completed = null; }],
    ["/events/1/completed/success", (events) => { events[1].completed.success = null; }],
    ["/events/1/completed/outputGroup", (events) => { events[1].completed.outputGroup = null; }],
    ["/events/1/completed/outputGroup/0", (events) => { events[1].completed.outputGroup[0] = null; }],
    ["/events/1/completed/outputGroup/0/name", (events) => { events[1].completed.outputGroup[0].name = null; }],
    ["/events/1/completed/outputGroup/0/incomplete", (events) => { events[1].completed.outputGroup[0].incomplete = null; }],
    ["/events/1/completed/outputGroup/0/fileSets", (events) => { events[1].completed.outputGroup[0].fileSets = null; }],
    ["/events/1/completed/outputGroup/0/fileSets/0", (events) => { events[1].completed.outputGroup[0].fileSets[0] = null; }],
    ["/events/1/completed/outputGroup/0/fileSets/0/id", (events) => { events[1].completed.outputGroup[0].fileSets[0].id = null; }],
    ["/events/1/completed/outputGroup/0/inlineFiles", (events) => { events[1].completed.outputGroup[0].inlineFiles = null; }],
    ["/events/1/completed/directoryOutput", (events) => { events[1].completed.directoryOutput = null; }],
    ["/events/1/completed/directoryOutput/0", (events) => { events[1].completed.directoryOutput = [null]; }],
    ["/events/1/completed/importantOutput", (events) => { events[1].completed.importantOutput = null; }],
    ["/events/2/namedSetOfFiles", (events) => { events[2].namedSetOfFiles = null; }],
    ["/events/2/namedSetOfFiles/files", (events) => { events[2].namedSetOfFiles.files = null; }],
    ["/events/2/namedSetOfFiles/files/0", (events) => { events[2].namedSetOfFiles.files[0] = null; }],
    ["/events/2/namedSetOfFiles/files/0/pathPrefix", (events) => { events[2].namedSetOfFiles.files[0].pathPrefix = null; }],
    ["/events/2/namedSetOfFiles/files/0/pathPrefix/0", (events) => { events[2].namedSetOfFiles.files[0].pathPrefix[0] = null; }],
    ["/events/2/namedSetOfFiles/files/0/name", (events) => { events[2].namedSetOfFiles.files[0].name = null; }],
    ["/events/2/namedSetOfFiles/files/0/digest", (events) => { events[2].namedSetOfFiles.files[0].digest = null; }],
    ["/events/2/namedSetOfFiles/files/0/length", (events) => { events[2].namedSetOfFiles.files[0].length = null; }],
    ["/events/2/namedSetOfFiles/files/0/uri", (events) => { events[2].namedSetOfFiles.files[0].uri = null; }],
    ["/events/2/namedSetOfFiles/files/0/contents", (events) => {
      delete events[2].namedSetOfFiles.files[0].uri;
      events[2].namedSetOfFiles.files[0].contents = null;
    }],
    ["/events/2/namedSetOfFiles/files/0/symlinkTargetPath", (events) => {
      delete events[2].namedSetOfFiles.files[0].uri;
      events[2].namedSetOfFiles.files[0].symlinkTargetPath = null;
    }],
    ["/events/2/namedSetOfFiles/fileSets", (events) => { events[2].namedSetOfFiles.fileSets = null; }],
    ["/events/2/namedSetOfFiles/fileSets/0", (events) => { events[2].namedSetOfFiles.fileSets = [null]; }],
    ["/events/3/finished", (events) => { events[3].finished = null; }],
    ["/events/3/finished/exitCode", (events) => { events[3].finished.exitCode = null; }],
    ["/events/3/finished/exitCode/code", (events) => { events[3].finished.exitCode.code = null; }],
    ["/events/3/finished/exitCode/name", (events) => { events[3].finished.exitCode.name = null; }],
    ["/events/3/finished/finishTime", (events) => { events[3].finished.finishTime = null; }],
    ["/events/1/aborted/reason", (events) => {
      delete events[1].completed;
      events[1].aborted = { reason: null };
    }],
    ["/events/1/aborted/description", (events) => {
      delete events[1].completed;
      events[1].aborted = { description: null };
    }],
  ];
  for (const [path, mutate, code = "event_explicit_null"] of sourceCases) {
    const events = baseEvents();
    mutate(events);
    const source = jsonl(events);
    const result = runBytes(source);
    assert.equal(result.value.stage, "source-json", path);
    assert.equal(result.exitCode, 2, path);
    assert.equal(result.coreInvoked, false, path);
    assert.equal(result.value.source_sha256, sha256(source), path);
    assert.deepEqual(result.value.errors.filter((entry) => entry.code === code && entry.path === path), [issue(code, path)], path);
    assert.equal(Object.hasOwn(result.value, "finding"), false, path);
  }
});

test("protobuf timestamps cover the full canonical year and calendar range", () => {
  const accepted = [
    "0001-01-01T00:00:00Z",
    "0004-02-29T00:00:00Z",
    "0099-12-31T23:59:59.1Z",
    "0100-02-28T12:34:56Z",
    "2000-02-29T12:34:56.123456789Z",
    "9999-12-31T23:59:59.123456789Z",
  ];
  for (const timestamp of accepted) {
    const events = baseEvents();
    events[3].finished.finishTime = timestamp;
    const result = runEvents(events);
    assert.equal(result.accepted, true, `${timestamp}: ${result.output}`);
    assert.equal(evidence(result, "bep-build-terminal").state, "supports", timestamp);
    assert.equal(evidence(result, "bep-build-terminal").observed_value.endsWith(`finish_time=${timestamp}`), true, timestamp);
  }

  const rejected = [
    "0000-01-01T00:00:00Z",
    "0099-02-29T00:00:00Z",
    "0100-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2000-02-30T00:00:00Z",
    "9999-13-01T00:00:00Z",
    "9999-00-01T00:00:00Z",
    "9999-01-00T00:00:00Z",
    "9999-01-01T24:00:00Z",
    "9999-01-01T00:60:00Z",
    "9999-01-01T00:00:60Z",
    "9999-01-01T00:00:00.Z",
    "9999-01-01T00:00:00.1234567890Z",
    "9999-01-01T00:00:00+00:00",
    "10000-01-01T00:00:00Z",
  ];
  for (const timestamp of rejected) {
    const events = baseEvents();
    events[3].finished.finishTime = timestamp;
    const source = jsonl(events);
    assertExactError(runBytes(source), {
      stage: "source-json",
      sourceBytes: source,
      errors: [issue("timestamp_invalid", "/events/3/finished/finishTime")],
    });
  }
});

test("terminal contradiction precedence independently preserves missing-field warnings", () => {
  const missingExitCode = baseEvents();
  delete missingExitCode[3].finished.exitCode;
  const missingExitCodeResult = runEvents(missingExitCode);
  assert.equal(evidence(missingExitCodeResult, "bep-build-terminal").state, "unknown");
  assert.deepEqual(missingExitCodeResult.value.capture.adapter_warnings, ["terminal_fields_missing"]);

  const failedWithoutTime = baseEvents();
  failedWithoutTime[3].finished.exitCode = { code: 1, name: "BUILD_FAILURE" };
  delete failedWithoutTime[3].finished.finishTime;
  const failedWithoutTimeResult = runEvents(failedWithoutTime);
  assert.equal(failedWithoutTimeResult.value.finding, "contradicted");
  assert.equal(evidence(failedWithoutTimeResult, "bep-build-terminal").state, "contradictory");
  assert.equal(evidence(failedWithoutTimeResult, "bep-build-terminal").observed_value,
    "exit_code=1; exit_name=BUILD_FAILURE; finish_time=missing");
  assert.deepEqual(failedWithoutTimeResult.value.capture.adapter_warnings, ["terminal_fields_missing"]);
});

test("omitted and explicit ProtoJSON defaults are equivalent without inventing positive evidence", () => {
  const states = (result) => result.value.evidence_results.map(({ state }) => state);

  const rootOmitted = [{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, lastMessage: true }];
  const rootExplicit = structuredClone(rootOmitted);
  rootExplicit[0].children = [];
  assert.deepEqual(states(runEvents(rootExplicit)), states(runEvents(rootOmitted)));

  const groupsOmitted = baseEvents();
  delete groupsOmitted[1].completed.outputGroup;
  const groupsExplicit = baseEvents();
  groupsExplicit[1].completed.outputGroup = [];
  assert.deepEqual(states(runEvents(groupsExplicit)), states(runEvents(groupsOmitted)));

  const fileSetsOmitted = baseEvents();
  delete fileSetsOmitted[1].completed.outputGroup[0].fileSets;
  const fileSetsExplicit = baseEvents();
  fileSetsExplicit[1].completed.outputGroup[0].fileSets = [];
  assert.deepEqual(states(runEvents(fileSetsExplicit)), states(runEvents(fileSetsOmitted)));

  const namedArraysOmitted = baseEvents();
  delete namedArraysOmitted[2].namedSetOfFiles.files;
  delete namedArraysOmitted[2].namedSetOfFiles.fileSets;
  const namedArraysExplicit = baseEvents();
  namedArraysExplicit[2].namedSetOfFiles.files = [];
  namedArraysExplicit[2].namedSetOfFiles.fileSets = [];
  assert.deepEqual(states(runEvents(namedArraysExplicit)), states(runEvents(namedArraysOmitted)));

  const emptyOutputDefaults = baseEvents();
  emptyOutputDefaults[1].completed.outputGroup[0].inlineFiles = [];
  emptyOutputDefaults[1].completed.directoryOutput = [];
  emptyOutputDefaults[1].completed.importantOutput = [];
  emptyOutputDefaults[2].namedSetOfFiles.fileSets = [];
  assert.deepEqual(states(runEvents(emptyOutputDefaults)), states(runEvents(baseEvents())));
  assert.deepEqual(runEvents(emptyOutputDefaults).value.capture.adapter_warnings, []);

  const incompleteOmitted = baseEvents();
  delete incompleteOmitted[1].completed.outputGroup[0].incomplete;
  const incompleteFalse = baseEvents();
  incompleteFalse[1].completed.outputGroup[0].incomplete = false;
  assert.equal(evidence(runEvents(incompleteOmitted), "bep-target-result").observed_value,
    evidence(runEvents(incompleteFalse), "bep-target-result").observed_value);

  const codeOmitted = baseEvents();
  delete codeOmitted[3].finished.exitCode.code;
  const codeZero = baseEvents();
  codeZero[3].finished.exitCode.code = 0;
  assert.equal(evidence(runEvents(codeOmitted), "bep-build-terminal").observed_value,
    evidence(runEvents(codeZero), "bep-build-terminal").observed_value);

  const nameOmitted = baseEvents();
  delete nameOmitted[3].finished.exitCode.name;
  const nameEmpty = baseEvents();
  nameEmpty[3].finished.exitCode.name = "";
  assert.equal(evidence(runEvents(nameOmitted), "bep-build-terminal").observed_value,
    evidence(runEvents(nameEmpty), "bep-build-terminal").observed_value);

  const missingUuid = baseEvents();
  delete missingUuid[0].started.uuid;
  assert.notEqual(evidence(runEvents(missingUuid), "bep-invocation-identity").state, "supports");
  const missingGroupName = baseEvents();
  delete missingGroupName[1].completed.outputGroup[0].name;
  assert.notEqual(evidence(runEvents(missingGroupName), "bep-target-result").state, "supports");
  const missingFileName = baseEvents();
  delete missingFileName[2].namedSetOfFiles.files[0].name;
  assert.notEqual(evidence(runEvents(missingFileName), "bep-artifact-record").state, "supports");
  const missingUri = baseEvents();
  delete missingUri[2].namedSetOfFiles.files[0].uri;
  const missingUriResult = runEvents(missingUri);
  assert.equal(evidence(missingUriResult, "bep-artifact-record").state, "unknown");
  assert.equal(missingUriResult.value.capture.adapter_warnings.includes("selected_artifact_metadata_missing"), true);
});

test("zero-length handling accepts only the frozen canonical ProtoJSON string form", () => {
  const omitted = baseEvents();
  delete omitted[2].namedSetOfFiles.files[0].length;
  const zero = runEvents(omitted, (request) => { request.selection.artifact.length = "0"; });
  assert.equal(evidence(zero, "bep-artifact-record").state, "supports");
  const one = runEvents(omitted, (request) => { request.selection.artifact.length = "1"; });
  assert.equal(evidence(one, "bep-artifact-record").state, "contradictory");

  const explicit = baseEvents();
  explicit[2].namedSetOfFiles.files[0].length = "0";
  assert.equal(evidence(runEvents(explicit, (request) => { request.selection.artifact.length = "0"; }), "bep-artifact-record").state, "supports");
  for (const value of [0, "00", "+0", "0.0", "0e0"]) {
    const events = baseEvents();
    events[2].namedSetOfFiles.files[0].length = value;
    assertError(runEvents(events), "source-json", "int64_invalid");
  }
});

test("valid unsupported file and output forms map to unknown with exact ordered warnings", () => {
  const cases = [
    ["unsupported_selected_file_form_contents", (events) => {
      const file = events[2].namedSetOfFiles.files[0];
      delete file.uri;
      file.contents = "c3ludGhldGlj";
    }],
    ["unsupported_selected_file_form_symlink", (events) => {
      const file = events[2].namedSetOfFiles.files[0];
      delete file.uri;
      file.symlinkTargetPath = "synthetic-target";
    }],
    ["unsupported_selected_inline_files", (events) => {
      events[1].completed.outputGroup[0].inlineFiles = [{
        pathPrefix: ["bazel-out", "k8-fastbuild", "bin", "reports"],
        name: "summary.json", digest: "a".repeat(64), length: "184", uri: "file:///inline",
      }];
    }],
    ["unsupported_selected_directory_output", (events) => {
      events[1].completed.directoryOutput = [{
        pathPrefix: ["bazel-out", "k8-fastbuild", "bin", "reports"],
        name: "summary.json", digest: "a".repeat(64), length: "184", uri: "file:///directory",
      }];
    }],
  ];
  for (const [warning, mutate] of cases) {
    const events = baseEvents();
    mutate(events);
    const result = runEvents(events);
    assert.equal(evidence(result, "bep-artifact-record").state, "unknown", warning);
    assert.equal(result.value.capture.adapter_warnings.includes(warning), true, warning);
    assert.equal(result.value.finding, "insufficient_evidence", warning);
  }

  const importantOnly = baseEvents();
  importantOnly[1].completed.importantOutput = [structuredClone(importantOnly[2].namedSetOfFiles.files[0])];
  importantOnly[1].completed.outputGroup[0].fileSets = [];
  importantOnly[1].children = [];
  importantOnly.splice(2, 1);
  const result = runEvents(importantOnly);
  assert.equal(evidence(result, "bep-artifact-record").state, "absent");
  assert.equal(result.value.capture.adapter_warnings.some((item) => item.includes("important")), false);
});

test("artifact matching preserves absence, canonical digest, deduplication, conflict, and ambiguity", () => {
  const absent = baseEvents();
  absent[2].namedSetOfFiles.files[0].name = "other.json";
  assert.equal(evidence(runEvents(absent), "bep-artifact-record").state, "absent");

  const uppercase = baseEvents();
  uppercase[2].namedSetOfFiles.files[0].digest = "A".repeat(64);
  const upperResult = runEvents(uppercase);
  assert.equal(evidence(upperResult, "bep-artifact-record").state, "supports");
  assert.equal(evidence(upperResult, "bep-artifact-record").observed_value.includes(`configured_digest=${"a".repeat(64)}`), true);

  const duplicate = baseEvents();
  duplicate[2].namedSetOfFiles.files.push(structuredClone(duplicate[2].namedSetOfFiles.files[0]));
  const duplicateResult = runEvents(duplicate);
  assert.equal(evidence(duplicateResult, "bep-artifact-record").state, "supports");
  assert.equal(duplicateResult.value.capture.adapter_warnings.includes("selected_mapping_ambiguous"), false);

  const ambiguous = baseEvents();
  const second = structuredClone(ambiguous[2].namedSetOfFiles.files[0]);
  second.uri = "file:///synthetic/second/summary.json";
  ambiguous[2].namedSetOfFiles.files.push(second);
  const ambiguousResult = runEvents(ambiguous);
  assert.equal(evidence(ambiguousResult, "bep-artifact-record").state, "unknown");
  assert.equal(ambiguousResult.value.capture.adapter_warnings.includes("selected_mapping_ambiguous"), true);

  const conflict = baseEvents();
  const conflicting = structuredClone(conflict[2].namedSetOfFiles.files[0]);
  conflicting.digest = "b".repeat(64);
  conflict[2].namedSetOfFiles.files.push(conflicting);
  const conflictResult = runEvents(conflict);
  assert.equal(evidence(conflictResult, "bep-artifact-record").state, "contradictory");
  assert.equal(conflictResult.value.capture.adapter_warnings.includes("selected_mapping_ambiguous"), true);

  const missingDigestConflict = baseEvents();
  missingDigestConflict[2].namedSetOfFiles.files[0].digest = "";
  missingDigestConflict[2].namedSetOfFiles.files[0].length = "183";
  assert.equal(evidence(runEvents(missingDigestConflict), "bep-artifact-record").state, "contradictory");

  const missingMetadata = baseEvents();
  missingMetadata[2].namedSetOfFiles.files[0].digest = "";
  const metadataResult = runEvents(missingMetadata);
  assert.equal(evidence(metadataResult, "bep-artifact-record").state, "unknown");
  assert.equal(metadataResult.value.capture.adapter_warnings.includes("selected_artifact_metadata_missing"), true);
});

test("selected group and named-set uncertainty remains explicit and warning order is frozen", () => {
  const duplicateGroup = baseEvents();
  duplicateGroup[1].completed.outputGroup.push(structuredClone(duplicateGroup[1].completed.outputGroup[0]));
  const duplicateGroupResult = runEvents(duplicateGroup);
  assert.equal(evidence(duplicateGroupResult, "bep-target-result").state, "supports");
  assert.equal(evidence(duplicateGroupResult, "bep-artifact-record").state, "supports");
  assert.equal(duplicateGroupResult.value.capture.adapter_warnings.includes("selected_mapping_ambiguous"), false);

  const distinctGroups = baseEvents();
  const secondGroup = structuredClone(distinctGroups[1].completed.outputGroup[0]);
  secondGroup.inlineFiles = [];
  distinctGroups[1].completed.outputGroup.push(secondGroup);
  const distinctGroupsResult = runEvents(distinctGroups);
  assert.equal(evidence(distinctGroupsResult, "bep-target-result").state, "unknown");
  assert.equal(evidence(distinctGroupsResult, "bep-artifact-record").state, "unknown");
  assert.equal(distinctGroupsResult.value.capture.adapter_warnings.includes("selected_mapping_ambiguous"), true);

  const incomplete = baseEvents();
  incomplete[1].completed.outputGroup[0].incomplete = true;
  const incompleteResult = runEvents(incomplete);
  assert.equal(evidence(incompleteResult, "bep-target-result").state, "unknown");
  assert.equal(evidence(incompleteResult, "bep-artifact-record").state, "unknown");
  assert.equal(incompleteResult.value.capture.adapter_warnings.includes("selected_output_group_incomplete"), true);

  const unresolved = baseEvents();
  unresolved[1].completed.outputGroup[0].fileSets.push({ id: "unposted-set" });
  const unresolvedResult = runEvents(unresolved);
  assert.equal(evidence(unresolvedResult, "bep-artifact-record").state, "unknown");
  assert.equal(unresolvedResult.value.capture.adapter_warnings.includes("selected_named_set_unresolved"), true);

  const manyWarnings = baseEvents();
  delete manyWarnings.at(-1).lastMessage;
  manyWarnings[1].completed.outputGroup[0].incomplete = true;
  manyWarnings[1].completed.outputGroup[0].fileSets.push({ id: "unposted-set" });
  manyWarnings[1].completed.outputGroup[0].inlineFiles = [{ contents: "" }];
  manyWarnings[1].completed.directoryOutput = [{}];
  const warningResult = runEvents(manyWarnings);
  assert.deepEqual(warningResult.value.capture.adapter_warnings, [
    "missing_last_message",
    "selected_output_group_incomplete",
    "selected_named_set_unresolved",
    "unsupported_selected_inline_files",
    "unsupported_selected_directory_output",
  ]);

  const membershipCycle = baseEvents();
  const secondSetId = { namedSet: { id: "set-second" } };
  membershipCycle[0].children.push(secondSetId);
  membershipCycle[2].namedSetOfFiles.fileSets = [{ id: "set-second" }];
  membershipCycle.splice(-1, 0, {
    id: secondSetId,
    namedSetOfFiles: { fileSets: [{ id: "set-summary" }] },
  });
  const cycleResult = runEvents(membershipCycle);
  assert.equal(cycleResult.accepted, true, cycleResult.output);
  assert.equal(evidence(cycleResult, "bep-artifact-record").state, "unknown");
  assert.equal(cycleResult.value.capture.adapter_warnings.includes("selected_named_set_unresolved"), true);

  const allWarnings = baseEvents();
  const targetId = allWarnings[0].children[0];
  const finishId = allWarnings[0].children[1];
  const setId = allWarnings[1].children[0];
  const abortedSetId = { namedSet: { id: "set-aborted" } };
  const missingGraphId = { progress: { opaqueCount: 99 } };
  allWarnings[0].children = [targetId, finishId, setId, abortedSetId, missingGraphId];
  const firstGroup = allWarnings[1].completed.outputGroup[0];
  firstGroup.incomplete = true;
  firstGroup.fileSets.push({ id: "set-aborted" }, { id: "set-unposted" });
  firstGroup.inlineFiles = [{ contents: "" }];
  const allWarningsSecondGroup = structuredClone(firstGroup);
  allWarningsSecondGroup.inlineFiles = [];
  allWarnings[1].completed.outputGroup.push(allWarningsSecondGroup);
  allWarnings[1].completed.directoryOutput = [{}];
  const ordinary = allWarnings[2].namedSetOfFiles.files[0];
  ordinary.digest = "";
  ordinary.uri = "";
  const contents = structuredClone(ordinary);
  delete contents.uri;
  contents.digest = "a".repeat(64);
  contents.contents = "c3ludGhldGlj";
  const symlink = structuredClone(ordinary);
  delete symlink.uri;
  symlink.digest = "a".repeat(64);
  symlink.symlinkTargetPath = "synthetic-target";
  allWarnings[2].namedSetOfFiles.files.push(contents, symlink);
  allWarnings.splice(-1, 0, { id: abortedSetId, aborted: { reason: "INCOMPLETE" } });
  delete allWarnings.at(-1).lastMessage;
  delete allWarnings.at(-1).finished.finishTime;
  const allWarningsResult = runEvents(allWarnings);
  assert.equal(allWarningsResult.accepted, true, allWarningsResult.output);
  assert.deepEqual(allWarningsResult.value.capture.adapter_warnings, [
    "missing_last_message",
    "missing_announced_events",
    "selected_output_group_incomplete",
    "selected_named_set_unresolved",
    "selected_named_set_aborted",
    "selected_mapping_ambiguous",
    "selected_artifact_metadata_missing",
    "terminal_fields_missing",
    "unsupported_selected_file_form_contents",
    "unsupported_selected_file_form_symlink",
    "unsupported_selected_inline_files",
    "unsupported_selected_directory_output",
  ]);
});

test("receipt-local safety removes raw paths, URIs, inline bytes, symlink targets, caller paths, and descriptions", async () => {
  for (const name of ["supported-complete", "contradicted-digest"]) {
    const directory = join(FIXTURE_ROOT, name);
    const requestPath = join(directory, "request.json");
    const sourcePath = join(directory, "events.bep.jsonl");
    const result = await runBazelBepArtifactCreatedCli([requestPath, sourcePath]);
    const output = result.output;
    assert.equal(output.includes("summary-output"), true);
    assert.equal(output.includes("0caa130c31943bcadfab81a94bc4a672604d45bff11949e835e7098a1c6041b8"), true);
    for (const forbidden of [
      "bazel-out/k8-fastbuild/bin/reports/summary.json",
      "file:///synthetic/output/summary.json",
      requestPath,
      sourcePath,
      "synthetic-target",
      "never-emit-aborted-description",
    ]) assert.equal(output.includes(forbidden), false, forbidden);
    for (const item of result.value.evidence_results) {
      assert.match(item.source_ref, /^bep-capture#(?:stream|events:\d+(?:,\d+)*)$/);
    }
  }
});

test("mapping, core, and internal failures use their exact fail-closed envelopes without retry or nested errors", () => {
  const source = jsonl(baseEvents());
  const mapping = runBytes(source, () => {}, { forceMappingInvariantFailure: true });
  assertError(mapping, "mapping", "mapping_invariant_failed");
  assert.equal(mapping.value.source_sha256, sha256(source));

  let calls = 0;
  const core = runBytes(source, () => {}, {
    coreEvaluator: () => {
      calls += 1;
      return { accepted: false, value: { private: "must not escape" } };
    },
  });
  assertError(core, "core", "core_rejected_generated_input", 1);
  assert.equal(core.coreInvoked, true);
  assert.equal(calls, 2);
  assert.equal(core.output.includes("private"), false);

  const internal = runBytes(source, () => {}, { forceInternalFailure: true });
  assertError(internal, "internal", "internal_adapter_failure", 1);
  assert.equal(internal.value.source_sha256, sha256(source));
});

test("every frozen adapter error code has an exact deterministic envelope", async () => {
  const seen = new Set();
  const check = (result, options) => {
    assertExactError(result, options);
    options.errors.forEach(({ code }) => seen.add(code));
  };
  const validSource = jsonl(baseEvents());
  const validRequest = requestFor(validSource);
  const requestBytes = (mutate) => {
    const request = structuredClone(validRequest);
    mutate(request);
    return Buffer.from(JSON.stringify(request), "utf8");
  };

  check(await runBazelBepArtifactCreatedCli([join(ROOT, "missing-request.json"), join(ROOT, "missing-source.json")]), {
    stage: "request", exitCode: 1, errors: [issue("request_unreadable", "/request")],
  });
  check(adaptBazelBepArtifactCreated(Buffer.alloc(65_537, 0x20), validSource), {
    stage: "request", errors: [issue("request_too_large", "/request")],
  });
  check(adaptBazelBepArtifactCreated(Buffer.from([0xff]), validSource), {
    stage: "request", errors: [issue("request_invalid_utf8", "/request")],
  });
  let depthProbe = "leaf";
  for (let index = 0; index < 16; index += 1) depthProbe = [depthProbe];
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { request.depthProbe = depthProbe; }), validSource), {
    stage: "request", errors: [issue("request_depth_exceeded", "/request")],
  });
  check(adaptBazelBepArtifactCreated(Buffer.from("{", "utf8"), validSource), {
    stage: "request", errors: [issue("request_malformed_json", "/request")],
  });
  const duplicateRequest = Buffer.from(JSON.stringify(validRequest).replace('"claim_id":', '"claim_id":"duplicate","claim_id":'), "utf8");
  check(adaptBazelBepArtifactCreated(duplicateRequest, validSource), {
    stage: "request", errors: [issue("request_duplicate_key", "/request/claim_id")],
  });
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { request.claim_id = null; }), validSource), {
    stage: "request", errors: [issue("request_explicit_null", "/request/claim_id")],
  });
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { request.extra = true; }), validSource), {
    stage: "request", errors: [issue("request_unknown_field", "/request/extra")],
  });
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { delete request.claim_id; }), validSource), {
    stage: "request", errors: [issue("request_missing_field", "/request/claim_id")],
  });
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { request.claim_id = 4; }), validSource), {
    stage: "request", errors: [issue("request_wrong_type", "/request/claim_id")],
  });
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { request.claim_id = "Cafe\u0301"; }), validSource), {
    stage: "request", errors: [issue("request_non_nfc", "/request/claim_id")],
  });
  check(adaptBazelBepArtifactCreated(requestBytes((request) => { request.schema_version = "v2"; }), validSource), {
    stage: "request", errors: [issue("request_invalid_value", "/request/schema_version")],
  });

  const fixtureDirectory = join(FIXTURE_ROOT, "supported-complete");
  check(await runBazelBepArtifactCreatedCli([join(fixtureDirectory, "request.json"), join(ROOT, "missing-events.bep.jsonl")]), {
    stage: "source-read", exitCode: 1, errors: [issue("source_unreadable", "/source")],
  });
  const hugeSource = Buffer.alloc(8_388_609, 0x20);
  check(adaptBazelBepArtifactCreated(Buffer.from(JSON.stringify(requestFor(hugeSource))), hugeSource), {
    stage: "source-read", errors: [issue("source_too_large", "/source")],
  });
  check(runBytes(validSource, (request) => { request.source.sha256 = "0".repeat(64); }), {
    stage: "source-integrity", sourceBytes: validSource, errors: [issue("source_sha256_mismatch", "/source")],
  });
  const invalidUtf8 = Buffer.from([0xff]);
  check(runBytes(invalidUtf8), {
    stage: "source-integrity", sourceBytes: invalidUtf8, errors: [issue("source_invalid_utf8", "/source")],
  });
  const emptySource = Buffer.from(" \n\r\n", "utf8");
  check(runBytes(emptySource), {
    stage: "source-integrity", sourceBytes: emptySource, errors: [issue("source_empty", "/source")],
  });
  const manySource = Buffer.from(`${Array.from({ length: 10_001 }, () => "{}").join("\n")}\n`, "utf8");
  check(runBytes(manySource), {
    stage: "source-integrity", sourceBytes: manySource, errors: [issue("source_too_many_events", "/source")],
  });

  const sourceJsonCases = [
    [Buffer.from('{"id":\n', "utf8"), [issue("event_malformed_json", "/events/0")]],
    [Buffer.from('{"id":{"started":{}},"id":{"started":{}},"started":{"buildToolVersion":"8.7.0"}}\n', "utf8"), [
      issue("event_duplicate_key", "/events/0/id"),
    ]],
    [jsonl([{ id: null, started: { buildToolVersion: "8.7.0" } }]), [issue("event_explicit_null", "/events/0/id")]],
    [Buffer.from("4\n", "utf8"), [issue("event_top_level_wrong_type", "/events/0")]],
    [jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, extra: true }]), [
      issue("unknown_event_field", "/events/0"),
    ]],
    [jsonl([{ id: { started: {} }, started: { uuid: "Cafe\u0301", buildToolVersion: "8.7.0" } }]), [
      issue("event_non_nfc", "/events/0/started/uuid"),
    ]],
    [jsonl([{ started: { buildToolVersion: "8.7.0" } }]), [issue("event_missing_id", "/events/0/id")]],
    [jsonl([{ id: {}, progress: {} }]), [issue("event_id_invalid", "/events/0/id")]],
    [jsonl([{ id: { started: {} }, children: {}, started: { buildToolVersion: "8.7.0" } }]), [
      issue("event_children_wrong_type", "/events/0/children"),
    ]],
    [jsonl([{ id: { started: {} }, children: [{}], started: { buildToolVersion: "8.7.0" } }]), [
      issue("event_child_id_invalid", "/events/0/children/0"),
    ]],
    [jsonl([{ id: { started: {} }, lastMessage: "true", started: { buildToolVersion: "8.7.0" } }]), [
      issue("last_message_wrong_type", "/events/0/lastMessage"),
    ]],
    [jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, aborted: {} }]), [
      issue("payload_oneof_multiple", "/events/0"),
    ]],
    [jsonl([{ id: { started: {} }, started: "bad" }]), [issue("payload_wrong_type", "/events/0/started")]],
  ];
  let nestedEventValue = "leaf";
  for (let index = 0; index < 64; index += 1) nestedEventValue = [nestedEventValue];
  sourceJsonCases.push([jsonl([{ id: { started: {} }, started: { buildToolVersion: "8.7.0" }, extra: nestedEventValue }]), [
    issue("event_depth_exceeded", "/events/0"),
  ]]);
  for (const [source, errors] of sourceJsonCases) {
    check(runBytes(source), { stage: "source-json", sourceBytes: source, errors });
  }

  const fileErrorCases = [
    ["file_oneof_invalid", "/events/2/namedSetOfFiles/files/0", (file) => { file.contents = ""; }],
    ["contents_invalid_base64", "/events/2/namedSetOfFiles/files/0/contents", (file) => { delete file.uri; file.contents = "not base64"; }],
    ["digest_invalid", "/events/2/namedSetOfFiles/files/0/digest", (file) => { file.digest = "not-hex"; }],
    ["int64_invalid", "/events/2/namedSetOfFiles/files/0/length", (file) => { file.length = "00"; }],
  ];
  for (const [code, path, mutate] of fileErrorCases) {
    const events = baseEvents();
    mutate(events[2].namedSetOfFiles.files[0]);
    const source = jsonl(events);
    check(runBytes(source), { stage: "source-json", sourceBytes: source, errors: [issue(code, path)] });
  }
  {
    const events = baseEvents();
    delete events[1].completed;
    events[1].aborted = { reason: 99 };
    const source = jsonl(events);
    check(runBytes(source), {
      stage: "source-json", sourceBytes: source, errors: [issue("aborted_reason_invalid", "/events/1/aborted/reason")],
    });
  }
  {
    const events = baseEvents();
    events[3].finished.finishTime = "0100-02-29T00:00:00Z";
    const source = jsonl(events);
    check(runBytes(source), {
      stage: "source-json", sourceBytes: source, errors: [issue("timestamp_invalid", "/events/3/finished/finishTime")],
    });
  }

  {
    const events = baseEvents();
    events[0].started.buildToolVersion = "8.8.0";
    const source = jsonl(events);
    check(runBytes(source), {
      stage: "source-profile", sourceBytes: source,
      errors: [issue("unsupported_bazel_version", "/events/0/started/buildToolVersion")],
    });
  }
  {
    const source = jsonl([{ id: { started: {} }, lastMessage: true }]);
    check(runBytes(source), {
      stage: "source-profile", sourceBytes: source, errors: [issue("started_payload_missing", "/events/0")],
    });
  }
  {
    const source = jsonl([{ id: { started: {} }, progress: {}, lastMessage: true }]);
    check(runBytes(source), {
      stage: "source-profile", sourceBytes: source, errors: [issue("payload_id_mismatch", "/events/0")],
    });
  }

  const graphCases = [
    [[{ id: { progress: {} }, lastMessage: true }], [
      issue("missing_root", "/events/0"),
      issue("event_not_preannounced", "/events/0/id"),
      issue("orphan_event", "/events/0/id"),
    ]],
    [[
      { id: { progress: {} }, children: [{ started: {} }] },
      { id: { started: {} }, lastMessage: true, started: { buildToolVersion: "8.7.0" } },
    ], [
      issue("event_not_preannounced", "/events/0/id"),
      issue("orphan_event", "/events/0/id"),
      issue("root_not_first", "/events/1/id"),
    ]],
    [[
      { id: { started: {} }, started: { buildToolVersion: "8.7.0" } },
      { id: { started: {} }, lastMessage: true, started: { buildToolVersion: "8.7.0" } },
    ], [issue("multiple_root_events", "/events/1/id")]],
    [[
      { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" } },
      { id: { progress: {} } },
      { id: { progress: {} }, lastMessage: true },
    ], [issue("duplicate_event_id", "/events/2/id")]],
    [[
      { id: { started: {} }, children: [{ progress: {} }, { progress: { opaqueCount: 0 } }], started: { buildToolVersion: "8.7.0" } },
      { id: { progress: {} }, lastMessage: true },
    ], [issue("duplicate_child_id", "/events/0/children/1")]],
    [[
      { id: { started: {} }, children: [{ progress: { opaqueCount: 1 } }], started: { buildToolVersion: "8.7.0" } },
      { id: { progress: {} } },
      { id: { progress: { opaqueCount: 1 } }, children: [{ progress: {} }], lastMessage: true },
    ], [issue("event_not_preannounced", "/events/1/id")]],
    [[
      { id: { started: {} }, started: { buildToolVersion: "8.7.0" } },
      { id: { progress: {} }, children: [{ progress: { opaqueCount: 1 } }] },
      { id: { progress: { opaqueCount: 1 } }, lastMessage: true },
    ], [
      issue("event_not_preannounced", "/events/1/id"),
      issue("orphan_event", "/events/1/id"),
      issue("orphan_event", "/events/2/id"),
    ]],
    [[
      { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" } },
      { id: { progress: {} }, children: [{ progress: { opaqueCount: 0 } }], lastMessage: true },
    ], [issue("event_graph_cycle", "/events/1/children/0")]],
    [[
      { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" }, lastMessage: true },
      { id: { progress: {} } },
    ], [issue("last_message_not_final", "/events/0/lastMessage")]],
    [[
      { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" }, lastMessage: true },
      { id: { progress: {} }, lastMessage: true },
    ], [issue("multiple_last_message", "/events/1/lastMessage")]],
    [[
      { id: { started: {} }, children: [{ progress: {} }], started: { buildToolVersion: "8.7.0" }, lastMessage: true },
    ], [issue("last_message_with_missing_announced", "/events/0/lastMessage")]],
  ];
  for (const [events, errors] of graphCases) {
    const source = jsonl(events);
    check(runBytes(source), { stage: "event-graph", sourceBytes: source, errors });
  }

  check(runBytes(validSource, () => {}, { forceMappingInvariantFailure: true }), {
    stage: "mapping", sourceBytes: validSource, errors: [issue("mapping_invariant_failed", "/mapping")],
  });
  check(runBytes(validSource, () => {}, { coreEvaluator: () => ({ accepted: false, value: { private: true } }) }), {
    stage: "core", exitCode: 1, sourceBytes: validSource, coreInvoked: true,
    errors: [issue("core_rejected_generated_input", "/core")],
  });
  check(runBytes(validSource, () => {}, { forceInternalFailure: true }), {
    stage: "internal", exitCode: 1, sourceBytes: validSource, errors: [issue("internal_adapter_failure", "/internal")],
  });

  assert.deepEqual([...seen].sort(), Object.keys(FROZEN_ERROR_MESSAGES).sort());
});

test("same-stage errors sort by path/code/message and earlier stages suppress later defects", () => {
  const source = Buffer.from('{"id":{},"children":{},"extra":1}\n', "utf8");
  const result = runBytes(source);
  assert.equal(result.value.stage, "source-json");
  const tuples = result.value.errors.map(({ path, code, message }) => [path, code, message]);
  assert.deepEqual(tuples, [...tuples].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

  const request = requestFor(source);
  request.schema_version = "wrong";
  const mixed = adaptBazelBepArtifactCreated(Buffer.from(JSON.stringify(request)), source);
  assert.equal(mixed.value.stage, "request");
  assert.equal(errorCodes(mixed).includes("event_id_invalid"), false);
});

test("generated input remains schema-valid at the unchanged Agent Claim Check boundary", () => {
  let seenInput;
  const result = runEvents(baseEvents(), () => {}, {
    coreEvaluator: (bytes) => {
      seenInput = JSON.parse(bytes);
      return { accepted: true, value: { synthetic: true }, output: "{\"synthetic\":true}\n" };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(seenInput.schema_version, "daid_agent_claim_check_input_v1");
  assert.deepEqual(seenInput.evidence.map(({ id }) => id), [
    "bep-invocation-identity", "bep-target-result", "bep-artifact-record",
    "bep-build-terminal", "bep-stream-completeness",
  ]);
  assert.equal(seenInput.claim.type, "artifact-created");
  assert.equal(seenInput.capture.completeness, "complete");
});

const PROTECTED_CORE = [
  ["fixtures/agent-claim-check-v1/cases.json", "ec1f518227f3261f9c0add7650a6b015138a799c", "2202b47160feb07a230908c0dcde892a6b3942db1f33bdcac05a9defce918b91"],
  ["schemas/agent-claim-check-error-v1.schema.json", "63ec030352ca4a54c09291ec902168fb63f3eccf", "d05b7b90cf0790217c35cf3c66058b4db7d08616ec4e59a0e5a6dbf4dab42597"],
  ["schemas/agent-claim-check-input-v1.schema.json", "dafa071a1fba8093c8869d7f7b89024531930b87", "8aaf661aa13984e753f116b93eb88d8872fe71050d89580c90cb1dc67a8ff39e"],
  ["schemas/agent-claim-check-receipt-v1.schema.json", "3142f4be97a271345ca4d5c800083683c38ba662", "46af9807718c078fa3db729c907c6f2019f38c03113fde92a80829e3cd25ae1d"],
  ["src/agent-claim-check.mjs", "7063e220c0384f68067c40cba2c5148e5b7477d8", "58a61dff8f67723b336c58c193195fdda136cf4df9891ab0aea403f2a6017b33"],
  ["tests/agent-claim-check.test.mjs", "af95bf15222cc38d59c394222cfb9f2bc96531e1", "20c783acc3cbea788a5a58a21304dde44926dbd021b2166170c51e51eef30d55"],
  ["tools/agent-claim-check-synthetic-adapter.mjs", "b37846a1a726496df6a2cfd3f5e15a08f96d7737", "68d061960c113a7498729a27de36b537e74dc547ab71fd6f2b72e36240cf39c2"],
  ["tools/check-agent-claim.mjs", "f58e425e4ab8ff342dc4fb902af674b0bb82f9eb", "b2230312f278d0583d26e9102447398cf00f4ac0de037d73f2364aed6f4dc38c"],
  ["tools/check-repository.mjs", "99f20d06dadc5c266ef7c7c29a23af44fc8126ce", "ade779bd5f56042c2c3f0110368af8e7593a0c8fd84a974abf01744d832ba381"],
];
const ACCEPTED_CORE_MANIFEST_SHA256 = "c34c4f7011b9c1bb51b1d59df108577c7ccb1b094ec1aef3a1b7ca55e236cc8c";

test("the accepted nine-path Agent Claim Check v1 manifest remains byte-for-byte unchanged", async () => {
  const manifestRows = [];
  for (const [path, blob, digest] of PROTECTED_CORE) {
    const bytes = await readFile(join(ROOT, path));
    assert.equal(sha256(bytes), digest, path);
    const information = await stat(join(ROOT, path));
    assert.equal(information.mode & 0o777, 0o644, path);
    const hash = spawnSync("git", ["hash-object", "--", path], { cwd: ROOT, encoding: "utf8" });
    assert.equal(hash.status, 0, hash.stderr);
    assert.equal(hash.stdout, `${blob}\n`, path);
    manifestRows.push(`100644 ${bytes.length} ${sha256(bytes)} ${path}`);
  }
  assert.equal(PROTECTED_CORE.length, 9);
  const recomputedManifest = sha256(Buffer.from(`${manifestRows.join("\n")}\n`, "utf8"));
  assert.equal(recomputedManifest, ACCEPTED_CORE_MANIFEST_SHA256);
});

test("adapter and error schemas parse and freeze the complete versioned vocabulary", async () => {
  const requestSchema = JSON.parse(await readFile(join(ROOT, "schemas", "bazel-bep-artifact-created-request-v1.schema.json"), "utf8"));
  const errorSchema = JSON.parse(await readFile(join(ROOT, "schemas", "bazel-bep-artifact-created-adapter-error-v1.schema.json"), "utf8"));
  assert.equal(requestSchema.properties.schema_version.const, REQUEST_SCHEMA_VERSION);
  assert.equal(requestSchema.properties.source.properties.version.const, "8.7.0");
  assert.equal(errorSchema.properties.schema_version.const, ADAPTER_ERROR_SCHEMA_VERSION);
  assert.deepEqual(errorSchema.properties.stage.enum, [
    "request", "source-read", "source-integrity", "source-json", "source-profile",
    "event-graph", "mapping", "core", "internal",
  ]);
  const allCodes = new Set(errorSchema.properties.errors.items.properties.code.enum);
  for (const code of [
    "request_unreadable", "request_too_large", "request_invalid_utf8", "request_depth_exceeded",
    "request_malformed_json", "request_duplicate_key", "request_explicit_null", "request_unknown_field",
    "request_missing_field", "request_wrong_type", "request_non_nfc", "request_invalid_value",
    "source_unreadable", "source_too_large", "source_sha256_mismatch", "source_invalid_utf8",
    "source_empty", "source_too_many_events", "event_malformed_json", "event_duplicate_key",
    "event_explicit_null", "event_top_level_wrong_type", "event_depth_exceeded", "unknown_event_field",
    "event_non_nfc", "event_missing_id", "event_id_invalid", "event_children_wrong_type",
    "event_child_id_invalid", "last_message_wrong_type", "payload_oneof_multiple", "payload_wrong_type",
    "file_oneof_invalid", "contents_invalid_base64", "digest_invalid", "int64_invalid",
    "aborted_reason_invalid", "timestamp_invalid", "unsupported_bazel_version", "started_payload_missing",
    "payload_id_mismatch", "missing_root", "root_not_first", "multiple_root_events", "duplicate_event_id",
    "duplicate_child_id", "event_not_preannounced", "orphan_event", "event_graph_cycle",
    "last_message_not_final", "multiple_last_message", "last_message_with_missing_announced",
    "mapping_invariant_failed", "core_rejected_generated_input", "internal_adapter_failure",
  ]) assert.equal(allCodes.has(code), true, code);
});

test("the adapter is dependency-free and has no network, process, model, Bazel execution, telemetry, retry, or repair surface", async () => {
  const source = await readFile(join(ROOT, "tools", "adapt-bazel-bep-artifact-created.mjs"), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["node:crypto", "node:fs/promises", "node:url", "../src/agent-claim-check.mjs"]);
  for (const forbidden of [
    "node:child_process", "node:http", "node:https", "node:net", "node:dgram",
    "fetch(", "spawn(", "execfile(", "fork(", "openai", "ollama", "telemetry",
    "retry", "fallback", "repairinput", "writefile", "appendfile", "mkdir",
    "buffer.from(value, \"base64\")",
  ]) assert.equal(source.toLowerCase().includes(forbidden), false, forbidden);
});

test("fixture execution reads only request and capture and does not mutate the repository", async () => {
  const watched = [
    "tools/adapt-bazel-bep-artifact-created.mjs",
    "schemas/bazel-bep-artifact-created-request-v1.schema.json",
    "schemas/bazel-bep-artifact-created-adapter-error-v1.schema.json",
    "tests/bazel-bep-artifact-created-adapter.test.mjs",
    "README.md",
  ];
  const snapshot = async () => Object.fromEntries(await Promise.all(watched.map(async (path) => {
    const bytes = await readFile(join(ROOT, path));
    const information = await stat(join(ROOT, path));
    return [path, { digest: sha256(bytes), size: information.size, mode: information.mode & 0o777 }];
  })));
  const before = await snapshot();
  const directory = join(FIXTURE_ROOT, "supported-complete");
  const result = await runBazelBepArtifactCreatedCli([join(directory, "request.json"), join(directory, "events.bep.jsonl")]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.value.finding, "supported");
  assert.deepEqual(await snapshot(), before);
});

test("all public fixture and expected-output bytes are independently authored synthetic content", async () => {
  const directories = await readdir(FIXTURE_ROOT);
  for (const directory of directories) {
    const files = await readdir(join(FIXTURE_ROOT, directory));
    for (const file of files) {
      const text = await readFile(join(FIXTURE_ROOT, directory, file), "utf8");
      for (const forbidden of [
        "/Users/", "C:\\Users\\", "github_pat_", "ghp_", "sk-", "BEGIN PRIVATE KEY",
        "TheDarkniteFalls", "api_key", "access_token", "workspaceDirectory", "workingDirectory",
        "serverPid", "commandLine", "stdout", "stderr",
      ]) assert.equal(text.includes(forbidden), false, `${directory}/${file}: ${forbidden}`);
    }
  }
});

test("documentation preserves the exact version, license, privacy boundary, commands, outcomes, and non-claims", async () => {
  const guide = await readFile(join(ROOT, "docs", "bazel-bep-artifact-created-adapter-v1.md"), "utf8");
  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  for (const required of [
    "Bazel BEP JSON `8.7.0`", "Apache-2.0", "CC BY 4.0", "synthetic",
    "node tools/adapt-bazel-bep-artifact-created.mjs",
    "supported-complete", "contradicted-digest", "insufficient-target-success-truncated",
    "invalid-malformed-jsonl", "lastMessage", "BuildFinished", "not-assessed",
    "downstream_action_authorized", "configured digest", "does not run Bazel",
    "does not read the claimed artifact", "does not dereference", "does not use the network",
    "does not call a model", "does not authenticate", "does not authorize",
    "review private captures before sharing", "potentially sensitive",
    "https://bazel.build/versions/8.7.0/remote/bep",
    "https://github.com/bazelbuild/bazel/blob/8.7.0/LICENSE",
  ]) assert.equal(guide.includes(required), true, required);
  assert.equal(readme.includes("docs/bazel-bep-artifact-created-adapter-v1.md"), true);
});
