# Contributing

Thank you for helping make a claim-and-evidence record more accurate,
reproducible or accessible.

## Start with an issue

New cases and material changes are issue-first. Choose the structured template
for a reproduction, counterexample, new synthetic case or accessibility/site
defect. A useful report answers:

1. What happened?
2. Why does it matter?
3. How do we know?
4. What remains unknown?
5. What can someone do next?

Then include the smallest exact command, public-safe synthetic input, observed
output, source revision and limitation needed to reproduce the result.

## Public-safety boundary

Do not submit:

- credentials, tokens, recovery material or private URLs;
- private logs, connector exports or personal data;
- unpublished source material or confidential model interactions;
- sensitive vulnerability detail that could put people or systems at risk;
- allegations about a person or system's intent.

Replace real records with the smallest synthetic reproduction. For sensitive
security reports, follow [`SECURITY.md`](SECURITY.md) instead of opening a
public issue.

## Case requirements

Cases must use `deception_case_v1`, keep `intent_assessment` at `not-assessed`,
name every required observation, cite exact public source revisions and state
limitations and non-claims. Run:

```sh
node tools/check-cases.mjs --self-test
npm test
npm run check
```

Do not add a live model call, backend, tracking, account, persistence,
certification, ranking or deception score.

## Licensing

By contributing software-oriented material, you agree that it may be licensed
under Apache-2.0. By contributing original prose, synthetic cases or teaching
content, you agree that it may be licensed under CC BY 4.0. Identify any
third-party material and confirm that it can be shared.
