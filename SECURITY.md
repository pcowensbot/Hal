# Security Policy

## Reporting a vulnerability

**Please do not open a public issue or pull request for a security
vulnerability.** HAL instances hold people's chat history, credentials, and
API keys — a public report puts every deployment at risk before a fix exists.

Report privately to: **fphillips@pcowens.com**

Include what you'd include in a good bug report (HAL version, install path,
reproduction steps) plus your assessment of impact. You'll get an
acknowledgement, and credit in the release notes when the fix ships unless you
prefer otherwise.

## Scope

- The HAL server (`server/`), web client (`client/`), installers, and the
  Chrome import extension.
- The GPU broker and `/v1` OpenAI-compatible proxy surfaces.

Ollama, PostgreSQL, Redis, and other dependencies have their own security
processes — report issues in those upstream, though a heads-up is welcome if
HAL's default configuration makes an upstream issue worse.

## Bug bounty

There is no bug bounty yet. One is planned, funded by commercial licence
revenue (see [LICENSING.md](LICENSING.md)), once the project has the capacity
to triage reports properly — a bounty without triage capacity buries a small
maintainer team in automated, low-quality reports and helps nobody.
