---
title: "0033. Visual design"
description: "The colour, type, logo and layout choices that the code depends on."
adr:
  date: 2026-10-20
---

## Context

`DESIGN.md` is the source for the design system. Its sidecar is `.impeccable/design.json`. `PRODUCT.md` is the source for the product voice. This record gives only the choices that code depends on, and the reasons for them.

## Decision

### Colour

- `worker/public/tokens.css` defines the colour roles as tokens: `--accent`, `--plot`, `--edge`, `--compare-1…4` and the type colours. The tokens use `light-dark()`.
- The accent is slate blue. The project owner found the logo red too harsh as an interface colour.
- The logo's red and ochre (`--logo-red`, `--logo-ochre`) appear only in the logo.
- In light mode, the type colours are blue (core loss), amber (low loss), green (XAS) and grey (zero loss). Each has a different lightness, and each has a contrast of at least 3:1 against the page.

### Typeface

- The site uses Mona Sans everywhere. It is a variable font, and the site hosts it. The page and the logo lettering use the same family.
- Code and DOIs use `ui-monospace`.
- Mona Sans has a slashed zero in tabular figures.

### Logo

- The logo shows "EELSdb" in Mona Sans on the flat tail of the two traces. "EELS" uses weight 800 and "db" uses 400. The logo does not include "Data Base".
- The weights are not 700/300, because a 300 "db" is too thin at header size.
- In the compact logo, the lettering sits further right on longer tails. The first E then clears the last bump of the ochre trace.
- The logo-file generator keeps its own copy of the geometry. Update it together with `logo.ts`.

### Homepage

The homepage is for rare, non-technical visitors. It is therefore not search-first, and it must need no learning. It contains these parts:

- an intro with two buttons (browse, share)
- ways in, next to six random example spectra
- the periodic table with type filters
- contributors
- loading in Python
- how to cite.

The homepage shows real data and no filler.

### Header

- The header is sticky.
- Below 1000 px, the header uses a burger menu. We measured that the row wraps just under 950 px.
- The About menu opens on click, never on hover.
- The docs header matches ([ADR 0005](/docs/adr/0005-docs-astro-starlight/)).

### Controls

- Controls have 4 px corners. Code blocks, tiles and tooltips have 6 px corners.
- An outline-only secondary button looks smaller than a solid primary button of the same size. Secondary buttons therefore have a `--sunken` fill and a visible border.

### Font smoothing

Both sites use antialiased font smoothing. Starlight sets it, and the owner found it more legible.

## Consequences

- `p, li { max-width: 72ch }` limits the width of full-width boxes. Use `max-width: none` to override it.
- `.impeccable/design.json` drifts from `DESIGN.md`. After design changes, regenerate it with the skill's `document` command.
- These gaps are known:
  - The site has two different "selected" styles.
  - Input styles are repeated, and their radii drift.
  - The danger red and the edge ochre are too close to the logo colours.
