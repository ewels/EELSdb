---
title: "0024. Gas phase and X-ray data"
description: "EELSdb includes gas-phase EELS and soft X-ray absorption spectra, and links to other sites for hard X-ray data."
adr:
  date: 2026-10-14
---

## Context

Adam Hitchcock's Corex database holds gas-phase inner-shell EELS spectra. These are not X-ray spectra. The spectra have an absolute oscillator-strength scale and energies to about ±0.1 eV. The university host of Corex became reachable only on campus. A copy is on Borealis under CC0. The copy has about 682 files and about 25 MB.

He also offered more than 500 soft X-ray (STXM) absorption spectra of solids. He has verified only some of them. He raised three concerns: safe long-term hosting, whether HyperSpy can read the formats, and "text is always best".

XASLIB, the CLS XASDB, NIMS, SSHADE and Materials Project already cover hard X-ray XANES/EXAFS.

## Decision

- EELSdb imports Corex. This adds 666 measured spectra to the 290 migrated ones.
  - The source is the zip that the author sent on 2026-10-22. We do not use the Borealis copy (version 1, August 2025), because it predates his September 2025 revisions.
  - `python/corex.py <zip>` writes `data/fixtures/corex.json`. This file is committed and is about 0.8 MB. The script also writes these files under `data/cache/files/files/<id>/`:
    - the original `.os` file, with role `original`
    - an MSA of the raw counts, with role `msa` (the plotted file)
    - one MSA per processed version, as variants ([ADR 0015](/docs/adr/0015-processed-versions-as-variants/)).
  - IDs start at 30001. A re-import keeps the IDs and slugs (`<name>-<edges>-gas`) from the previous fixture.
  - The 14 `aaa-*` files are calculated atomic photoabsorption curves, not measurements. The import leaves them out.
  - The import sets this metadata:
    - The author is "Adam Hitchcock", as a display name with no account.
    - The licence is CC0-1.0.
    - The keyword is "Corex".
    - The beam energy and angles are unknown, because the spectra use constant residual energy mode.
    - The resolution comes from the "fwhm" in the acquisition mode.
- The website and API v2 list gas-phase spectra by default. API v1 shows them only with `phase=gas` ([ADR 0008](/docs/adr/0008-api-v1-frozen-contract/)).
- EELSdb accepts soft X-ray absorption spectra (NEXAFS/STXM, up to about 3 keV). We start with a small batch that the author has verified. The pace depends on the time he has for checking. `.xas` text files need a second small parser.
- EELSdb links out to other databases for hard X-ray spectra.
- The name stays "EELS Data Base".
- EELSdb accepts only extracted spectra and no raw stacks ([ADR 0014](/docs/adr/0014-extracted-spectra-only/)).

## Research: the Corex files

- The set has 680 files, 293 distinct formulas and 24 elements. 527 files cite a reference and 153 are unpublished.
- Each file has a `*` header of about 12 fields, then data. 654 files have 3 columns, 25 have 4 and 1 has 2.
- The column labels are unreliable, so the parser uses the column count:
  - 2 columns hold raw data.
  - 3 columns hold raw data and oscillator strength.
  - 4 columns hold two (E, y) pairs on different grids when the labels name two energy columns. Otherwise they hold raw data, impurity-removed raw data and oscillator strength (or raw data, oscillator strength and smoothed data).
- The files have these quirks:
  - upper-case `.OS` extensions (60 files) and upper-case header keys (13 files)
  - an extra `x  3y  1y` row in some files
  - comma separators in a few files
  - a header typo (`Alpha Form la`)
  - edges written three ways (`C 1s`, `C1s`, and `01s` with a zero).
- Six headers name the wrong edge for their file name and energy range. For example, one header says C 1s but the file covers Si 2p at 96–199 eV. `EDGE_FIXES` corrects these six.
- We report source errors back to the author and do not fix them here. Examples are a wrong formula, missing commas in names and typos.

## Research: tools for X-ray absorption and STXM data

- RosettaSciIO 0.15.0 has no STXM, XAS, XDI or generic column-text reader. exSpy has no XAS signal type.
- We wrote a small XDI reader for EELSdb. XDI headers can exceed 4 kB, so the reader detects them by the `# XDI` line.
- aXis2000 is the author's tool. It is written in IDL and has only a GUI, with no scripting. It cannot become WebAssembly.
- MANTiS needs PyQt5, so it cannot run in Pyodide. Its `file_sdf.py` reader would run in Pyodide. That reader has 326 lines and uses `json`, `re` and numpy. It is GPL-3.0 like RosettaSciIO, so the clean route is to port it to RosettaSciIO.
- Larch reads XDI but has more than 30 dependencies. It failed to import on Python 3.14.
- The HyperSpy community has almost no discussion of XAS or STXM. Related issues are hyperspy#110 (non-uniform axes, since added) and exspy#68 and #126 (closed).
- We concluded that EELSdb parses these text files itself, keeps the originals and serves MSA and HSPY. An XAS signal type in exSpy and an XDI reader in RosettaSciIO would be joint projects. Both are optional.

## Consequences

- A fresh checkout must run `uv run python/corex.py <zip>` before `npm run seed` to rebuild the Corex files. Git does not contain the zip or the files.
- If more than 500 X-ray spectra arrive, EELS spectra become a minority of the database. The name "EELS Data Base" then fits less well.
- We did not check these sources: NIST NEXAFS, the Diamond and ALS libraries, NOMAD, the Ritsumeikan database and X-ray Atlas.
