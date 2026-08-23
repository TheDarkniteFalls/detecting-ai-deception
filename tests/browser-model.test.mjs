import assert from "node:assert/strict";
import test from "node:test";
import { choiceMessage, caseMatchesFilters } from "../src/site/app.mjs";

const findings = ["supported", "contradicted", "insufficient-evidence"];

test("every visitor choice produces a truthful response for every finding", () => {
  for (const selected of findings) {
    for (const finding of findings) {
      const message = choiceMessage(selected, finding);
      assert.ok(message.includes(selected === finding ? "matches" : "evidence rule finds"));
    }
  }
});

test("library filters combine finding and failure class", () => {
  assert.equal(caseMatchesFilters("contradicted", ["false-completion"], "all", "all"), true);
  assert.equal(caseMatchesFilters("contradicted", ["false-completion"], "contradicted", "all"), true);
  assert.equal(caseMatchesFilters("contradicted", ["false-completion"], "supported", "all"), false);
  assert.equal(caseMatchesFilters("contradicted", ["false-completion"], "all", "false-completion"), true);
  assert.equal(caseMatchesFilters("contradicted", ["false-completion"], "all", "evaluation-gap"), false);
});
