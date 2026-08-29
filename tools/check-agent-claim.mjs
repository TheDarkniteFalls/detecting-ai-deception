#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evaluateAgentClaimBytes } from "../src/agent-claim-check.mjs";

export async function runAgentClaimCheckCli(argv = process.argv.slice(2), stdin = process.stdin) {
  if (argv.length > 1) throw new Error("usage: node tools/check-agent-claim.mjs [input.json|-]");
  const bytes = argv.length === 0 || argv[0] === "-"
    ? await readFileFromStream(stdin)
    : await readFile(argv[0]);
  return evaluateAgentClaimBytes(bytes);
}

async function readFileFromStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  try {
    const result = await runAgentClaimCheckCli();
    process.stdout.write(result.output);
    process.exitCode = result.accepted ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
