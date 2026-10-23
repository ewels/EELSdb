---
title: "0013. Beam energy and angles"
description: "Each beam energy and angle records where its value came from, and \"unknown\" is a valid value."
adr:
  date: 2026-10-16
---

## Context

Quantitative use of a spectrum needs the beam energy, the convergence angle and the collection angle. Microscopists gave this feedback. Most spectra come from Gatan spectrometers, often on Thermo Fisher microscopes. On these microscopes, DigitalMicrograph is usually not connected to the microscope. DM files then lack the beam energy and both angles, and many submitters do not know the angles. The old site forced a value or left the field empty, so guesses and gaps looked the same.

## Decision

The site fills values from these sources, in this order. It stores the source and an optional uncertainty with each value ([ADR 0007](/docs/adr/0007-data-model/)).

| Source | Gives | Notes |
|---|---|---|
| The DM3/DM4 file | exposure, frames, dispersion, offset, date; voltage and angles when present | The values may be stale manual entries. The form pre-fills them and asks the submitter to confirm. |
| Companion file from the same session | voltage, camera length, often convergence | Velox `.emd` or TIA `.ser`/`.emi`. RosettaSciIO reads them. |
| Instrument profile | both angles | Facility calibration tables. Convergence by kV, mode and aperture. Collection by camera length and entrance aperture. |
| Earlier submissions | suggestions only | The form never fills them silently. |
| The submitter | typed values | The form shows beam energy as buttons (60, 80, 120, 200, 300 kV, other). "Approximate" with an uncertainty is a valid answer, and so is "unknown". |

- API v1 omits unknown values, as it always did. API v2 returns `null` with `source: "unknown"`.
- Facility staff create instrument profiles on the web, and a moderator approves them. The site keeps versions of each profile in `instrument_versions`. Each spectrum records the version it used. Approving an old version must not roll back the current one. Instrument profiles replace the old per-user microscope presets.
- The browse page can filter on "beam energy and angles known". The spectrum page shows the values in its acquisition table, with no separate badge.

## Consequences

- Agents and scripts must never guess a value. The drafts API records omitted values as unknown. The `eelsdb` agent skill states the never-guess rule ([ADR 0017](/docs/adr/0017-no-package-drafts-api/)).
- Instrument profiles are optional and low priority. A microscopist's view is that file metadata covers most cases.
- Fixes at the source help more than any form. These fixes include:
  - connecting DigitalMicrograph to the microscope,
  - a guide,
  - accepting `.hspy` uploads that carry `set_microscope_parameters()` values.

## Alternatives considered

- A generic collection-angle calculator. We rejected it because it also needs inputs that submitters lack.
