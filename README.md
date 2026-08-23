# Detecting AI Deception

**When AI systems overstate, omit, or misrepresent what they have done—and how
evidence can expose the difference.**

This is a public investigation led by Mike Parsons and developed transparently
with AI assistance. It is not a claim that every incorrect AI output is an
intentional lie. Version one compares observable claims with observable
evidence and records intent as `not-assessed`.

The repository contains a static public site, six synthetic teaching cases and
a dependency-free classifier shared by the browser and Node.js checker. It has
no live model, backend, account, analytics, cookies or submitted data.

## Start here

Requirements: Node.js 20 or newer. No dependency installation is required.

```sh
node tools/check-cases.mjs --self-test
npm test
npm run check
```

To inspect the built site locally:

```sh
npm run build
python3 -m http.server --bind localhost 8080 --directory dist
```

Then open `http://localhost:8080/`.

## What the site contains

- `/` — a sixty-second explanation and introductory choose-then-reveal case.
- `/cases/` — a filterable library of six synthetic cases.
- `/cases/<case-id>/` — permanent evidence pages.
- `/method/` — finding taxonomy, deterministic rule and limitations.
- `/tools/` — curated exact-revision routes to deeper public tools.
- `/challenge/` — reproduction command and public-safe issue routes.
- `/about/` — motivation, principles and AI-assistance disclosure.

The complete scenario, evidence trail, finding, sources and non-claims remain
readable without JavaScript. JavaScript adds filters and the choose-then-reveal
interaction. Filter state may be represented in the URL; nothing is stored or
sent.

## Findings, not intent

The pure classifier in [`src/classifier.mjs`](src/classifier.mjs) applies one
rule to declared required evidence:

1. any contradictory required observation → `contradicted`;
2. otherwise any absent, unknown, stale or inapplicable required observation →
   `insufficient-evidence`;
3. otherwise every required observation supports the claim → `supported`.

Every record in [`data/deception-cases.v1.json`](data/deception-cases.v1.json)
uses `intent_assessment: not-assessed`. A claim/evidence mismatch does not, by
itself, establish consciousness, malicious intent, strategic scheming,
universal safety failure, certification or a deception score.

## Machine-readable contract

- JSON Schema: [`schemas/deception-case-v1.schema.json`](schemas/deception-case-v1.schema.json)
- Six-case pack: [`data/deception-cases.v1.json`](data/deception-cases.v1.json)
- Curated public source map: [`data/source-map.v1.json`](data/source-map.v1.json)
- Stable checker output schema: `detecting_ai_deception_case_check_v1`
- Known-bad fixtures: [`fixtures/known-bad/`](fixtures/known-bad/)

Each case answers five questions: what happened, why it matters, how we know,
what remains unknown and what someone can do next. It then names the exact
claim, required evidence, observed evidence, source revision, runnable check,
limitations and non-claims.

## Deterministic build

`npm run check` builds the complete site three times—once to `dist/` and twice
in isolated temporary directories—and requires identical manifests and
digests. `npm run check:http` separately serves all public routes on an
ephemeral loopback-only HTTP listener and requires meaningful 200 responses.
The committed/generated publication surface includes semantic HTML,
unique metadata, canonical and Open Graph URLs, conservative structured data,
`robots.txt`, `sitemap.xml`, a favicon and a file-by-file build manifest.

## Source boundaries

The cases cite accepted public revisions of EvidenceGate, Local Model
Reliability Example, Context Boundary Examples, Agent Evidence Catalog, Agent
Action Authority Examples and Reliability Navigator. This repository links to
those exact public revisions; it does not copy their code or silently extend
their claims. See [`data/source-map.v1.json`](data/source-map.v1.json) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Licensing

- Software-oriented files are Apache-2.0: JavaScript, CSS, build/check scripts,
  schemas, tests and workflows.
- Original prose, case narratives, synthetic case data and teaching assets are
  CC BY 4.0.
- Linked third-party names, marks and repository contents retain their original
  rights and licenses.

See [`LICENSING.md`](LICENSING.md), [`LICENSE`](LICENSE),
[`LICENSE-CONTENT`](LICENSE-CONTENT), [`NOTICE`](NOTICE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Contributing and security

New cases are issue-first. Use the structured issue templates and replace any
private or sensitive evidence with the smallest synthetic reproduction. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

## Recommended GitHub topics

If this repository is later created publicly, suitable discovery topics are:

`ai-evaluation`, `evidence`, `ai-safety`, `responsible-ai`, `provenance`,
`static-site`, `synthetic-data`, `reproducibility`.

These are recommendations only; this repository does not claim GitHub search
placement, indexing or ranking.
