# Security policy

## Supported surface

The repository is a dependency-free static site and local checker. There is no
backend, account, submitted-data flow, analytics service or live model.

Security review should focus on the current `main` branch and the static assets
generated from it. Public case disagreements, content corrections and
accessibility defects belong in the structured issue templates, not in a
security report.

## Reporting a vulnerability

Do not post credentials, personal data, private logs, unpublished material or
sensitive exploit detail in a public issue. Use GitHub's private vulnerability
reporting feature for this repository when it is available. If no private
reporting route is available, do not publish the sensitive details; open a
minimal public issue stating that a private contact route is needed.

Include the affected revision, path, impact, smallest safe reproduction and any
known mitigation. Replace real data with synthetic placeholders.

## What not to send

This project cannot accept private model conversations, confidential system
prompts, account exports, access tokens, personal information or claims about
intent. A security report is not permission to test a third-party system.
