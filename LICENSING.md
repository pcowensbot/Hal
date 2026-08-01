# Licensing


HAL is dual-licensed. Pick whichever fits you:

| | **AGPL-3.0** | **Commercial licence** |
|---|---|---|
| Cost | Free | Paid |
| Run it yourself, at home or at work | ✅ | ✅ |
| Modify it | ✅ | ✅ |
| Must publish your modifications | **Yes**, if you distribute it or offer it as a network service | No |
| Embed it in a closed-source product you ship | ❌ | ✅ |
| Offer it as a hosted service without publishing your changes | ❌ | ✅ |
| Use it where company policy forbids AGPL in the dependency tree | ❌ | ✅ |

## The free option: AGPL-3.0

This is the default. The full text is in [LICENSE](LICENSE).

**For almost everybody, this is the one you want, and it asks nothing of you.**
Download HAL, run it on your own hardware, modify it, use it at work, use it
commercially, serve your whole team with it — none of that triggers any
obligation. If you never hand HAL to anyone else, you have nothing to do.

The obligation begins when you pass it on:

- **If you distribute HAL** — modified or not — recipients get the source and
  the same AGPL rights.
- **If you run a modified HAL as a network service** that other people use,
  those users are entitled to your modified source, under AGPL-3.0. This is
  the clause (section 13) that separates AGPL from ordinary GPL, and it is
  deliberate: it closes the loophole where someone takes an open project,
  improves it privately, and sells the improvements as a service while
  contributing nothing back.

That is the whole deal. Improvements flow back to everyone.

## The paid option: commercial licence

Some people genuinely cannot use AGPL software. A commercial licence removes
the source-publication requirement, in exchange for supporting the project.

You probably need one if:

- You want to **ship HAL inside a proprietary product** without releasing your
  own source.
- You want to **offer HAL as a hosted or managed service** while keeping your
  modifications private.
- **Your organisation's policy prohibits AGPL** anywhere in the dependency
  tree — a common blanket rule, and a legitimate reason to need different
  terms even for purely internal use.

Terms are negotiated per case; the price for a small company running HAL
internally is not the price for a platform reselling it. Enquiries:
**<LICENSING-CONTACT-EMAIL>**.

## Where the money goes

Commercial licence revenue funds HAL's development and, once there's capacity
to triage reports properly, a security bug bounty. That's the entire purpose of
the commercial tier — it exists so the project has a funding model that isn't
donations, and so that organisations profiting from HAL are the ones paying for
it rather than the individuals self-hosting it.

Because that promise is easy to make and easy to quietly abandon, spending will
be published.

## Why the project is structured this way

Dual licensing only works if one party can license the whole codebase, which
means the project must hold the necessary rights to every contribution. That's
what the CLA in [CONTRIBUTING.md](CONTRIBUTING.md) is for, and it's the honest
reason it exists — not bureaucracy, and not a prelude to taking HAL closed.

The AGPL option is not a trial and will not be withdrawn. Every release is
AGPL-3.0 and stays AGPL-3.0; nothing here lets an existing release be
retroactively closed. The commercial licence is an *additional* option for
people the AGPL doesn't fit, not a replacement for it.

## Dependencies

HAL's dependency tree is entirely permissive (MIT, Apache-2.0, ISC, BSD,
0BSD, BlueOak, Python-2.0) with no copyleft or reciprocal licences, which is
what makes a commercial exception possible. New dependencies are held to that
standard — see `CONTRIBUTING.md`.

---

### Before you publish this

Placeholders to fill: **`<LICENSING-CONTACT-EMAIL>`**.

This document, `CONTRIBUTING.md` and `CLA.md` were drafted by an assistant, not
a lawyer. The dual-licence structure described here is a well-established
pattern (Qt, MySQL, iText and others have used it for decades), but the specific
wording of the CLA determines whether you actually acquire the rights you think
you do. Before the repo goes public — and certainly before selling anyone a
licence — have a solicitor with software-licensing experience review the CLA in
particular. That review is inexpensive next to discovering afterwards that a
commercial licence you sold was defective.
