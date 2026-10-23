---
title: "0007. Data model"
description: "Values are typed and record their source, migrated records keep their old identity, and original files never change."
adr:
  date: 2026-10-20
---

## Context

The old WordPress site stored spectrum fields as post meta strings. The values contained units ("200 kV") and PHP-serialised arrays. The site did not record where a value came from. A missing value and an unknown value looked the same. The schema now lives in `worker/migrations/` as plain SQL.

## Decision

- The database stores numbers as numbers. The column name holds the unit (`beam_energy_kv`, `convergence_mrad`, `resolution_ev`). API v1 adds the units back as strings. API v2 returns numbers.
- Beam energy, convergence angle and collection angle each have a value, a `source` and an optional uncertainty. The sources are `file`, `companion`, `profile`, `user`, `estimate` and `unknown`. "Unknown" is a valid answer ([ADR 0013](/docs/adr/0013-beam-energy-and-angles/)).
- Each spectrum has a technique and units:
  - `technique` is `eels` or `xas`.
  - `phase` is `solid`, `liquid` or `gas`.
  - `intensity_units` is explicit: `counts`, `oscillator_strength`, `mu`, `optical_density` or `normalised`.
  - EELS-only fields are in `eels_acquisition`. XAS-only fields are in `xas_acquisition`.
  - The data model keeps the v1 `type` vocabulary (`coreloss`, `lowloss`, `zeroloss`, `xrayabs`).
- The data model keeps the legacy identity. Migrated spectra keep their WordPress post ID as `id`, their slug and their file path. Migrated users keep their WordPress user ID. `spectra.legacy_v1` holds the recorded v1 JSON object for exact replay ([ADR 0008](/docs/adr/0008-api-v1-frozen-contract/)).
- EELSdb never loses the original. It stores the uploaded file unchanged. Processed versions (clean MSA, HSPY, metadata JSON) are extra `files` rows with a `role`.
- Processed versions of one measurement are files. They are not separate spectra ([ADR 0015](/docs/adr/0015-processed-versions-as-variants/)).
- Elements and edges are explicit rows in `spectrum_elements` and `spectrum_edges`. Filters match edges as whole labels (`Fe`, `L2,3`), not as substrings.
- Edges are labels only, with no energy. Marker positions come from the edge table. A record of observed onsets (chemical shifts) would need a separate change to the data model.
- Each edit adds a `history` row. The history lets us review and reverse changes.
- Each spectrum has its own licence ([ADR 0023](/docs/adr/0023-licences/)).
- A spectrum has one of these statuses: `draft`, `pending`, `published`, `private` or `rejected`. Only `published` spectra are public.
- New links between associated spectra (`spectrum_links`) go in both directions.

## Consequences

- API v1 output for migrated spectra comes from `legacy_v1`. A function formats new spectra from the typed rows. Tests check this function by reformatting migrated spectra.
- When we reformat migrated spectra from typed rows, the output matches the recordings except for number formatting (`"1.0 eV"` against `"1 eV"`). For this reason the data model keeps `legacy_v1`.
- The importer handles these quirks in the old data:
  - One element is stored as a string, but several elements are stored as an array.
  - `assoc_spectra` is stored serialised, unserialised or as `''`.
  - `otherURLs` holds one link per line (`url optional title`). The importer splits each line on the first space.
  - Edge lists are missing or null.
  - The old wp-admin never added a link to the other spectrum, because the reverse loop ran after serialising. Some legacy links therefore go in one direction only.
- The 21 legacy XAS spectra store the synchrotron name in `microscope`. The importer copies it to `xas_acquisition.beamline`, and v1 still returns it as `microscope`.
- We found gaps when we imported Corex data and planned for STXM data. No unit value exists for the mass absorption coefficient, because `mu` means linear absorption. STXM files use linear absorption in nm⁻¹. Add values when that data arrives.
- If you edit a migration that you already applied locally, you must fix the local database by hand. Prefer a new migration.
