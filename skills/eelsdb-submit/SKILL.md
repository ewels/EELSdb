---
name: eelsdb-submit
description: Check EELS or XAS spectrum files and submit them to the EELS Data Base (EELSdb, eelsdb.eu) with the eelsdb command-line tool, one file or a folder of files at a time. Use when the user wants to share, upload, contribute or deposit spectra in EELSdb, prepare spectrum files and their metadata for EELSdb, check a DM3, DM4, MSA, EMD, HSPY, XDI or two-column text spectrum file before sharing it, or batch-submit many spectra.
---

# Submit spectra to EELSdb

The `eelsdb` tool checks spectrum files offline and submits them for review.
A moderator checks every submission before EELSdb publishes it.
The user must have an EELSdb account (sign-in with ORCID, Google or GitHub at https://eelsdb.eu/login/).

Full guide: https://eelsdb.eu/docs/share/command-line.md. Field meanings: https://eelsdb.eu/docs/reference/fields.md.

## Install

Needs Python 3.12 or later. Not on PyPI yet:

```sh
uv tool install "git+https://github.com/ewels/EELSdb#subdirectory=python"
eelsdb --version
```

## 1. Check each file

```sh
eelsdb check FILE --type coreloss --formula Fe2O3 --edges "Fe_L2,3;O_K"
```

- `--type`: `coreloss`, `lowloss`, `zeroloss` or `xrayabs`.
- `--edges`: separated by semicolons, written `Element_Edge` (`Fe_L2,3`, `O_K`, `Ti_L2,3`, `La_M4,5`).
- `--json` prints the findings as JSON. The exit status is 1 if there is an error.

Severities: `ERROR` means the file is unusable as it is (unreadable, empty, energy axis not increasing, NaN values). `WARNING` means probably wrong (zero-loss peak away from 0 eV, an edge outside the energy range, MSA header not matching the data). `INFO` is context (negative counts after background subtraction, a major edge in range but not listed).

Fix errors in the file. Show warnings to the user and ask; do not silently change their data or metadata to make a warning go away. The finding codes are listed at https://eelsdb.eu/docs/share/checks.md.

## 2. Sign in

`eelsdb login` opens https://eelsdb.eu/account/tokens/ and prompts for a personal API token.
The user must create the token in their browser and paste it at the prompt themselves.
Never ask for their password, and never put a token in a file, a command line or the chat.
The token is saved in `~/.config/eelsdb/config.json`.

## 3. Submit

One file:

```sh
eelsdb submit hematite.msa --title "Hematite" --type coreloss --formula Fe2O3 \
  --edges "Fe_L2,3;O_K" --beam-energy 200 --convergence 10 --collection 16 \
  --ref-doi 10.1016/j.jssc.2009.07.037
```

Many files: put each spectrum file beside a JSON file of the same name with its fields, then submit the folder.

```text
spectra/
├── hematite.msa
├── hematite.json
├── magnetite.dm4
└── magnetite.json
```

```json
{
  "title": "Hematite",
  "type": "coreloss",
  "formula": "Fe2O3",
  "edges": "Fe_L2,3;O_K",
  "beam_energy": "200",
  "convergence": "10",
  "collection": "16",
  "ref_doi": "10.1016/j.jssc.2009.07.037"
}
```

```sh
eelsdb submit spectra/
```

JSON keys are the option names with underscores: `title`, `type`, `formula`, `elements`, `edges`, `keywords`, `source_purity`, `description`, `microscope`, `detector`, `gun_type`, `acquisition_mode`, `beam_energy` (kV), `convergence` (mrad), `collection` (mrad), `resolution_ev`, `dispersion_ev`, `monochromated`, `integration_time_s`, `readouts`, `ref_doi`, `thickness_t_lambda`.
Files without a JSON file are skipped. Accepted extensions: `.msa`, `.dm3`, `.dm4`, `.txt`, `.csv`, `.emd`, `.hspy`.

## Rules for metadata

- Take values from the user, the file headers or the paper. Do not invent them.
- Beam energy, convergence and collection semi-angles: if a value is not known, leave it out. `eelsdb submit` then records it as unknown, which is a valid answer. A guessed angle is worse than "unknown".
- Semi-angles are in mrad, not full angles. The beam energy is in kV.
- Use the formula the user gives (`(La0.7,Sr0.3)MnO3` is fine). Elements default to those in the formula.
- Give the DOI of the paper that uses the spectrum when there is one.
- Submitting publishes the data under the ODbL after review. Confirm that the user has the right to share it.
- `--force` submits a file despite check errors. Use it only when the user confirms that the file is correct.

## After submitting

Each submission prints its slug. The user's submissions page, https://eelsdb.eu/account/submissions/, shows its status: waiting for review, changes requested, published or not accepted. A moderator may email the user to ask for changes.

To try this against a local copy of the site, set `EELSDB_API=http://api.localhost:8787`.
