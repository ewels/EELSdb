---
title: "0023. Licences"
description: "Spectra are under ODbL 1.0 unless their record states another licence: CC0 for Corex, or a licence an admin agreed with the contributor."
adr:
  date: 2026-10-20
---

## Context

The old About page states the ODbL for all data and CC BY-SA 2.0 for the site. The old submit form asked contributors to agree to the ODbL. The old site stored no licence per spectrum.

## Decision

- `spectra.licence` holds an SPDX id.
- New submissions get `ODbL-1.0`. The submit form includes a licence agreement.
- A contributor who cannot publish under the ODbL contacts the administrators. An admin can then set another licence on their account: `CC-BY-4.0` or `CC0-1.0`. `users.licence` holds it, and empty means `ODbL-1.0`. The submit form and the drafts page then ask the person to agree to that licence, and their new spectra get it. A draft gets the licence when its owner submits it, because that is when they agree. Spectra they submitted before keep their licence. The change is logged and the person is told by email. The review page names a licence other than the ODbL.
- The list of licences an admin can choose is fixed in code (`LICENCES` in `worker/src/api/metadata.ts`). Each is an open licence that the EU vocabulary used by DCAT-AP names.
- Migrated spectra get `ODbL-1.0` at import, as the old site's About page, footer and submit form stated. Every spectrum therefore has a licence, and API v2 never returns `null` for it. The new site's footer names the ODbL "unless stated otherwise".
- Corex gas-phase spectra use `CC0-1.0`, because their source publishes them under that licence ([ADR 0024](/docs/adr/0024-scope-gas-phase-and-xas/)).
- Every format that carries metadata states the licence per spectrum. These formats are API v2, OAI-PMH, DCAT-AP, schema.org, the bulk download README and any mirror.

## Consequences

- A DOI backfill for legacy spectra ([ADR 0006](/docs/adr/0006-no-hard-external-dependencies/)) waits until someone confirms their licence and authorship.

## Alternatives considered

- A licence field per spectrum on the edit page, for moderators. A contributor who cannot agree to the ODbL could still not submit, because the form needs the agreement first; a moderator would change the licence only after the person had agreed to the ODbL.
- A free choice of licence on the submit form. Most contributors would then pick without a reason, and EELSdb would hold data under many licences, which makes the bulk download harder to reuse.

- Leave `licence` empty for migrated spectra and read an empty value as ODbL 1.0. Every consumer would then have to know that rule, and API v2 would return `null` for a licence that is known.
