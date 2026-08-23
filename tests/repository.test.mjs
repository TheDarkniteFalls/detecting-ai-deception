import assert from "node:assert/strict";
import test from "node:test";
import { checkRepository } from "../tools/check-repository.mjs";

test("licensing, source, safety and workflow surfaces pass", async () => {
  const result = await checkRepository();
  assert.deepEqual(result.errors, []);
  assert.equal(result.result, "pass");
});
