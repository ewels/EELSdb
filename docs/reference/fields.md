---
title: Spectrum fields
description: The fields of an EELSdb spectrum record and their allowed values, as the submit form, the spectrum page and API v2 use them.
---

This page lists the fields of a spectrum, with the names that [API v2](/docs/use/api/) uses.
The [API v2 reference](/docs/api/v2/) and its [OpenAPI file](/api/openapi-v2.json) give the exact types.

## Units

Numbers are numbers, and the unit is in the field name:

| Suffix | Unit |
| --- | --- |
| `_ev` | electronvolt |
| `_kv` | kilovolt |
| `_mrad` | milliradian (semi-angles) |
| `_s` | second |
| `_nm2` | square nanometre |
| `_deg` | degree |
| `_t_lambda` | thickness as t/λ, the ratio of the thickness to the inelastic mean free path |

A field with no value is `null`.

## Identity and description

- `id`: A number. Spectra from the old site keep their old id.
- `slug`: The name in the web address: `https://eelsdb.eu/spectra/{slug}/`.
- `title`: The specimen name.
- `type`: `coreloss`, `lowloss`, `zeroloss` or `xrayabs`.
- `technique`: `eels` or `xas`.
- `phase`: `solid`, `liquid` or `gas`.
- `intensity_units`: `counts`, `oscillator_strength`, `mu`, `optical_density` or `normalised`.
- `formula`: The chemical formula as the contributor typed it, for example `alpha-Fe2O3`.
- `elements`: Element symbols, for example `["Fe", "O"]`.
- `edges`: Edges as `{"element": "Fe", "edge": "L2,3"}`. An edge is one of `K`, `L1`, `L2,3`, `L2`, `L3`, `M1`, `M2,3`, `M4,5`, `M`, `N2,3`, `N4,5`, `N6,7`, `O2,3` or `O4,5`.
- `keywords`: Words that the contributor chose.
- `description`: The contributor's comments.
- `source_purity`: Where the specimen came from, and its purity.
- `licence`: An SPDX licence identifier, for example `ODbL-1.0`. `null` for spectra from the old site.
- `completeness`: `full` when the beam energy and both angles are known, `partial` when not, `null` for X-ray absorption spectra.
- `published_at`, `updated_at`: Dates and times.
- `author`: The contributor's `name` and the address of their author page.
- `energy`: `min_ev`, `max_ev` and `step_ev` of the energy axis.

## Acquisition (EELS)

`acquisition` holds the microscope settings:

- `microscope`, `detector`, `gun_type`, `mode`: Text.
- `beam_energy`: `value_kv`, `source` and `uncertainty_kv`.
- `convergence_angle`: `value_mrad`, `source` and `uncertainty_mrad`. The convergence semi-angle.
- `collection_angle`: `value_mrad`, `source` and `uncertainty_mrad`. The collection semi-angle.
- `resolution_ev`: The energy resolution.
- `monochromated`: `true` or `false`.
- `dispersion_ev`: The energy step per channel.
- `probe_size_nm2`, `beam_current`: The probe size and the beam current.
- `integration_time_s`, `readouts`: The exposure for each readout, and the number of readouts.
- `instrument_profile`: The `id`, `version` and address of the [instrument profile](/docs/share/instrument-profiles/) that supplied angles.

`source` is one of `file`, `companion`, `profile`, `user`, `estimate` or `unknown`.
[Beam energy and angles](/docs/share/beam-energy-and-angles/) explains each source.

## X-ray absorption

`xas` is `null` for EELS spectra. For X-ray absorption spectra it holds `facility`, `beamline`, `source_type`, `monochromator`, `resolving_power`, `detection_mode`, `polarisation`, `polarisation_angle_deg`, `calibration_reference` and `i0_normalisation`.

## Treatment

- `dark_current_corrected`, `gain_variation_corrected`: `true`, `false` or `null`.
- `calibration`: How the energy axis was calibrated.
- `thickness`: `value_t_lambda` and its `source`.
- `deconvolutions`: The deconvolutions applied, for example Fourier-log, Fourier-ratio, Stephens, Richardson-Lucy or maximum entropy.

## Reference and links

- `reference`: The paper: `doi`, `doi_url`, `url`, `authors`, `title`, `journal`, `volume`, `issue`, `pages`, `year`, and `freetext` for a reference with no structured fields.
- `associated`: Related EELSdb spectra, for example the low-loss spectrum of the same specimen.
- `links`: Other web pages, each with a `url` and a `title`.

## Files and processing

- `files`: Every file of the spectrum, with `role`, `url`, `filename`, `bytes` and `sha256`. See [Files](/docs/use/api/#files).
- `download_url`: The main data file.
- `processing`: The tools and versions that the moderator used at review, with their findings.
