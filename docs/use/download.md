---
title: Download and cite spectra
description: Download one spectrum or the whole database, the ODbL licence, and how to cite the contributor and EELSdb.
---

You can download any published spectrum without an account.
The spectra are open data under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/).

## Download one spectrum

1. Open the spectrum page.
2. Click **Download**. The dialog shows a citation for the spectrum.
3. Copy the citation, or open **BibTeX** and copy the BibTeX entry.
4. Choose a format, then click **Download** followed by the file name.

The formats are:

- **MSA**: EMSA/MAS text with the beam energy and the angles in the header. It opens in HyperSpy, DigitalMicrograph and most EELS software.
- **CSV**: two columns, the energy in eV and the intensity.
- **JSON**: the data and all the metadata on the spectrum page, in the [API v2](/docs/use/api/) format.
- **HyperSpy**: the `.hspy` file that the moderator made at review, for new spectra.
- **Original file**: the file as the contributor uploaded it.

EELSdb makes the MSA, CSV and JSON files from the stored data when you download them, so every spectrum has them, whatever format it was uploaded in.
Their addresses do not change, so you can use them in scripts: for example `https://eelsdb.eu/spectra/graphite/download/csv`.

## Download everything

The [bulk download](/downloads/) page has one zip file with:

- every public spectrum file;
- the metadata of all spectra, in the [API v2](/docs/use/api/) format, as `metadata.json`;
- a README with the licence and the citation.

The page shows the size of the archive and the date it was made.
To get only some spectra, use the [API](/docs/use/api/) instead.

## What the licence lets you do

The ODbL lets you copy, share and adapt the spectra if you:

- credit the EELS Data Base and the contributors;
- share an adapted database under the same licence.

Spectra from the old site have no licence value in the API (`licence` is `null`).
The old site stated the ODbL for all its data, and its submit form asked contributors to agree to it.
New submissions record `ODbL-1.0`.

## Cite a spectrum

Cite two things:

1. The contributor's paper, if the spectrum has one. The download dialog and the **Reference** section of the spectrum page show it.
2. The EELS Data Base paper:

   > Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie. A complete overhaul of the electron energy-loss spectroscopy and X-ray absorption spectroscopy database: eelsdb.eu. *Microscopy and Microanalysis* 22, 717–724 (2016). [doi:10.1017/S1431927616000179](https://doi.org/10.1017/S1431927616000179)

The [How to cite](/docs/about/citation/) page has the same citation and a BibTeX entry.
