---
title: "0014. Extracted spectra only"
description: "EELSdb keeps single extracted spectra and refuses spectrum images and other large files."
adr:
  date: 2026-10-21
---

## Context

Contributors sometimes have spectrum images, which are data cubes from STEM-EELS mapping. Some also have raw STXM image stacks, slide decks and other attachments.

## Decision

- EELSdb stores single spectra. EELSdb does not accept spectrum images. The reader records the grid as `navigation_shape`. `checks.check_spectrum_image` then reports an error in the browser and at review, and asks the contributor to extract one spectrum.
- EELSdb keeps no large files anywhere: not in R2, git, the bulk download or any mirror. Raw STXM stacks (`.hdr`, `.xim`, `.xsp`), slide decks and similar files stay in the contributor's own archive. EELSdb keeps only the extracted spectrum as text, MSA or HSPY.

## Reasons

- Cubes are very large, often GBs. A scanned area is rarely homogeneous enough to be a reference spectrum.
- If EELSdb stored cubes, it would become general data storage.
- The platform sets practical limits:
  - Worker request bodies have a cap of about 100 MB, so cubes would need multipart R2 uploads.
  - The R2 free tier is 10 GB.
  - The upload limit is 50 MB per file.
- Small files keep the site, the bulk download and the GitHub backup ([ADR 0035](/docs/adr/0035-github-data-backup/)) easy to copy and archive.

## Consequences


## Alternatives considered

- Store cubes, record the grid and plot the sum. We rejected this for the reasons above.
- Offer raw data as `companion` downloads or as GitHub Release assets. The site could not display them anyway.
- Use an AWS Open Data registry for large data. This would take EELSdb beyond its purpose, and the current data is tiny.
