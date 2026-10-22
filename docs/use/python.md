---
title: Load spectra in Python
description: Load EELSdb spectra into HyperSpy, query the API with requests, or use exSpy.
---

You do not need an EELSdb package to use the spectra in Python. Use standard tools:

- HyperSpy reads the MSA file of every spectrum, with the beam energy and angles.
- `requests` and [API v2](/docs/use/api/) give JSON records with every field, where each acquisition value came from, and links to the files.
- `exspy.data.eelsdb()` searches and downloads in one call. It uses the deprecated API v1, so the signals carry less metadata.

## Load one spectrum in HyperSpy

Every published spectrum downloads as an MSA file at `https://eelsdb.eu/spectra/{slug}/download/msa`.
The file has the EELS header fields: the beam energy, the convergence and collection semi-angles when they are known, and the signal type.

```py
import hyperspy.api as hs
from urllib.request import urlretrieve

url = "https://eelsdb.eu/spectra/iron-iii-oxide-hematite/download/msa"
path, _ = urlretrieve(url, "hematite.msa")
s = hs.load(path, signal_type="EELS")
print(s.metadata.Acquisition_instrument.TEM.beam_energy)
s.plot()
```

Spectra also have a HyperSpy (`.hspy`) file, which loads as an `EELSSpectrum` with the DOI of the reference in `metadata.General.doi`. Its energy axis is exact, also when the steps are not even. Find it in the record's `files`, with the role `hspy`:

```py
import hyperspy.api as hs
import requests
from urllib.request import urlretrieve

record = requests.get("https://api.eelsdb.eu/v2/spectra/iron-iii-oxide-hematite").json()
hspy = next((f for f in record["files"] if f["role"] == "hspy"), None)
if hspy:
    path, _ = urlretrieve(hspy["url"], hspy["filename"])
    s = hs.load(path)
```

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

To load the results, download the MSA file of each one:

```py
import hyperspy.api as hs
import requests
from urllib.request import urlretrieve

page = requests.get("https://api.eelsdb.eu/v2/spectra", params={"element": "Fe", "covers_ev": 708}).json()
spectra = []
for record in page["results"]:
    path, _ = urlretrieve(f'https://eelsdb.eu/spectra/{record["slug"]}/download/msa', f'{record["slug"]}.msa')
    spectra.append(hs.load(path, signal_type="EELS"))
```

Use the record for the values that a file cannot hold, for example where each acquisition value came from (`acquisition.beam_energy.source`) and the reference.
Make one request at a time. For the whole database, use the [bulk download](/downloads/).

## Load spectra with exSpy

[exSpy](https://hyperspy.org/exspy/) has a function that searches EELSdb and downloads the matching spectra as `EELSSpectrum` signals:

```py
import exspy

spectra = exspy.data.eelsdb(spectrum_type="coreloss", element="Fe")
print(len(spectra), spectra[0].metadata.General.title)
```

The arguments match the filters on the [browse page](/docs/use/find/): `spectrum_type`, `title`, `author`, `element`, `formula`, `edge`, `min_energy`, `max_energy`, `resolution` and `monochromated`.
`max_n` limits the number of spectra to download.
exSpy uses the deprecated API v1, so the signals have less metadata than the API v2 record: no source for each value and no structured DOI.
