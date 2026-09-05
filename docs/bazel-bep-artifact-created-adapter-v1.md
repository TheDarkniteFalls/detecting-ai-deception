# Bazel BEP artifact-created adapter v1

This dependency-free, offline adapter maps one already-captured
Bazel BEP JSON `8.7.0` stream into the unchanged Agent Claim Check v1 contract. It answers one
narrow question: does the supplied, hash-bound event stream support the claim
that one exact Bazel invocation recorded one selected artifact and completed
successfully?

The important limitation is visible in the result. A target can report success
and name an output while the capture still ends before `BuildFinished`, before
all announced events are posted, or without one final `lastMessage: true`. That
is `insufficient_evidence`, not `supported`.

## Run it offline

Requirements: Node.js 20 or newer. No dependency installation, Bazel workspace,
Bazel binary, model, network, or claimed artifact is required.

```sh
node tools/adapt-bazel-bep-artifact-created.mjs \
  fixtures/bazel-bep-artifact-created-v1/supported-complete/request.json \
  fixtures/bazel-bep-artifact-created-v1/supported-complete/events.bep.jsonl

node --test tests/bazel-bep-artifact-created-adapter.test.mjs
```

The CLI takes exactly two local input paths: the DAID request and the captured
BEP JSONL file. It writes exactly one canonical JSON document and one terminal
line feed to stdout.

- Exit `0`: one accepted Agent Claim Check v1 receipt, regardless of finding.
- Exit `2`: one contract-invalid adapter error, no finding, and no core call.
- Exit `1`: an unreadable input, core rejection, or unexpected internal failure.

Expected receipts and adapter errors leave stderr empty. There is no retry,
repair, sampling, truncation, upload, cache, or telemetry path.

## Exact job and fixed claim

The request selects one invocation UUID, base target/configuration, the
`default` output group, and one artifact path, configured digest, and byte
length. The adapter constructs this fixed claim:

> Bazel invocation `<build_uuid>` recorded the requested artifact
> `<artifact_label>` for target `<target_label>` with configured digest
> `<digest>` and length `<length>` bytes, and the build completed successfully.

`artifact_label` is the only path-like identifier rendered in the claim. The
adapter compares `pathPrefix` and `name` in memory, renders only their SHA-256,
and discards the raw selected path and URI before invoking Agent Claim Check.
The words configured digest are deliberate: BEP's `File.digest` does not name
the configured algorithm, so this adapter does not call it SHA-256.

## Frozen source profile

The accepted input is protobuf JSON produced for Bazel `8.7.0` by
`--build_event_json_file`. The adapter supports one stream, one base target,
one configuration, one `default` output group, and one claimed artifact. It
does not claim compatibility with another Bazel version, binary or text BEP,
Build Event Service payloads, action/test outputs, multiple selected targets,
or a generic provider abstraction.

The profile uses five ordered observations:

| Evidence | BEP observations | Result boundary |
| --- | --- | --- |
| `bep-invocation-identity` | Root `started.uuid`, `buildToolVersion`, and `command` | Supports only the exact UUID, version `8.7.0`, and `build` command |
| `bep-target-result` | Exact base `targetCompleted` identity, success, output group, incompleteness, and file-set references | An aspect cannot supply or contradict the base result |
| `bep-artifact-record` | Transitive `NamedSetOfFiles`, path, configured digest, length, and ordinary URI-form record | The URI is never parsed, opened, dereferenced, or emitted |
| `bep-build-terminal` | `BuildFinished.exitCode` and `finishTime`, or `Aborted` | A missing terminal record cannot support completion |
| `bep-stream-completeness` | Normalized event IDs, child graph, reachability, clean EOF, and final `lastMessage` | Clean EOF alone is partial evidence |

Event IDs use the frozen Bazel 8.7.0 schema-aware normal form. Omitted proto3
scalar and repeated defaults equal their explicit defaults; optional message
presence remains distinct. The graph must have one root at event zero, unique
posted IDs, prior announcements, no repeated child edge, root reachability, no
cycle, and exactly one final true marker for complete capture.

Valid but incomplete or unsupported observations remain evidence, not parser
errors. Missing a final marker, missing an announced event without a true
marker, incomplete selected output, unresolved selected set, ambiguity,
missing terminal fields, inline contents, symlinks, inline output-group files,
or directory output produces `insufficient_evidence` unless a required
observation is contradictory. Malformed JSON, invalid UTF-8, wrong types,
duplicate keys or IDs, unknown top-level event fields, graph violations,
source-hash mismatch, and exceeded bounds produce an adapter error with no
finding.

## Public-safe synthetic fixtures

All fixture bytes were independently authored for this repository. They are
not copied Bazel examples and are not real build traces.

| Fixture | Capture | Expected result |
| --- | --- | --- |
| `supported-complete` | Exact target, ordinary URI-form record, successful terminal event, closed graph, and final true marker | `supported` |
| `contradicted-digest` | Same complete shape with a different configured digest at the exact requested path | `contradicted` |
| `insufficient-target-success-truncated` | Target success and named output are present, but the announced terminal event and final true marker are missing | `insufficient_evidence` |
| `invalid-malformed-jsonl` | Fully read source contains one malformed JSONL record | Adapter error at `source-json`, exit `2`, no finding |

Each request binds the exact event bytes with SHA-256. Every accepted evidence
item repeats that whole-source hash, exact source revision, virtual event-index
reference, and observed channel. The focused test freezes the request, source,
expected output, and produced-output hashes and runs every fixture twice.

## Bounds and fail-closed behavior

- Request: at most 65,536 bytes and JSON container depth 16.
- Source: at most 8,388,608 bytes and 10,000 non-empty JSONL events.
- Event: JSON container depth 64.
- Selected named-set traversal: at most 10,000 unique IDs, iterative and
  cycle-aware.
- Text: fatal UTF-8 decoding and NFC strings.
- JSON: duplicate keys and explicit nulls are rejected.
- Source identity: request SHA-256 must match the complete raw source bytes.

The adapter does not resolve source-controlled paths, follow symlinks, decode
inline artifact contents, spawn a process, fetch a schema, or use a
source-controlled string as a module, command, network target, output path, or
authority decision.

## Privacy and receipt handling

Real BEP streams can contain usernames, hosts, working directories, workspace
paths, process identifiers, command-line options, output URIs, logs, and custom
metadata. Only synthetic streams belong in this repository. For local use,
review private captures before sharing either the source or a receipt.

The adapter is local: it does not use the network, upload, log, cache, retain,
or write input. It maps only the selected observations and binds the complete
capture by hash. A receipt omits raw selected path components, joined paths,
exact URIs, inline bytes, symlink targets, aborted descriptions, caller input
paths, and unrelated event fields.

Receipts are still potentially sensitive. They retain the fixed claim, build
UUID, target label, configured digest, byte length, timestamps, public-safe
artifact label, and whole-source hash. Review them before sharing.

## Provenance and licensing

The source profile is pinned to these versioned upstream references:

- [Bazel BEP overview 8.7.0](https://bazel.build/versions/8.7.0/remote/bep)
- [Bazel BEP examples and named-set traversal 8.7.0](https://bazel.build/versions/8.7.0/remote/bep-examples)
- [Bazel BEP glossary 8.7.0](https://bazel.build/versions/8.7.0/remote/bep-glossary)
- [Bazel 8.7.0 protocol definition](https://github.com/bazelbuild/bazel/blob/8.7.0/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto)
- [Bazel 8.7.0 license](https://github.com/bazelbuild/bazel/blob/8.7.0/LICENSE)

The adapter, schemas, and automated test software are Apache-2.0 under this
repository's software license. This guide, requests, event streams, expected
outputs, and other independently authored synthetic content are CC BY 4.0
under the repository's content license. No Bazel, SLSA, in-toto, OpenLineage,
third-party example, protocol-source, documentation, or real-trace bytes are
redistributed. Links and compatibility identifiers do not imply ownership,
endorsement, or authentication.

## Non-claims

Even `supported` establishes only that the supplied hash-bound BEP observations
support the exact constructed claim. The adapter does not run Bazel, does not read the claimed artifact, does not dereference a URI, does not use the network,
does not call a model, does not authenticate Bazel, the builder, machine, user,
or agent, and does not authorize any downstream action.

It does not establish artifact existence or availability; a digest algorithm;
correctness, safety, identity, successful execution outside the recorded
observation, authority, permission, hermeticity, reproducibility, content
fitness, producer authenticity, intent, prevalence, certification, ranking,
generality, or product readiness. `intent_assessment` remains `not-assessed`
and `downstream_action_authorized` remains `false` in every accepted receipt.
