---
title: "0030. Browse page"
description: "The browse page uses the API v2 query, updates results live and caches thumbnails in D1."
adr:
  date: 2026-10-21
---

## Context

Visitors are often not technical, visit rarely and may not know what they want. We researched what they check in a list of spectra. In order, they check:

1. edge coverage
2. how the spectrum looks
3. quality (resolution, monochromated)
4. material
5. author and source.

Beam energy helps to choose between near-duplicates. The date added rarely decides anything.

## Decision

### Query

The browse page uses API v2's query (`spectraFilter` / `listSpectra`) and its parameter names. A browse address is therefore a v2 query ([ADR 0009](/docs/adr/0009-api-v2/)). The page still reads older links (`element[]`, `type[]`, `title`, `complete=1`). If a filter is one that v2 would reject, the page drops it and names it. It does not show an error page.

### Rows

- Each row shows a trace thumbnail, the title and formula, the edges, an energy range bar, the resolution and the beam energy.
- The rows have no type or date column, because people do not check these first.
- Below 560 px, a row shows only the thumbnail and the title.
- Gas-phase rows show "Gas phase".

### Thumbnails

- The Worker stores thumbnails in two `spectra` columns.
- The Worker builds a thumbnail from the R2 file on the first view. It builds it again when the file changes. Submit and moderation code therefore do not need to know about thumbnails.
- The Worker builds at most 40 thumbnails per request, because of Cloudflare's per-request subrequest limit. A page shows 50, so a fresh database lacks a few thumbnails for a short time.
- A cold fill took 78 ms locally.
- The Worker builds thumbnails from the legacy, MSA or original file, never from a variant.

### Filters

- Type and phase use toggle chips. If all chips are on or all are off, the page sends no filter.
- Energy range and resolution use log-scale histogram sliders. The histograms show all published spectra.
- Elements and authors use type-ahead multi-selects with chips. The input picks the words before a space, comma or semicolon, so "Fe, O" works.
- An "updated since" filter is available.
- The sorts include "recently updated".

### Live results

- The page replaces only the results section, so text focus and scroll position stay.
- Chips update the results at once. Sliders update them on release. Text updates them after 400 ms.
- A new change cancels any request that is in progress.
- The page updates the URL, so a link shares the view and the back button works.
- Without JavaScript, the page shows the Apply button and plain fields.

## Consequences

- The "includes energy" filter has no control when JavaScript is on. It still works from the URL.
- Test helpers that count results must read `role="status"`. A datalist's "N spectra" text matched first.

## Alternatives considered

- A gallery of plots. It hides the facts that people check first (edges, range, resolution).
- Grouped views, by material or by edge. Grouping by formula is rough. About half the materials have one spectrum. Spectra with several edges would appear more than once.
- A list with preview and compare. Compare is on the spectrum page instead ([ADR 0029](/docs/adr/0029-spectrum-page-tools/)).
- A periodic-table element filter in the sidebar. It is too small to use. The periodic table stays on the homepage.
