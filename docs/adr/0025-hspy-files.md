---
title: "0025. HSPY files"
description: "Every spectrum has an HSPY file, which RosettaSciIO writes without HyperSpy."
adr:
  date: 2026-10-21
---

## Context

HyperSpy users want spectra with the metadata filled in. The Worker cannot write HDF5. The browser does not load HyperSpy or exSpy ([ADR 0003](/docs/adr/0003-small-browser-python-stack/)).

## Decision

- `review.write_hspy` in `python/eelsdb/review.py` writes the HSPY file. It uses RosettaSciIO's `hspy.file_writer`, h5py and a hand-built signal dictionary. It needs neither HyperSpy nor exSpy. It keeps non-uniform energy axes non-uniform.
- For new submissions, the moderator's browser writes the file at review ([ADR 0012](/docs/adr/0012-submission-and-moderation/)).
- `uv run python/hspy_files.py` writes a file for every seeded spectrum (290 migrated, 666 Corex). It uses the same function on the cached files. `data/fixtures/hspy.json` lists the files. `build_seed.py` adds the `files` rows and the R2 uploads. A second run gives identical bytes. When the cached files change, run `hspy_files.py` before `build_seed.py`.
- `package_info` names exSpy, which provides `EELSSpectrum`. If `package_info` names another package, HyperSpy warns on load.
- `write_hspy` writes X-ray absorption spectra as plain signals with an "Energy" axis and no TEM block. HyperSpy has no XAS signal type.
- The "Use in HyperSpy" snippet loads the HSPY file when one exists. Otherwise it loads the MSA download. It adds `signal_type="EELS"` only for EELS spectra.
- The Worker makes the other download formats (`/spectra/{slug}/download/{msa|csv|json}`) on request from the stored MSA or text file. The JSON format is the API v2 record plus the data.

## Research

RosettaSciIO's writer with a hand-built dictionary produces a file that HyperSpy opens as `EELSSpectrum`.
