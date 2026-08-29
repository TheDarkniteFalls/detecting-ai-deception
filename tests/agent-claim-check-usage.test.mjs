import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_ROOT = join(ROOT, "examples", "agent-claim-check-v1");

const EXAMPLES = [
  {
    file: "supported.json",
    inputSha256: "4c0cde57c2957c40db6130cc00b991e6bd6bd38b7c0dc8af8be664a17dd5822f",
    outputSha256: "bcf7da82117726940e7c9948f7b17b4a43a1c7456728d9c693b9de97d2ee46e3",
    exit: 0,
    finding: "supported",
  },
  {
    file: "contradicted.json",
    inputSha256: "baa8650e70cdcca76a7d9046eccd49db24155ff271ed6138e1797137083f5474",
    outputSha256: "4b066868145a3b5c0f58928f4d540bce3be1a6e39332b2598867a695627ba9c0",
    exit: 0,
    finding: "contradicted",
  },
  {
    file: "insufficient-evidence.json",
    inputSha256: "edd08c5805d9685129d58a9acb515fcd015d34e83759b02798ae1a054394fbe3",
    outputSha256: "9d52a3dc6be6e4b67cd82a809842aab216075b27842646f28b326923aab9e887",
    exit: 0,
    finding: "insufficient_evidence",
  },
  {
    file: "invalid-input.json",
    inputSha256: "1b523431dfb738d62f439ce81ead14941eedba3629092c54642e200a24bcb42e",
    outputSha256: "db7a60222b64df2fecdf3bb9b2f7d178bdfc8d27a4f5d093593f9a466e580671",
    exit: 2,
    error: "unknown_enum",
  },
];

const CORE = [
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runFile(file) {
  return spawnSync(process.execPath, ["tools/check-agent-claim.mjs", `examples/agent-claim-check-v1/${file}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runStdin(bytes) {
  return spawnSync(process.execPath, ["tools/check-agent-claim.mjs", "-"], {
    cwd: ROOT,
    input: bytes,
    encoding: "utf8",
  });
}

test("the four standalone synthetic examples have their frozen bytes and outcomes", async () => {
  for (const expected of EXAMPLES) {
    const bytes = await readFile(join(EXAMPLE_ROOT, expected.file));
    assert.equal(sha256(bytes), expected.inputSha256, expected.file);
    assert.equal(bytes.at(-1), 0x0a, `${expected.file} lacks one terminal LF`);
    assert.notEqual(bytes.at(-2), 0x0a, `${expected.file} has extra terminal whitespace`);
    assert.deepEqual(Buffer.from(`${JSON.stringify(JSON.parse(bytes), null, 2)}\n`), bytes, `${expected.file} is not two-space JSON`);

    const fileRun = runFile(expected.file);
    const stdinRun = runStdin(bytes);
    for (const run of [fileRun, stdinRun]) {
      assert.equal(run.status, expected.exit, `${expected.file}: ${run.stderr}`);
      assert.equal(run.stderr, "", expected.file);
      assert.equal(run.stdout.endsWith("\n"), true, expected.file);
      assert.equal(run.stdout.endsWith("\n\n"), false, expected.file);
      assert.equal(sha256(Buffer.from(run.stdout)), expected.outputSha256, expected.file);
    }
    assert.equal(fileRun.stdout, stdinRun.stdout, `${expected.file} file/stdin mismatch`);

    const value = JSON.parse(fileRun.stdout);
    assert.equal(value.intent_assessment, "not-assessed", expected.file);
    assert.equal(value.downstream_action_authorized, false, expected.file);
    if (expected.finding) {
      assert.equal(value.accepted, true, expected.file);
      assert.equal(value.finding, expected.finding, expected.file);
      assert.deepEqual(value.does_not_establish, [
        "correctness", "safety", "identity", "successful-execution", "authority", "permission",
      ], expected.file);
      assert.deepEqual(value.checks, [
        { id: "input-contract", state: "passed" },
        { id: "evidence-classification", state: "passed" },
        { id: "external-execution", state: "not-run" },
        { id: "identity-authentication", state: "not-run" },
        { id: "permission-validation", state: "not-run" },
        { id: "intent-assessment", state: "not-run" },
      ], expected.file);
    } else {
      assert.equal(value.accepted, false);
      assert.equal(value.errors.some(({ code, path }) => code === expected.error && path === "/evidence/0/state"), true);
      assert.equal(Object.hasOwn(value, "finding"), false);
      assert.equal(Object.hasOwn(value, "canonical_input_sha256"), false);
    }
  }
});

test("all nine published core paths retain their accepted base modes and blobs", async () => {
  for (const [path, blob, digest] of CORE) {
    const tree = spawnSync("git", ["ls-tree", "HEAD", "--", path], { cwd: ROOT, encoding: "utf8" });
    assert.equal(tree.status, 0, tree.stderr);
    assert.match(tree.stdout, new RegExp(`^100644 blob ${blob}\\t${path}\\n$`), path);
    const currentBlob = spawnSync("git", ["hash-object", "--", path], { cwd: ROOT, encoding: "utf8" });
    assert.equal(currentBlob.status, 0, currentBlob.stderr);
    assert.equal(currentBlob.stdout, `${blob}\n`, path);
    assert.equal(sha256(await readFile(join(ROOT, path))), digest, path);
    assert.equal((await stat(join(ROOT, path))).mode & 0o777, 0o644, path);
  }
});

test("the teaching and harness packs remain separate six-case contracts", async () => {
  const teaching = JSON.parse(await readFile(join(ROOT, "data", "deception-cases.v1.json"), "utf8"));
  const harness = JSON.parse(await readFile(join(ROOT, "fixtures", "agent-claim-check-v1", "cases.json"), "utf8"));
  const count = (values) => values.reduce((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {});
  assert.deepEqual(count(teaching.cases.map(({ expected_finding: value }) => value)), {
    supported: 1,
    contradicted: 3,
    "insufficient-evidence": 2,
  });
  assert.deepEqual(count(harness.cases.map(({ expected_finding: value }) => value)), {
    supported: 1,
    contradicted: 2,
    insufficient_evidence: 3,
  });
});

test("README and guide publish the exact offline commands, boundaries, links, and safety language", async () => {
  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  const guide = await readFile(join(ROOT, "docs", "agent-claim-check-v1.md"), "utf8");
  const licensing = await readFile(join(ROOT, "LICENSING.md"), "utf8");
  const commands = [
    "git clone https://github.com/TheDarkniteFalls/detecting-ai-deception.git",
    "cd detecting-ai-deception",
    "node tools/check-agent-claim.mjs examples/agent-claim-check-v1/supported.json",
    "node tools/check-agent-claim.mjs - < examples/agent-claim-check-v1/contradicted.json",
    "node tools/check-agent-claim.mjs examples/agent-claim-check-v1/insufficient-evidence.json",
    "node tools/check-agent-claim.mjs examples/agent-claim-check-v1/invalid-input.json",
  ];
  for (const command of commands.slice(0, 4)) assert.ok(readme.includes(command), command);
  for (const command of commands) assert.ok(guide.includes(command), command);
  for (const text of [readme, guide]) {
    assert.doesNotMatch(text, /npm install|npx |pnpm |yarn /);
    assert.match(text, /intent_assessment"?: "not-assessed"/);
    assert.match(text, /downstream_action_authorized"?: false/);
    for (const boundary of ["correctness", "safety", "identity", "successful-execution", "authority", "permission"]) {
      assert.ok(text.includes(`"${boundary}"`), boundary);
    }
  }
  for (const path of [
    "examples/agent-claim-check-v1/supported.json",
    "examples/agent-claim-check-v1/contradicted.json",
    "examples/agent-claim-check-v1/insufficient-evidence.json",
    "examples/agent-claim-check-v1/invalid-input.json",
    "schemas/agent-claim-check-input-v1.schema.json",
    "schemas/agent-claim-check-receipt-v1.schema.json",
    "schemas/agent-claim-check-error-v1.schema.json",
    "src/agent-claim-check.mjs",
    "tools/check-agent-claim.mjs",
    "tests/agent-claim-check.test.mjs",
    "fixtures/agent-claim-check-v1/cases.json",
    "tools/agent-claim-check-synthetic-adapter.mjs",
  ]) await stat(join(ROOT, path));
  assert.match(guide, /Never silently map\s+missing, stale, unknown, or inapplicable evidence to `supports`/);
  assert.match(guide, /Do not place credentials, personal data, private logs/);
  assert.match(licensing, /docs\/agent-claim-check-v1\.md/);
  assert.match(licensing, /examples\/agent-claim-check-v1\//);
  assert.match(licensing, /remain Apache-2\.0/);
});
