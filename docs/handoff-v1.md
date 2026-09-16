# Handoff v1: bounded synthetic reproduction

This offline composition preserves an operator's original requirements, records and
mapping, then calls the unchanged Agent Claim Check for each supported predicate.
It reports receipt revision, declared check execution, artifact creation attribution
and a separate artifact snapshot. It does not infer intent, task completion,
authenticity, safety, correctness or permission. There is no global pass.

The five fixtures are synthetic. Recorded check commands are never executed.
Their observation rows and write events are supplied assertions. The native
EvidenceGate invocation is captured separately and does not authenticate those rows.
Source attribution remains visible when files are read locally.

## Requirements

Use Node 20.x and the exact Node/Python versions in `execution-lock.json`, with no
package installation. Use an independently reviewed external SHA-256 for that lock.
The lock binds all 43 other slice files, the public baseline, runtime versions,
synthetic Git revisions and the stable EvidenceGate source pins. A digest calculated
from the candidate itself is not an approval reference.

Set these explicit operator inputs before reproduction:

- `DAID_EG_ROOT`: a clean checkout of EvidenceGate commit
  `473f9cac98f6ed83446e46b692db77c76b9be524`, including no ignored files.
- `DAID_PYTHON_EXECUTABLE`: the absolute selected Python executable. The test uses
  `-I -S -B` and launches only that pinned source tree; no installed CLI is used.
- `DAID_PROOF`: a fresh writable directory outside both checkouts. Use its physical
  absolute path. Native stdout, stderr, invocation receipts and timings stay here.
- `DAID_PUBLIC_TARGET`: the exact lane-declared DAID checkout used for execution.
- `DAID_LOCK_SHA256`: the external review receipt's exact lock digest.

The reproduction test checks the entire pinned source tree against Git before and
after native calls, including all three pinned contract hashes. It fails on missing
inputs or native mismatches and never skips a required native test. No third-party
Python packages are needed. `repository-recipe.json` fixes the fake author,
timestamps, tree bytes, modes and parent order for B0, R0 and R1.

## Sealed replay

```sh
node --test tests/handoff-v1.test.mjs
node --test tests/handoff-reproduction.test.mjs
npm test
npm run check
```

For each CASE (`control`, `wrong-revision`, `missing-check`, `unbound-artifact`,
`invalid-source`) run the following twice for each FORMAT (`json`, `markdown`) and
compare exact bytes outside the checkout:

```sh
node tools/check-handoff.mjs fixtures/handoff-v1/CASE/packet.json --execution-lock fixtures/handoff-v1/execution-lock.json --execution-lock-sha256 "$DAID_LOCK_SHA256" --format FORMAT
```

Errors exit 2. Valid evidence reports exit 0 even when findings are contradicted
or insufficient. The invalid-source fixture keeps independently readable B/C/N
assessments and emits no finding for A. JSON uses sorted keys and terminal LF;
Markdown preserves the same complete data in an escaped preformatted block.
Replay never rewrites the sealed fixture files and never inserts current timestamps.

| Case | A: revision | B: all checks ran | C: created | N: snapshot |
| --- | --- | --- | --- | --- |
| control | supported | supported | supported | supported |
| wrong-revision | contradicted | insufficient evidence | insufficient evidence | supported |
| missing-check | supported | insufficient evidence | supported | supported |
| unbound-artifact | supported | supported | insufficient evidence | supported |
| invalid-source | error, no finding | supported | supported | supported |

The missing-check case declares twenty checks in the original expectations but
lists only c01–c18 in the receipt and observations. Its native validate/verify
comparison must return exit 0. DAID separately reports missing c19/c20. That gap is
beyond the narrower native receipt's denominator; a native green result does not
establish that the original twenty ran. Reproduction demonstrates traceability,
not demand, an unbiased user study, or authentic execution of the recorded checks.

## Metadata-only collection

Prepare a `daid_handoff_selection_v1` JSON object with absolute `repository_root`,
`evidence_root`, a repository-relative `artifact_path`, an absent absolute
`output_path` outside the repository, packet-shaped `subject`, and `observer_id`.
The collector reads fixed Git revision/status and selected artifact metadata twice.
It rejects unsafe paths and symlinks and does not discover or execute evidence
commands, copy artifact bytes, or overwrite existing output.

```sh
node tools/collect-handoff.mjs "$DAID_PROOF/selection.json"
```

Collection writes an observation manifest with empty checks/writes, null invocation,
and the warning `execution not observed`. Stable observed absence is an artifact
observation; it does not contradict historical creation. Capture is not atomic.
Synthetic preparation can incorporate separately attributed producer rows without
relabeling them locally observed. Keep selection configuration outside public files.

## Producer-only materialization

This mode is only for a separately authorized fresh candidate with no generated
case inputs or lock. Author the recipe, expected oracle assertions, code, schema
and tests first. Capture native validate and verify for each case, retaining both
complete outputs and actual invocation receipts outside the checkout:

```sh
DAID_FIXTURE_MODE=materialize node --test tests/handoff-reproduction.test.mjs
```

Materialization refuses overwrites and does not run checker acceptance replay.
It uses verify exclusively for every selected `result.json` and invocation.
Stop after this command for independent external lock review. Changing any sealed
input requires a revised lock and independent review before replay resumes.
