#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { canonicalJson, evaluateAgentClaimBytes } from "../src/agent-claim-check.mjs";

const fixtureUrl = new URL("../fixtures/agent-claim-check-v1/cases.json", import.meta.url);

export function mapSyntheticHarnessEvent(event) {
  const hashMatches = event.expected_sha256 === event.observed_sha256;
  return {
    schema_version: "daid_agent_claim_check_input_v1",
    claim: {
      id: `claim-${event.event_id}`,
      text: event.agent_claim,
      type: event.claim_type,
    },
    evidence: [
      {
        id: "artifact-path",
        requirement: `The requested path is ${event.requested_path}.`,
        state: event.requested_path === event.observed_path ? "supports" : "contradictory",
        observed_value: event.observed_path,
        observed_channel: "synthetic-harness-event",
      },
      {
        id: "artifact-hash",
        requirement: "The observed artifact hash matches the requested content hash.",
        state: hashMatches ? "supports" : "contradictory",
        observed_value: event.observed_sha256,
        source_sha256: event.observed_sha256,
        observed_channel: "synthetic-harness-event",
      },
    ],
    capture: {
      completeness: event.capture_complete ? "complete" : "partial",
      adapter_warnings: event.capture_complete ? [] : ["The synthetic harness event is incomplete."],
    },
  };
}

export async function runSyntheticAdapter() {
  const pack = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const input = mapSyntheticHarnessEvent(pack.synthetic_harness_event);
  return evaluateAgentClaimBytes(Buffer.from(canonicalJson(input), "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runSyntheticAdapter();
  process.stdout.write(result.output);
  process.exitCode = result.accepted ? 0 : 2;
}
