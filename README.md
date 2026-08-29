# Detecting AI Deception

<!-- toolkit-trust-card:start -->
> **Public contract:** Experimental Pattern · about 5 min · Node.js 20+ · no model · no network
>
> **Operation:** Read-only check; examples may use temporary files
>
> **A pass establishes:** The dependency-free classifier shared by the browser and Node.js tests deterministically reproduces the declared findings for exactly six synthetic teaching cases; the static investigation uses no model, backend, account, analytics, or submitted data.
>
> **It does not establish:** Intent is not-assessed: it does not infer deliberate lying, consciousness, or malicious intent, and six synthetic cases do not establish real-world prevalence, production behavior, or whole-system safety.
>
> **First check:** `npm test`
<!-- toolkit-trust-card:end -->

**Check whether an AI answer or citation is backed by the available evidence.**

[Open the live investigation](https://thedarknitefalls.github.io/detecting-ai-deception/) ·
[Try a synthetic case](https://thedarknitefalls.github.io/detecting-ai-deception/cases/unsupported-citation/) ·
[Read the four-step method](https://thedarknitefalls.github.io/detecting-ai-deception/method/)

Detecting AI Deception (DAID) is a public, Mike-led investigation developed
transparently with AI assistance. It helps people reviewing an AI answer make
one bounded comparison: what exactly was claimed, what evidence would that
claim require, and what does the observable record support?

This is useful when an answer sounds certain but a file is missing, an
evaluation omits cases, a citation says something else, evidence belongs to a
different product version, or the result of an external action is unknown.
Terms such as *AI hallucination* and *fabricated citation* can blur those
different failures. Detecting AI Deception (DAID) asks the narrower question:
how does the exact claim relate to the available evidence? It is a practical
AI answer verification method for claim checking and citation verification,
and it reports that relationship without guessing why the output was produced.

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

Every case records intent as `not-assessed`. A **Supported** finding
establishes only that the declared evidence supports the bounded claim. It does
not by itself establish correctness, safety, identity, successful execution,
authority or permission.

## Start here

- **If you want the plain-language version:** open the
  [visitor overview](https://thedarknitefalls.github.io/detecting-ai-deception/),
  then compare your answer with the
  [six synthetic practice cases](https://thedarknitefalls.github.io/detecting-ai-deception/cases/).
- **If you review claims or citations:** use the
  [complete method](https://thedarknitefalls.github.io/detecting-ai-deception/method/)
  and inspect the claim, required evidence, observed record, source revision,
  limitations and non-claims on each case page.
- **If you want to reproduce or challenge the work:** run the local checker,
  inspect the machine-readable records, or use a
  [public-safe challenge route](https://thedarknitefalls.github.io/detecting-ai-deception/challenge/).

## Six synthetic cases—not a benchmark

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

Requirements: Node.js 20 or newer. No dependency installation is required.

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

DAID is the public inquiry and visitor front door for this claim-and-evidence
method. Its [Tools](https://thedarknitefalls.github.io/detecting-ai-deception/tools/)
page links to supporting projects at exact reviewed revisions, each with a
narrow role and an explicit non-claim. Those tools do not individually prove
DAID's wider framing or make the connected workflow safe.

The broader
[Reliability Navigator route to DAID](https://thedarknitefalls.github.io/local-assistant-reliability-lab/?journey=bound_and_prove&problem=detecting-ai-deception&help_type=runnable_check&runtime=node&local=1&no_model=1&read_only=1&path=ground-model-output)
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
