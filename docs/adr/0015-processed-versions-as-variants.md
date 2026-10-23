---
title: "0015. Processed versions"
description: "Processed versions of a measurement are extra files on one spectrum, not separate spectra."
adr:
  date: 2026-10-21
---

## Context

The Corex gas-phase files ([ADR 0024](/docs/adr/0024-scope-gas-phase-and-xas/)) carry several versions of one measurement:

- Raw counts, with calibration and glitch removal only.
- Oscillator strength, derived with factors that users may want to change.
- In about 10% of files, also impurity-removed, raw-smoothed or oscillator-strength-smoothed versions.

A separate spectrum for each version would repeat all metadata five times.

## Decision

- Processed versions are `files` rows with role `variant` and a fixed code: `os`, `os_smoothed`, `smoothed`, `impurity_removed`.
- The spectrum's `intensity_units` describes the main file. The `os` variants are in oscillator strength.
- The spectrum page plots one version at a time, because their units differ. It lists the versions in the download dialog. API v2 lists them with their units. API v1 is unchanged.
- The site stores variants as uploaded and does not reprocess them at review.

## Consequences

- A contributor can add variants only with a new submission. Edits do not support them.
- The site does not read a combined file that holds several spectra. Support for one needs an example file of that format first.
- Browse thumbnails read the legacy, MSA or original file. They never read a variant or the metadata file.
