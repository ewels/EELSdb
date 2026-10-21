---
title: Load spectra in Python
description: Load EELSdb spectra into HyperSpy with exSpy or the eelsdb package, or query the API with requests.
---

There are three ways to get EELSdb spectra into Python:

- `eelsdb.load()` gives one HyperSpy signal with the full API v2 record: the DOI, and where each acquisition value came from.
- `requests` and API v2 give JSON records and file links. Use them if you do not use HyperSpy, or to filter on any field.
- `exspy.data.eelsdb()` gives a list of HyperSpy signals, which is handy if you already use exSpy. It uses the deprecated API v1, so the signals carry less metadata.

## Load one spectrum with the eelsdb package

`eelsdb.load()` takes a spectrum id or slug.
It returns a HyperSpy signal with the beam energy, the angles, the microscope, the elements and the DOI in its `metadata`.
The full API v2 record is in `original_metadata.eelsdb`.

```py
import eelsdb

s = eelsdb.load("iron-iii-oxide-hematite")
print(s.metadata.Acquisition_instrument.TEM.beam_energy)
print(s.original_metadata.eelsdb.acquisition.convergence_angle.source)
s.plot(plot_edges=True)
```

:::note
The `eelsdb` package is not on PyPI yet. Install it from GitHub:

```sh
$ pip install "git+https://github.com/ewels/EELSdb#subdirectory=python"
```
:::

## Query the API with requests

[API v2](/docs/use/api/) returns JSON with typed values, so you can filter and sort in your own code.
This example lists iron spectra whose energy range includes 708 eV, the Fe L3 edge.
Click **Run code** to run it in this page.

```py runnable
import requests

page = requests.get(
    "https://api.eelsdb.eu/v2/spectra",
    params={"element": "Fe", "covers_ev": 708, "per_page": 5},
).json()

print(page["total"], "spectra")
for s in page["results"]:
    kv = (s["acquisition"] or {}).get("beam_energy") or {}
    print(f'{s["title"]}: {kv.get("value_kv")} kV ({kv.get("source")})')
```

To read the data file, take `download_url` from a record and give the file to [RosettaSciIO](https://hyperspy.org/rosettasciio/) or HyperSpy:

```py
import hyperspy.api as hs
import requests

record = requests.get("https://api.eelsdb.eu/v2/spectra/21751").json()
url = record["download_url"]
name = url.rsplit("/", 1)[-1]
with open(name, "wb") as f:
    f.write(requests.get(url).content)

s = hs.load(name, signal_type="EELS")
```

Keep the file name from the address: HyperSpy picks the file reader from the extension, and not every file is an MSA file.

## Load spectra with exSpy

[exSpy](https://hyperspy.org/exspy/) has a function that searches EELSdb and downloads the matching spectra as `EELSSpectrum` signals:

```py
import exspy

spectra = exspy.data.eelsdb(spectrum_type="coreloss", element="Fe")
print(len(spectra), spectra[0].metadata.General.title)
```

The arguments match the filters on the [browse page](/docs/use/find/): `spectrum_type`, `title`, `author`, `element`, `formula`, `edge`, `min_energy`, `max_energy`, `resolution` and `monochromated`.
`max_n` limits the number of spectra to download.
exSpy uses the deprecated API v1, so the signals have less metadata than `eelsdb.load()` gives: no source for each value and no structured DOI.
