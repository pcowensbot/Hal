# Contributing to HAL


Issues and pull requests are welcome. HAL is a single-server AI platform with a
deliberately boring stack — Node/Express, PostgreSQL, Redis, React — and
contributions that keep it boring are the most valuable kind.

## Before your first pull request: sign the CLA

HAL requires a signed [Contributor Licence Agreement](CLA.md). A bot comments
on your first PR with a link; signing takes a moment and covers everything you
contribute afterwards.

**Why, honestly:** HAL is dual-licensed — free under AGPL-3.0, with a paid
commercial licence for organisations that can't use AGPL (see
[LICENSING.md](LICENSING.md)). That only works if the project can license the
entire codebase under both sets of terms. Without a CLA, contributed code is
AGPL-only forever, and every commercial licence would have to carve it out or
the contribution would have to be rewritten.

**What it does not mean.** You keep the copyright in your work — the CLA is a
licence grant, not an assignment, and you remain free to use your own
contributions anywhere else. And it is not groundwork for taking HAL closed:
every release is AGPL-3.0 and remains so. Nothing in the CLA permits an
existing release to be retroactively closed, and the AGPL option is not going
away.

If you'd rather not sign, that's entirely reasonable — please still open the
issue. A well-described bug is worth more than most patches.

## Dependencies: permissive licences only

**New dependencies must be MIT, Apache-2.0, ISC, BSD, 0BSD, or similarly
permissive. No GPL, AGPL, LGPL, MPL, EPL, CDDL, or SSPL.**

This isn't licence snobbery. A single copyleft dependency would make the
commercial licence undeliverable for every release after it — the project can
relicense its own code, but not a third party's. HAL's tree is currently 100%
permissive across all 640 packages, and keeping it that way costs nothing as
long as it's checked at PR time rather than discovered later.

If the only library that does the job is copyleft, raise it in an issue before
writing the code. There's usually an alternative; occasionally the feature is
better served by shelling out to a separate process, which doesn't propagate
the licence.

Also: prefer fewer dependencies. Every one is a supply-chain surface on a box
holding people's chat history.

## Security issues

**Please do not open a public issue or PR for a security vulnerability.** See
[SECURITY.md](SECURITY.md) for the private disclosure address.

There is no bug bounty yet. One is planned, funded by commercial licence
revenue, once the project can triage reports properly — a bounty without triage
capacity buries a small maintainer team in low-quality and automated reports
and helps nobody.

## Development setup

Both installation paths work as dev environments:

```bash
./install.sh              # Docker: everything in containers
./install-baremetal.sh    # Native: PostgreSQL/Redis/Node/Ollama under systemd + PM2
```

See [docs/install-docker.md](docs/install-docker.md) and
[docs/install-baremetal.md](docs/install-baremetal.md) for doing it by hand.
Server config lives in `server/.env` (bare metal) or `.env` beside
`docker-compose.yml` (Docker); `server/.env.example` documents the full surface.

## What makes a pull request easy to merge

- **One thing at a time.** A focused diff gets reviewed; a 40-file refactor
  bundled with a bugfix does not.
- **Say what you tested, and on what.** HAL is validated on Ubuntu 22.04,
  24.04 and 26.04, both installers. If your change touches installation,
  driver detection, or the database, say which of those you actually ran —
  "should work" is the phrase that precedes most of this project's bugs.
- **Migrations are one-way in the wild.** People run HAL on their own data.
  A migration that loses a column loses somebody's chat history.
- **Match the surrounding code.** No reformatting passes mixed into
  functional changes.
- **Update the docs in the same PR** if you changed behaviour a user sees.

## Reporting bugs

Include: what you expected, what happened, HAL version, OS and version,
install path (Docker or bare metal), GPU and driver version if inference is
involved, and the relevant logs (`docker compose logs hal`, or
`pm2 logs hal` / `journalctl -u ollama`).

**If it involves a pre-Turing GPU** (Pascal or Volta — GTX 10-series, P100,
V100, Titan V), read the *Older GPUs* section of [docs/models.md](docs/models.md)
first. Stock Ollama ≥ 0.30 dropped those cards, and the resulting symptom —
everything looks healthy, inference silently runs on CPU — accounts for a
disproportionate share of "HAL is slow" reports.
