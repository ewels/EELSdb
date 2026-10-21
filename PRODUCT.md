# Product

<!-- impeccable:product-schema 1 -->

Facts come from `docs/plan/` and the old site. The user descriptions under Users and Operating Context were inferred from the repo, the live site and the field, at Phil's request, and have not been confirmed one by one.

## Platform

web

## Users

- Electron microscopists: PhD students, postdocs, facility staff and professors in materials science, physics and chemistry, who use TEM/STEM instruments with EELS spectrometers. Their job is to find a reference spectrum for an element, edge or compound, compare its fine structure with their own measurement, and download it or load it in Python.
- Contributors: experimentalists who share published spectra. Many do not use Git or a terminal, so submitting, editing and moderating happen in web pages.
- HyperSpy users and other API clients (exSpy, pyTEMlib, hyperspyUI, NOMAD, course material), who load spectra from code through `api.eelsdb.eu`.
- Moderators, who review submissions in `/admin/` or with the `eelsdb` command-line tool.

## Product Purpose

The EELS Data Base (eelsdb.eu) is a free public database of reference spectra for electron energy-loss spectroscopy (EELS) and X-ray absorption spectroscopy (XAS). It has run since 2014, and in older forms since about 2005. The rebuild keeps every spectrum, URL and API query working, gives contributors a simple web interface, and needs almost no maintenance. Success: a visitor finds and downloads the right reference spectrum in seconds, contributors keep their accounts and credit, and `exspy.data.eelsdb()` returns the same results as before.

## Positioning

The community's own open reference collection for EELS, run by microscopists. It is built around the HyperSpy tools the field already uses. Its edge markers agree with exSpy, and it records where each acquisition value came from.

## Operating Context

- Used on lab and office desktops, often wide monitors, and sometimes in a darkened microscope room. Phone use is occasional.
- Visitors search by element, formula, edge (K, L2,3, M4,5 …), type, energy range and resolution, then plot, compare and download `.msa` files.
- Spectra are cited: each has its authors and often a paper reference, and the database itself is cited as Ewels et al., *Microscopy and Microanalysis* 22, 717–724 (2016).

## Capabilities and Constraints

- Spectrum types: core loss, low loss, zero loss and X-ray absorption. Gas-phase spectra (the Corex database) are planned.
- Sign-in with ORCID, Google or GitHub, plus migrated legacy accounts. Favourites, instrument profiles, a submission form with in-browser checks (Pyodide), moderation, API v1 (frozen contract) and API v2.
- Runs on Cloudflare Workers, D1 and R2, with no server to maintain. No hard dependency on Zenodo, GitHub or a HyperSpy release.
- Out of scope: forum, jobs board, comments on spectra, news editing (news is a frozen archive), and hard X-ray XANES/EXAFS as a focus.

## Brand Commitments

- Name: "EELS Data Base", also "EELSdb".
- Logo: two spectrum traces in red and ochre with the lettering "EELSdb" in Mona Sans ("EELS" bold, "db" regular) on their flat tail; the large version adds the tagline "Inner & Outer Shell Excitation Spectrum Repository" (`logo/`). The traces and their two colours are fixed.
- Voice: plain, precise and factual, in sentence case. No marketing hype.

## Evidence on Hand

- 290 published spectra (188 core loss, 80 low loss, 21 X-ray absorption, 1 zero loss), 43 elements, 41 contributors. Spectrum files are in R2 (local copy in `data/cache/files/`).
- The 2016 paper (doi:10.1017/S1431927616000179).
- Usage: 84 users keep 364 favourites, and 11 microscope presets are saved.
- There are no testimonials, user studies or usage analytics. Do not invent them.

## Product Principles

- Real data first: show real spectra and real counts, never placeholder curves or invented figures.
- Nothing breaks: old URLs, files and API queries keep working.
- Credit and provenance: every spectrum names its contributors, and every value says where it came from.
- Low upkeep: prefer platform features and few dependencies over anything that needs maintenance.
- Contributors need no technical skills: every task a contributor does works in a web browser.
