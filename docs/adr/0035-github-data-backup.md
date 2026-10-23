---
title: "0035. GitHub data backup"
description: "A GitHub repository holds a copy of every published spectrum as plain files."
adr:
  date: 2026-10-22
  implemented: "no"
---

## Context

- Data authors want to know that their spectra are safe for the long term, independent of one hosting account. The Corex author asked for this after his university host became reachable only on campus ([ADR 0024](/docs/adr/0024-scope-gas-phase-and-xas/)).
- `python/export.py` builds the bulk download from API v2. An admin uploads it by hand ([ADR 0027](/docs/adr/0027-bulk-download/)).
- EELSdb must not depend on GitHub or any other outside service ([ADR 0006](/docs/adr/0006-no-hard-external-dependencies/)). A backup can only be an extra.
- The published data is small: about 8 MB of migrated spectra plus about 14 MB of Corex. EELSdb does not store large files ([ADR 0014](/docs/adr/0014-extracted-spectra-only/)).

## Decision

- An `eelsdb` GitHub organisation holds the website repository and a second repository. The second repository holds full copies of all published spectra.
- A daily GitHub Actions job exports from API v2. It commits only when spectra were added, updated or removed. Uploads are infrequent, so most days produce no commit.
- The data repository holds only data files and metadata files. It has no zips or Releases. GitHub already offers any repository as a zip download. Individual files keep the repository small, because a daily commit holds only the spectra that changed. A new zip each day would store the whole dataset again.
- The data repository follows these rules:
  - The data repository is a read-only mirror, and the site stays the source of truth. Pull requests to the data repository would split the source of truth.
  - Each spectrum has one folder (`spectra/<id>-<slug>/`) with the original file, the MSA and `metadata.json`.
  - Each spectrum records its licence ([ADR 0023](/docs/adr/0023-licences/)). The repository also has a README and `CITATION.cff`.
  - The repository has no large files. GitHub blocks files over 100 MB and recommends repositories under 1–5 GB.
  - Git history keeps spectra that the site later removes. The submit form tells contributors this.

## Consequences

- Software Heritage archives public repositories automatically, so the data gets an independent long-term copy.
- GitHub's zip download of the data repository offers the same data as the bulk download ([ADR 0027](/docs/adr/0027-bulk-download/)).
