---
title: "0000. Recording decisions"
description: "How we write and accept architecture decision records."
adr:
  date: 2026-10-23
---

## Context

Many choices in EELSdb are not visible in the code. Examples are why there is no server-side Python, why API v1 must not change and why EELSdb refuses spectrum images. If nobody writes down the reasons, a later developer can undo a decision or repeat research that we already did.

## Decision

We keep architecture decision records (ADRs) in `docs/adr/`. Each decision has one Markdown file, and the files have numbers in order.

Each record has these parts:

- A date, which is the date when we first made the decision.
- If the code does not yet do what the record decides, `implemented: "no"` or `implemented: partly` under `adr` in the front matter. Say what is missing in the record. Remove the field when the work is done.
- A Context section, which gives the problem and the forces on it.
- A Decision section, which states what we do.
- A Consequences section, which gives the results, good and bad.
- An Alternatives considered section, which gives what we did not do, and why.
- Optionally, a Research section with measurements and external facts.

To propose a decision, or a change to one, open a pull request that adds or edits a record. Merge the pull request when the decision is accepted. Every record in `docs/adr/` is therefore an accepted decision.

Follow these rules when you write a record:

- Record decisions that a future developer could get wrong, or would want to change. Do not record UI copy, the colours of single buttons or routine fixes.
- Keep research results and measurements. They cost the most to repeat.
- Describe the decision as it is now. Do not tell the history, such as what we built first, what replaced it or on which day. Git has the history.
- Put an option that we tried or proposed, and that lost, under "Alternatives considered". Give the reason it lost, so that nobody proposes it again without new facts.
- When a decision changes, rewrite the record to describe the new decision. If the reason the old decision lost is useful, move the old decision to "Alternatives considered".
- Never put personal data in an ADR. This includes email addresses and details about individual accounts. Aggregate counts are fine.
- Put implementation detail that belongs next to the code in code comments, `README.md`, `DESIGN.md` or the docs site. `DESIGN.md` and `PRODUCT.md` are the source for visual design and product voice.
