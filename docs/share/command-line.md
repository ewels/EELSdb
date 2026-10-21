---
title: Submit from the command line
description: Use the eelsdb command-line tool to check spectrum files offline and to submit one spectrum or a folder of spectra.
---

The `eelsdb` command-line tool checks spectrum files on your computer and submits them to EELSdb.
Use it to submit many spectra at once, or to check files before you upload them.

## Install

The `eelsdb` package needs Python 3.12 or later. It is not on PyPI yet, so install it from GitHub:

```sh
$ uv tool install "git+https://github.com/ewels/EELSdb#subdirectory=python"
$ eelsdb --version
```

With pip, use `pip install` and the same address.

## Check a file

`eelsdb check` runs the [file checks](/docs/share/checks/) offline:

```sh
$ eelsdb check hematite.msa --type coreloss --formula Fe2O3 --edges "Fe_L2,3;O_K"
WARNING  edge_out_of_range: O K (K 532 eV) is outside the energy range.
```

This spectrum runs from 685 to 788 eV, so the O K edge at 532 eV is not in it.
With no findings, `eelsdb check` prints `hematite.msa: no problems found`.

Options:

- `--type`: `coreloss`, `lowloss`, `zeroloss` or `xrayabs`.
- `--formula`: The chemical formula, for example `Fe2O3`.
- `--elements`: Element symbols separated by commas. By default, the elements in the formula.
- `--edges`: Edges separated by semicolons, for example `"Fe_L2,3;O_K"`.
- `--thickness`: The stated thickness in t/λ, to compare with the estimate.
- `--json`: Print the findings as JSON.

The command exits with status 1 if it finds an error, so you can use it in a script.

## Sign in

`eelsdb submit` needs a personal API token.

1. Run `eelsdb login`. It opens the [API tokens page](/account/tokens/) in your browser.
2. On that page, create a token and copy it.
3. Paste the token at the `Token:` prompt.

```sh
$ eelsdb login
Create a token at https://eelsdb.eu/account/tokens/ (opening it in your browser), then paste it here.
Token:
Signed in as Jane Doe. Token saved.
```

`eelsdb` saves the token in `~/.config/eelsdb/config.json`.
You can revoke a token on the API tokens page at any time.

## Submit one spectrum

Give the file and the form fields as options:

```sh
$ eelsdb submit hematite.msa --title "Hematite" --type coreloss --formula Fe2O3 \
    --edges "Fe_L2,3;O_K" --beam-energy 200 --convergence 10 --collection 16
hematite.msa: submitted as hematite (waiting for review)
```

Each form field has an option with the same name: `--title`, `--type`, `--formula`, `--elements`, `--edges`, `--keywords`, `--source-purity`, `--description`, `--microscope`, `--detector`, `--gun-type`, `--acquisition-mode`, `--beam-energy`, `--convergence`, `--collection`, `--resolution-ev`, `--dispersion-ev`, `--monochromated`, `--integration-time-s`, `--readouts`, `--ref-doi` and `--thickness-t-lambda`.

If you leave out the beam energy or an angle, `eelsdb` submits it as unknown.
The title is the file name if you leave it out.

`eelsdb submit` runs the checks first. If they find an error, it does not submit the file. Add `--force` to submit it anyway.

## Submit a folder of spectra

Put each spectrum file in one folder, with a JSON file of the same name that holds its form fields:

```txt
spectra/
├── hematite.msa
├── hematite.json
├── magnetite.dm4
└── magnetite.json
```

```json title="hematite.json"
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

The JSON keys are the option names with underscores instead of dashes.
Then submit the folder:

```sh
$ eelsdb submit spectra/
```

`eelsdb` submits every file that has a JSON file beside it, and skips the others.
It accepts `.msa`, `.dm3`, `.dm4`, `.txt`, `.csv`, `.emd` and `.hspy` files.

## Use a local server

To try the tool against a local copy of EELSdb, set the API address:

```sh
$ EELSDB_API=http://api.localhost:8787 eelsdb login
```
