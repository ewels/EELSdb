---
title: "0023. Licences"
description: "Spectra are under ODbL 1.0 unless their record states another licence, such as CC0 for Corex."
adr:
  date: 2026-10-20
---

## Context

The old About page states the ODbL for all data and CC BY-SA 2.0 for the site. The old submit form asked contributors to agree to the ODbL. The old site stored no licence per spectrum.

## Decision

- `spectra.licence` holds an SPDX id.
- New submissions get `ODbL-1.0`. The submit form includes a licence agreement.
- Migrated spectra get `ODbL-1.0` at import, as the old site's About page, footer and submit form stated. Every spectrum therefore has a licence, and API v2 never returns `null` for it. The new site's footer names the ODbL "unless stated otherwise".
- Corex gas-phase spectra use `CC0-1.0`, because their source publishes them under that licence ([ADR 0024](/docs/adr/0024-scope-gas-phase-and-xas/)).
- Every format that carries metadata states the licence per spectrum. These formats are API v2, OAI-PMH, DCAT-AP, schema.org, the bulk download README and any mirror.

## Consequences

- A DOI backfill for legacy spectra ([ADR 0006](/docs/adr/0006-no-hard-external-dependencies/)) waits until someone confirms their licence and authorship.

## Alternatives considered

- Leave `licence` empty for migrated spectra and read an empty value as ODbL 1.0. Every consumer would then have to know that rule, and API v2 would return `null` for a licence that is known.
