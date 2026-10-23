---
title: "0036. Share cards"
description: "The Worker draws each public page's share image from the page's own data, as SVG turned into PNG with resvg."
adr:
  date: 2026-10-23
  implemented: "yes"
---

## Context

- Links to EELSdb are shared in chat, email and social posts. Those services show the page's `og:image`, and without one a link shows as plain text or a cropped logo.
- The pages people share most are spectra and author pages. Both change: new spectra are published from the web form at any time ([ADR 0012](/docs/adr/0012-submission-and-moderation/)), and authors choose what their page shows ([ADR 0031](/docs/adr/0031-public-profiles-and-privacy/)).
- Social services accept PNG or JPEG, not SVG. They fetch the image once and keep their own copy.
- The site shows real data, never placeholder curves ([ADR 0033](/docs/adr/0033-visual-design/)).

## Decision

- Every page sets `og:image` (1200 × 630) and `twitter:card`. The images are served at `/og/…png` by the Worker (`worker/src/og/`):
  - `/og/spectra/{slug}.png`: the title, the typeset formula, the type, the energy range and the real spectrum, drawn full width with its major edges marked, credited to the contributor. A low-loss plot is scaled to the loss region, so the zero-loss peak runs off the top.
  - `/og/author/{slug}.png`: the name, the spectrum count, job title and affiliation only when the author shows them, and up to three of their spectra.
  - `/og/site.png`: the homepage, and every page with no card of its own (sign-in, account, submit, admin). It shows the large logo, the counts and the periodic table shaded by spectra per element.
  - `/og/page/{name}.png` for browse, bulk download, moderators, news and contact; `/og/news/{slug}.png` for news posts; `/og/docs/{path}.png` for every docs page. These are a title and description beside a waterfall of real core-loss spectra from the database. Docs cards read the title and description from the built page.
- A card is an SVG string built from D1 and R2, rasterised by `@resvg/resvg-wasm`. Text is set in static Mona Sans weights made by `python/og_fonts.py`, which merges in Greek and maths signs from Noto Sans. Text is wrapped with the fonts' advance widths, because SVG cannot wrap.
- Responses are cached at the edge with the Cache API for a day. A card takes about 20–100 ms to draw. `VERSION` in `og/index.ts` is part of the cache key; change it when the design changes.
- Cards use the light palette only. They are seen in feeds of both themes, and the light paper is the site's default.
- An unpublished spectrum, an author without a public page, or an unknown name returns 404, so a card never shows something its page would not.

## Alternatives considered

- **One static logo image for every page.** The docs used this. It says nothing about the page, and every shared spectrum looks the same.
- **Pre-rendering cards with a script into R2.** No Worker dependency, but every new spectrum, author change or news post would need the script run again.
- **Drawing the card in the moderator's browser at approval.** This matches how processed files are made ([ADR 0012](/docs/adr/0012-submission-and-moderation/)), but it covers only spectra, and the result depends on the moderator's browser and fonts.
- **Satori (JSX to SVG) with resvg.** It adds flexbox layout and text wrapping, but a second dependency and its own CSS subset. The cards are simple enough to lay out by hand.
- **Cloudflare Browser Rendering.** A full browser for each card is slow, costs more, and needs an account feature.

## Consequences

- The Worker bundle grows by about 1.3 MB gzipped (resvg's wasm and five fonts). Workers Paid allows 10 MB.
- Changing a design token means changing the hex copy at the top of `og/cards.ts` too: resvg reads neither `light-dark()` nor `oklch()`.
- Changing the self-hosted Mona Sans means running `uv run python/og_fonts.py` again.
