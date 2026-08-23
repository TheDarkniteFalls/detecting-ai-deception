import assert from "node:assert/strict";
import test from "node:test";
import { runSelfTest } from "../tools/check-cases.mjs";

test("case pack and known-bad fixtures pass the stable self-test", async () => {
  const result = await runSelfTest();
  assert.deepEqual(result.classifications, { supported: 1, contradicted: 3, "insufficient-evidence": 2 });
  assert.equal(result.case_count, 6);
  assert.equal(result.known_bad_fixture_count, 7);
  assert.equal(result.result, "pass");
  assert.equal(result.schema_version, "detecting_ai_deception_case_check_v1");
});
