---
name: eelsdb
description: Find, download, load and cite reference spectra from the EELS Data Base (EELSdb, eelsdb.eu), the open database of electron energy-loss (EELS) and X-ray absorption (XAS) spectra. Use when the user wants a reference EELS or XAS spectrum for an element, edge, compound or energy range, wants to compare their spectrum with published ones, needs the beam energy, convergence or collection angle of a reference spectrum, wants to load EELSdb data in Python or HyperSpy, asks how to cite EELSdb, or wants to prepare their own spectra as drafts for submission to EELSdb.
---

# EELS Data Base

EELSdb holds about 300 published reference spectra: core loss, low loss, zero loss and X-ray absorption.
Reading is public: there is no key, no account and no rate-limit token. The only write action is making drafts for a user, with their drafts token (see below).

Use API v2 for everything below. It returns JSON with numbers as numbers and the unit in the field name (`beam_energy` → `value_kv`, angles in `_mrad`, energies in `_ev`).

| Need | Address |
| --- | --- |
| Search | `https://api.eelsdb.eu/v2/spectra?…` |
| One record | `https://api.eelsdb.eu/v2/spectra/{id or slug}` |
| Every parameter and field | `https://eelsdb.eu/api/openapi-v2.json` |
| A spectrum as Markdown, for reading | `https://eelsdb.eu/spectra/{slug}.md` |
| The whole database | `https://eelsdb.eu/downloads/` (one zip) |
| All documentation | `https://eelsdb.eu/docs/llms-full.txt` |

If a parameter or field is not described here, read the OpenAPI file. Do not guess parameter names: unknown parameters return HTTP 400 with `{"error": {"code": "unknown_parameter", …}}`.

## Find spectra

Filters combine with AND. Repeat `element` or `edge` to require several.

| Parameter | Example | Matches |
| --- | --- | --- |
| `element` | `element=Fe&element=O` | Contains every given element |
| `edge` | `edge=Fe_L2,3` or `edge=K` | The whole edge name, of one element or any element |
| `type` | `coreloss` | `coreloss`, `lowloss`, `zeroloss`, `xrayabs` |
| `covers_ev` | `708` | Energy range includes this energy |
| `min_energy_ev`, `max_energy_ev` | `400`, `900` | Starts at or above, ends at or below |
| `formula`, `q`, `author` | `TiO2`, `graphite`, `Feldhoff` | Text in the formula, title/description, contributor name |
| `complete` | `true` | Beam energy and both angles are known |
| `beam_energy_kv`, `monochromated` | `200`, `true` | Acquisition settings |
| `phase` | `gas` | Gas-phase spectra are left out unless you ask for `phase=gas` |
| `sort`, `order` | `published_at`, `desc` | Default `formula`, `asc` |
| `per_page`, `page` | `500`, `2` | Default 50, at most 500 |

A list response has `total`, `page`, `per_page`, `next`, `previous` and `results`. Follow `next` until it is `null`.

```python
import json
import urllib.parse
import urllib.request

HEADERS = {"User-Agent": "my-analysis/1.0 (name@example.org)"}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)) as r:
        return json.load(r)

url = "https://api.eelsdb.eu/v2/spectra?" + urllib.parse.urlencode(
    [("element", "Ti"), ("edge", "Ti_L2,3"), ("per_page", 500)]
)
spectra = []
while url:
    page = get(url)
    spectra += page["results"]
    url = page["next"]
```

## Read a record

The fields that matter most:

- `title`, `formula`, `elements`, `edges`, `type`, `energy` (`min_ev`, `max_ev`, `step_ev`).
- `acquisition.beam_energy`, `.convergence_angle`, `.collection_angle`: each has a value, a `source` and an optional uncertainty. `source` is `file`, `companion`, `profile` (instrument calibration), `user`, `estimate` or `unknown`.
- `completeness`: `full` when the beam energy and both angles are known.
- `reference`: the paper, with a structured `doi`.
- `download_url`: the main data file. `files` lists every file with its `role`, `filename`, `bytes` and `sha256`.
- `licence`: `ODbL-1.0`, or `null` for spectra from the old site (which stated the ODbL for all its data).

Report a value with `source: "unknown"` as unknown. Never fill it in from another spectrum or a typical value. Say when a value is an estimate.

## Download and load a spectrum

Keep the file name from `download_url`: readers choose the format from the extension, and not every file is MSA (some are `.txt`, `.dm3` or `.hspy`).

```python
import urllib.request

record = get("https://api.eelsdb.eu/v2/spectra/21751")
name = record["download_url"].rsplit("/", 1)[-1]
req = urllib.request.Request(record["download_url"], headers=HEADERS)
with urllib.request.urlopen(req) as r, open(name, "wb") as f:
    f.write(r.read())
```

Then, with HyperSpy and exSpy installed:

```python
import hyperspy.api as hs

s = hs.load(name, signal_type="EELS")
```

MSA headers carry the beam energy and angles only when the file has them. Take them from the record otherwise, or use `https://eelsdb.eu/spectra/{slug}/download/msa`: every published spectrum as an MSA file with the beam energy and angles from the record in its header (`/download/csv` and `/download/json` also exist). Spectra published after review also have a `hspy` file in `files`, with the DOI in its metadata.

Other options:

- `exspy.data.eelsdb(spectrum_type="coreloss", element="Fe")` returns HyperSpy signals directly. It uses the old API v1, so the metadata is less complete.

For a two-column text file without HyperSpy: `numpy.loadtxt(name, comments="#")` after skipping non-numeric header lines.

## Prepare drafts for the user to submit

A user can share many spectra by letting you prepare them as drafts. A draft is private: the user checks it on the website and submits it for review. You cannot submit or publish anything.

You need the user's drafts token. They make it at https://eelsdb.eu/account/drafts/. Ask them to put it in an environment variable (for example `EELSDB_DRAFT_TOKEN`) or a file. Do not ask them to paste it into the chat, and never print it.

For each spectrum file, send one request:

```python
import os
import requests

with open("hematite.msa", "rb") as f:
    r = requests.post(
        "https://api.eelsdb.eu/v2/drafts",
        headers={"Authorization": f"Bearer {os.environ['EELSDB_DRAFT_TOKEN']}", "User-Agent": "my-tool (me@example.org)"},
        data={"title": "Hematite", "type": "coreloss", "formula": "Fe2O3", "edges": "Fe_L2,3; O_K",
              "beam_energy": "200", "beam_energy_source": "file", "ref_doi": "10.1016/j.jssc.2009.07.037"},
        files={"file": f},
    )
print(r.status_code, r.json())  # 201: {"id", "slug", "status": "draft", "review_url"}
```

Rules:

- `file`, `type` (`coreloss`, `lowloss`, `zeroloss` or `xrayabs`) and `formula` are required. Other fields have the names of the submit form fields: `elements`, `edges` (`Fe_L2,3; O_K`), `beam_energy` (kV), `convergence` and `collection` (mrad), `ref_doi`, `description`, `keywords`, `microscope`, `detector`, and more in https://eelsdb.eu/api/openapi-v2.json.
- Take values only from the file's header, the user's notes or the paper. Add `beam_energy_source=file` (and `convergence_source`, `collection_source`) when the value comes from the file.
- If you cannot find the beam energy or an angle, leave the field out. The draft records it as unknown, which is a valid answer. Never guess, and never copy a value from another spectrum or a typical setting.
- A 400 response has `error.fields` with a message for each field, and nothing is saved. Fix the fields and send it again; do not retry blindly. At most 200 drafts an hour.
- Send one request at a time.

When you finish, give the user a list of the drafts with the values you left out, and tell them to check and submit them at https://eelsdb.eu/account/drafts/.

## Cite

Whenever you use, plot or report a spectrum, tell the user to cite both:

1. The contributor's paper: the record's `reference` (DOI in `reference.doi_url`), or the spectrum's Markdown page, which has a ready-made citation and BibTeX.
2. The EELS Data Base: Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie. A complete overhaul of the electron energy-loss spectroscopy and X-ray absorption spectroscopy database: eelsdb.eu. *Microscopy and Microanalysis* 22, 717–724 (2016). doi:10.1017/S1431927616000179

## Be kind to the server

- Send a User-Agent that names your tool and a contact.
- Use `per_page=500` instead of many small pages. Cache results within a session.
- Make requests one at a time. For more than about 50 files, use the bulk download zip.
- Apart from drafts, the API is read-only. Only the user can submit a spectrum, on the website.
