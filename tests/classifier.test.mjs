import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyCase, classifyEvidence } from "../src/classifier.mjs";

const pack = JSON.parse(await readFile(new URL("../data/deception-cases.v1.json", import.meta.url), "utf8"));

test("the six cases classify exactly as declared", () => {
  assert.equal(pack.cases.length, 6);
  for (const record of pack.cases) assert.equal(classifyCase(record), record.expected_finding, record.id);
});

test("contradiction has precedence", () => {
  assert.equal(
    classifyEvidence(
      [{ id: "a" }, { id: "b" }],
      [{ requirement_id: "a", state: "absent" }, { requirement_id: "b", state: "contradictory" }],
    ),
    "contradicted",
  );
});

test("absent, unknown, stale and inapplicable evidence remain insufficient", () => {
  for (const state of ["absent", "unknown", "stale", "inapplicable"]) {
    assert.equal(classifyEvidence([{ id: "a" }], [{ requirement_id: "a", state }]), "insufficient-evidence");
  }
});

test("all required evidence must support a supported finding", () => {
  assert.equal(
    classifyEvidence(
      [{ id: "a" }, { id: "b" }],
      [{ requirement_id: "a", state: "supports" }, { requirement_id: "b", state: "supports" }],
    ),
    "supported",
  );
});

test("unknown and duplicate observations fail closed", () => {
  assert.throws(() => classifyEvidence([{ id: "a" }], [{ requirement_id: "b", state: "supports" }]), /unknown requirement_id/);
  assert.throws(
    () => classifyEvidence([{ id: "a" }], [{ requirement_id: "a", state: "supports" }, { requirement_id: "a", state: "supports" }]),
    /duplicate observation/,
  );
});
