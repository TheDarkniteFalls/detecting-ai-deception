# Agent Claim Check

**Compare an agent’s claim with the evidence you provide.**

An agent says it created a file. What does your record show? Agent Claim Check
compares one structured claim with the observations you supply and returns
`supported`, `contradicted` or `insufficient_evidence`.

I lead this project and its public framing, with AI assistance for drafting,
implementation and testing. You can start with the offline checker below, or
[try a synthetic teaching case](https://thedarknitefalls.github.io/detecting-ai-deception/cases/unsupported-citation/)
to work through the comparison in your browser.

The checker does not gather or authenticate evidence, inspect your workspace,
or determine intent. You choose the requirements and record the observations.
[Open the guide](https://thedarknitefalls.github.io/detecting-ai-deception/) for
examples and the four-step method.

## Run Agent Claim Check v1

You need Node.js `>=24.19.0 <25` and Git to clone. No dependency installation
is required. After cloning, run the supported example from a file or the
contradicted example through standard input:

```sh
git clone https://github.com/TheDarkniteFalls/detecting-ai-deception.git
cd detecting-ai-deception
node tools/check-agent-claim.mjs examples/agent-claim-check-v1/supported.json
node tools/check-agent-claim.mjs - < examples/agent-claim-check-v1/contradicted.json
```

The first command returns `supported` with
`intent_assessment: "not-assessed"`,
`downstream_action_authorized: false`, and
`does_not_establish: ["correctness", "safety", "identity",
"successful-execution", "authority", "permission"]`. Supported describes
only the declared claim/evidence relationship; it is not permission to act.

| Example | Exit | Result |
| --- | ---: | --- |
| `supported.json` | 0 | `supported` |
| `contradicted.json` | 0 | `contradicted` |
| `insufficient-evidence.json` | 0 | `insufficient_evidence` |
| `invalid-input.json` | 2 | `unknown_enum`; no finding |

Read the [Agent Claim Check v1 guide](docs/agent-claim-check-v1.md)
for the input contract, receipt fields, harness mapping, schemas, provenance,
licensing and public-safe challenge route.

See the [Bazel build-event adapter example](docs/bazel-bep-artifact-created-adapter-v1.md)
for one version-pinned real-format adapter and its synthetic offline fixtures.

<!-- toolkit-trust-card:placement -->

<!-- toolkit-trust-card:start -->
> **Public contract:** Experimental Pattern · about 5 min · Node.js >=24.19.0 <25 · no model · no network
>
> **Operation:** Read-only check; examples may use temporary files
>
> **A pass establishes:** The dependency-free classifier shared by the browser and Node.js tests deterministically reproduces the declared findings for exactly six synthetic teaching cases; the static investigation uses no model, backend, account, analytics, or submitted data.
>
> **It does not establish:** Intent is not-assessed: it does not infer deliberate lying, consciousness, or malicious intent, and six synthetic cases do not establish real-world prevalence, production behavior, or whole-system safety.
>
> **First check:** `npm test`
<!-- toolkit-trust-card:end -->

## About the name

The project was previously called Detecting AI Deception (DAID). Its earlier
introduction said, “Detecting AI Deception (DAID) asks the narrower question:
how does the exact claim relate to the available evidence?” Agent Claim Check
names that task more directly. Repository URLs and technical identifiers remain
unchanged.

## The method

1. **Record the claim.** Capture the exact statement before interpreting it.
2. **Define the required evidence.** State what would need to be observable for
   the claim to hold.
3. **Compare the record.** Mark each required observation as supporting,
   contradictory, absent, unknown, stale or inapplicable.
4. **Report the narrowest finding.** Keep the evidence relationship separate
   from intent.

The deterministic rule produces three findings:

- **Supported:** every declared required observation supports the claim.
- **Contradicted:** at least one required observation directly conflicts with
  the claim.
- **Insufficient evidence:** required evidence is absent, unknown, stale or
  inapplicable, and none of the available required observations contradicts
  the claim.

For AI answer verification, claim checking and citation verification, use the
observations you can inspect. Labels such as *AI hallucination* do not explain
why a result occurred. Every case records intent as `not-assessed`. A **Supported** finding
establishes only that the declared evidence supports the bounded claim. It does
not by itself establish correctness, safety, identity, successful execution,
authority or permission.

## What the teaching examples show

The public case pack contains exactly six synthetic teaching cases: three
`contradicted`, two `insufficient-evidence` and one `supported`. They illustrate
missing output, omitted evaluation cases, an unsupported citation, a product
identity mismatch, an unknown external result and a supported revision-bound
control.

The cases show how the published rule handles declared evidence. They do not
establish how often these failures occur, how a live model behaves, what an
audience prefers, or whether a product is safe. There is no live-model
benchmark, prevalence estimate, audience study, certification, ranking or
deception score.

## Inspect the evidence and source

- [Six-case JSON pack](data/deception-cases.v1.json)
- [Case JSON Schema](schemas/deception-case-v1.schema.json)
- [Exact-revision public source map](data/source-map.v1.json)
- [Pure classifier](src/classifier.mjs)
- [Known-bad fixtures](fixtures/known-bad/)
- [Generated site manifest](dist/build-manifest.json)
- [Plain-text discovery summary](https://thedarknitefalls.github.io/detecting-ai-deception/llms.txt)

Every case names its canonical source, reviewed-through date, runnable check,
limitations and non-claims. The browser and Node.js checker import the same
classifier. The static site contains no live model, backend, account,
analytics, cookies or submitted-data flow.

## Reproduce the findings

Requirements: Node.js `>=24.19.0 <25`. No dependency installation is required.

`npm test` runs core and offline handoff compatibility checks with explicit
reviewed lock/runtime inputs. Native handoff replay is a separate opt-in profile;
see the [Node 24 handoff recipe](docs/handoff-node24.md). The v1 handoff files and
Node 20 producer evidence remain historical and unchanged.

```sh
git clone https://github.com/TheDarkniteFalls/detecting-ai-deception.git
cd detecting-ai-deception
node tools/check-cases.mjs --self-test
npm test
npm run check
npm run check:http
```

`npm run check` builds the site three times and requires identical manifests
and digests. `npm run check:http` serves every public route on an ephemeral
loopback-only listener and requires meaningful responses. To inspect the built
site yourself:

```sh
npm run build
python3 -m http.server --bind localhost 8080 --directory dist
```

Then open `http://localhost:8080/`.

## Public routes

- [Cases](https://thedarknitefalls.github.io/detecting-ai-deception/cases/) —
  all six synthetic records and finding filters.
- [Method](https://thedarknitefalls.github.io/detecting-ai-deception/method/) —
  finding taxonomy, deterministic rule, limitations and glossary.
- [Tools](https://thedarknitefalls.github.io/detecting-ai-deception/tools/) —
  exact reviewed revisions of narrower supporting projects.
- [Challenge](https://thedarknitefalls.github.io/detecting-ai-deception/challenge/) —
  reproduction steps and structured public-safe issue routes.
- [About](https://thedarknitefalls.github.io/detecting-ai-deception/about/) —
  motivation, provenance, boundaries and AI-assistance disclosure.
- [Source repository](https://github.com/TheDarkniteFalls/detecting-ai-deception) —
  exact files, history, tests and issue templates.

The complete scenario, evidence trail, finding, sources and non-claims remain
in the page HTML when JavaScript is unavailable. JavaScript adds filters and
the choose-then-reveal interaction; it does not send or store visitor choices.

The public discovery surface also includes `robots.txt`, a dated
`sitemap.xml`, canonical and Open Graph metadata, structured data, a favicon
and `llms.txt`. A project-scoped IndexNow ownership file can support a
separately authorized change notification; it is inert and does not guarantee
crawling, indexing or ranking.

## Relationship to the Reliability Lab

Agent Claim Check brings the checker and its teaching examples together. Its [Tools](https://thedarknitefalls.github.io/detecting-ai-deception/tools/)
page links to supporting projects at exact reviewed revisions, each with a
narrow role and an explicit non-claim. Those tools do not individually prove
the wider method or make the connected workflow safe.

The broader
[Reliability Navigator route to Agent Claim Check](https://thedarknitefalls.github.io/local-assistant-reliability-lab/?journey=bound_and_prove&problem=detecting-ai-deception&help_type=runnable_check&runtime=node&local=1&no_model=1&read_only=1&path=ground-model-output)
describes it as an experimental, local, no-model, read-only Node.js check and
shows its proof and limitation beside related public tools. A route
recommendation is not certification that a tool fits every setup.

## Contribute, license and report security issues

Results should be reproducible and open to correction. Use the
[structured issue chooser](https://github.com/TheDarkniteFalls/detecting-ai-deception/issues/new/choose)
for a public-safe reproduction, counterexample, new synthetic case or
accessibility/site defect. Do not submit private logs, credentials, personal
data, unpublished material, confidential model interactions or sensitive
vulnerability details.

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Licensing explanation](LICENSING.md)
- [Apache-2.0 software license](LICENSE)
- [CC BY 4.0 content license](LICENSE-CONTENT)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Software-oriented files are Apache-2.0. Original prose, case narratives,
synthetic case data and teaching assets are CC BY 4.0. Linked third-party
materials retain their own rights and licenses.
