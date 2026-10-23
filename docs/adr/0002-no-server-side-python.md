---
title: "0002. No server-side Python"
description: "Python never runs on the server. It runs in the browser with Pyodide, and in offline scripts."
adr:
  date: 2026-10-14
---

## Context

The EELS community reads files with the HyperSpy stack. The stack includes RosettaSciIO and exSpy:

- RosettaSciIO has readers and writers for MSA, DM3/DM4, Velox EMD, TIA, HSPY and more.
- exSpy has EELS tools and the edge database.

EELSdb should use these packages and not write its own parsers. The old PHP parser caused most of the data errors ([ADR 0010](/docs/adr/0010-migrating-public-data/)).

Cloudflare Workers run JavaScript. Python Workers exist, but h5py and the RosettaSciIO plugins are unlikely to work there. The CPU limits are also tight. A separate Python service would add a provider or a paid plan ([ADR 0001](/docs/adr/0001-cloudflare-workers-d1-r2/)).

## Decision

Python never runs in the Worker. It runs in two places:

1. In the browser, with Pyodide (Python compiled to WebAssembly):
   - On the submit form, Pyodide gives an early check that helps the contributor. It reads the file, runs the shared checks, plots the spectrum and pre-fills fields. This check can fail or be slow. The form still works without it, and EELSdb does not trust its results.
   - On the moderator's review page, Pyodide does the authoritative run. It reads the file again and runs the same checks with pinned versions. On approval, the page uploads the processed files (MSA, HSPY, metadata JSON) and a processing record ([ADR 0012](/docs/adr/0012-submission-and-moderation/)).
   - On the spectrum page, Pyodide reads a viewer's own non-text file for "compare". The file never leaves the viewer's browser.
2. On a developer's machine, as single-file `uv run python/<script>.py` scripts with PEP 723 headers. These scripts do these tasks:
   - recording the live API
   - downloading and analysing legacy files
   - building the D1 seed
   - importing Corex
   - writing HSPY files for seeded spectra
   - building the bulk download
   - recording reference fixtures for tests.

The code has this layout:

- `python/eelsdb/` holds only the modules that the browser runs: `io.py`, `checks.py`, `_elements.py` and `review.py`. `npm run py` copies them to `worker/public/py/eelsdb/`. `worker/test/py-sync.test.ts` fails if the copies drift.
- `python/` is not an installable package. `pyproject.toml` has `package = false` and only sets up the test environment. Scripts next to `eelsdb/` can `import eelsdb`, because Python puts the script's folder on the import path.
- The shared Pyodide loader is `worker/public/pyreader.js`. The submit form, the review page and the spectrum page use it. The loader pins the versions, and EELSdb records these versions with each processed spectrum.

## Consequences

- Moderators install nothing. The project owner set this constraint: "I don't really want the moderators to need to do anything locally."
- The submitter and the moderator run identical checks with identical versions. A tool installed locally could not guarantee this.
- The first run is slow. Pyodide plus RosettaSciIO is about 18 MB, and the browser caches it after the first run. A cold first run on a real spectrum took about 30 s on the review page. The page must show results before it enables "Approve".
- Headless browser tests that read files through Pyodide can block for a minute or more.
- Some import scripts ignore `--help` and start work at once. If you run `record_api.py` or `download_files.py` by mistake, they re-record from the live site. Read a script before you run it.
- HyperSpy prints its import warning to stdout. This corrupts the JSON output of scripts that import HyperSpy. Keep JSON on a separate stream, or silence the warning.

## Alternatives considered

- Python Workers: h5py and the RosettaSciIO plugins probably do not work there, and the CPU limits are tight. This option also breaks the rule that Python never runs in the Worker.
- Cloudflare Containers or another Python host: these are paid or add a provider ([ADR 0001](/docs/adr/0001-cloudflare-workers-d1-r2/)).
- A re-check in GitHub Actions after submission: the owner rejected this, because it brings GitHub back into a design that uses only Cloudflare.
- A local moderator CLI or desktop app: moderators should install nothing, and tool versions on a laptop drift. Electron also needs too much packaging for two or three moderators.
