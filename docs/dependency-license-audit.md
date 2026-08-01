# HAL — dependency licence audit

**Question being answered:** can HAL sell a commercial licence exception at all?
You can only relicense code you control. Any GPL/AGPL/LGPL dependency in the
tree would make a commercial exception defective no matter what the CLA says.

**Date:** 2026-08-01 · **Scanned:** `~/hal-pub` on .181 (root, `server/`,
`client/`, `extension/`) · **Method:** walked every package root under each
`node_modules` and read the declared `license` field from `package.json`.
Includes devDependencies, so the result is conservative — it covers more
packages than are actually shipped.

## Result: clean

| Count | Licence |
|-------|---------|
| 531 | MIT |
| 37 | Apache-2.0 |
| 36 | ISC |
| 23 | BSD-2-Clause |
| 7 | BSD-3-Clause |
| 2 | Python-2.0 |
| 2 | BlueOak-1.0.0 |
| 1 | 0BSD |
| 1 | CC-BY-4.0 |
| **640** | **total** |

- **Copyleft / reciprocal (GPL, AGPL, LGPL, MPL, EPL, CDDL, SSPL, CC-BY-SA,
  OSL, EUPL, CPAL): NONE.**
- **Undeclared licences: NONE.** Every one of the 640 packages declares.

The three non-MIT-family entries, all benign:

| Package | Licence | Assessment |
|---|---|---|
| `minimatch` | BlueOak-1.0.0 | Permissive, plain-language licence. No reciprocal obligation. |
| `argparse` | Python-2.0 | Permissive, GPL-compatible. No reciprocal obligation. |
| `caniuse-lite` | CC-BY-4.0 | **Attribution**, not share-alike. Build-time browser-compat data. Requires credit if redistributed; imposes no licence terms on HAL. |

**Conclusion: nothing in the dependency tree blocks dual licensing.** A
commercial exception covering HAL's own source is grantable, provided the CLA
is in place for contributed code.

## Two things this audit does *not* cover

1. **The service containers.** `docker-compose.yml` references
   `postgres:16-alpine`, `redis:7-alpine` and `ollama/ollama:latest`. HAL does
   not redistribute these — users pull them from Docker Hub — and HAL talks to
   all three over network sockets rather than linking them, so their licences
   don't propagate to HAL. Worth knowing anyway: **Redis changed licence at
   7.4** (RSALv2/SSPL dual, no longer BSD). It doesn't affect HAL's position,
   but pinning `redis:7-alpine` will eventually resolve to a non-open-source
   image and someone will eventually ask about it.
2. **Vendored or copy-pasted code.** A licence scan reads package metadata. It
   cannot see a snippet pasted in from Stack Overflow or another project. That
   is a human review, and it only matters for code written before the CLA
   exists.

## Keeping it clean

This result is a snapshot. It stays true only if new dependencies are held to
the same standard — see the dependency rule in `CONTRIBUTING.md`. A single
GPL/LGPL dependency added in six months' time quietly breaks the commercial
licence for every version after it.

Re-run before any commercial licence is signed.
