# Handoff compatibility on Node 24

The current runtime policy is Node.js `>=24.19.0 <25`. Local compatibility uses
exactly Node 24.19.0 on Darwin arm64; checks and Pages CI select exactly 24.21.0
on Ubuntu 24.04 x64. The declared range does not mean every patch has been tested.
Node 24.21.0 is recommended for ordinary new use. The local 24.19.0 floor is not
claimed to be latest, fully patched or security-equivalent to 24.21.0. Hosted
coverage remains pending until a workflow actually runs; local success does not
establish hosted success.

The [v1 handoff procedure](handoff-v1.md), its 44 files and its execution lock
remain immutable historical Node 20.20.2 evidence. Reports continue to identify
that historical lock. The separate Node 24 compatibility lock binds this document
and the new test; it does not relabel historical producer observations as new
Node 24 observations. Do not run the historical reproduction test to check this
migration: it is a Node 20 native/materialization procedure, outside the default
offline test selection.

## Offline checks

No dependencies need installation. Supply an absolute, resolved Node executable
and both independently reviewed digests explicitly. Missing or mismatched inputs
fail before repository setup or child tests; there is no default approved digest.
`NODE_OPTIONS` and `NODE_PATH` must be absent. The local operator verifies the
selected executable's bytes, version, platform and architecture against their
runtime approval before each command group. CI binds and records the executable
provided by setup-node.

```sh
export DAID_NODE_EXECUTABLE='/absolute/resolved/path/to/node'
export DAID_LOCK_SHA256='<reviewed historical execution-lock SHA-256>'
export DAID_NODE24_LOCK_SHA256='<reviewed Node 24 compatibility-lock SHA-256>'
export DAID_NODE24_LOCK_PATH='fixtures/handoff-v1/node24-compatibility-lock.json'
"$DAID_NODE_EXECUTABLE" --test tests/agent-claim-check-usage.test.mjs tests/agent-claim-check.test.mjs tests/bazel-bep-artifact-created-adapter.test.mjs tests/browser-model.test.mjs tests/cases.test.mjs tests/classifier.test.mjs tests/repository.test.mjs tests/site.test.mjs
DAID_NODE24_PROFILE=offline "$DAID_NODE_EXECUTABLE" --test tests/handoff-node24-compatibility.test.mjs
"$DAID_NODE_EXECUTABLE" tools/check-all.mjs
"$DAID_NODE_EXECUTABLE" tools/check-http.mjs
```

Where npm is available, `npm test` runs `test:core` followed by
`test:handoff:offline`; it requires the same explicit runtime/lock inputs.
`npm run check` and `npm run check:http` retain the repository's existing checks.
The absolute-node commands above are the local script expansions and require
no local npm executable. Offline compatibility makes zero Python, EvidenceGate,
model or network calls. The separate existing HTTP check uses loopback only.

Each compatibility process retains a fresh external temporary directory and
prints its receipt path. It reconstructs one disposable repository from the
unchanged public recipe and verifies B0/R0/R1. It then runs all 21 unchanged
focused tests, including collector, unsafe-selection, lock-failure and oracle
assertions, and 20 real CLI invocations: five cases, JSON and Markdown, twice
each. Raw outputs, exits, runtime identity, command timings and zero native calls
are retained. No candidate fixtures, observations or expected outputs are written.
A clean offline receipt covers the public case semantics and same-run byte
repeatability; it does not itself establish historical full-byte equivalence.

## Optional native replay

Native replay is separate from npm's default test and both hosted workflows.
It requires the exact locally approved Darwin arm64 Node 24.19.0 runtime,
Python 3.12.14, and a clean byte-exact EvidenceGate source checkout at the commit
and three source pins already recorded in the historical execution lock.
It never installs a runtime, falls back to offline or regenerates a receipt.

```sh
export DAID_EG_ROOT='/absolute/pinned/evidencegate/source'
export DAID_PYTHON_EXECUTABLE='/absolute/selected/python3'
DAID_NODE24_PROFILE=native-replay "$DAID_NODE_EXECUTABLE" --test tests/handoff-node24-compatibility.test.mjs
```

Run this only within an explicitly approved native-call allowance, after offline
checks and independent compatibility-lock review. It repeats the offline checks,
then copies each unchanged public receipt into its own external case directory.
It launches the selected interpreter directly with `-I -S -B` against pinned
source, in control, wrong-revision, missing-check, unbound-artifact, invalid-source
order, `validate` then `verify`: ten calls total. Source/runtime/repository checks
surround each call; raw stdout/stderr, exits, actual times and invocation bindings
remain separate from historical captures. A failure retains the count and stops;
never rerun native sampling or change scientific inputs to obtain a pass.

Expected validate/verify exits are 0/0, 0/1, 0/0, 0/0, 2/2 respectively.
Wrong revision reports `repository_revision_mismatch`; invalid source reports
`packet_load_error`. Complete verify output must equal the preserved public
`result.json`. Validate checks use the finite operation/exit/ok/finding semantics.
The missing-check case still exposes c19 and c20: 20 expected versus 18 observed,
even though the native receipt's 18 listed checks pass.

Full local migration acceptance additionally requires an independently sealed,
external private historical-evidence manifest. The owner and reviewer compare
all 20 report captures and, for native replay, all ten native captures to their
bound historical raw bytes and exits. That comparison is performed outside this
public suite. No private capture path, expected output digest or private manifest
is accepted by the public test or provisioned to CI. A public suite pass alone
is insufficient for that stronger local acceptance claim. The reviewer performs
offline checks and evidence-only native comparison, adding no native calls.

These checks test Node orchestration around the pinned Python verifier; they do
not migrate the verifier to Node or certify authentic execution, reviewer
identity, safety, correctness, demand, scientific intent or publication authority.
The synthetic scenarios remain synthetic. Commit, push, hosted execution and
publication require their separate authorization.
