---
title: "0010. Migrating public data"
description: "We record the old site's public data, fix its energy errors and drop dead content."
adr:
  date: 2026-10-20
  implemented: partly
---

## Context

The old site had 290 published spectra: 188 core-loss, 80 low-loss, 21 X-ray absorption and 1 zero-loss. It also had 21 private spectra from 2007–2008. 206 spectra came from the pre-2014 database, and contributors submitted 84 since 2014. The files are 273 `.msa` and 17 `.txt` files in 5 layouts, about 8 MB in total.

The migration has two separate tracks. One track handles public data and the other handles personal data ([ADR 0011](/docs/adr/0011-migrating-accounts/)).

## Decision

Public data comes only from public URLs. The scripts only read, send at most one request per second and use a User-Agent that names the project. We can commit the public data, except the files themselves.

1. Record the live API with `python/record_api.py` into `data/fixtures/api-v1/`. The recording covers these requests:
   - Every spectrum object.
   - Every filter and query shape that exSpy can send, with and without the trailing slash.
   - Each `*_compare` value, paging and sorts.
   - Unknown parameters (400) and unknown paths (404).
   - The route index and news.

   The recording leaves out the users routes, because they hold personal data.
2. Download every file to `data/cache/files/` (gitignored) and keep the URL path. Record the SHA-256s in `data/fixtures/files.json`.
3. Read every file with RosettaSciIO (`python/analyse_files.py`). Record the true energy axis in `data/fixtures/file-analysis.json`.
4. Build the seed with `python/build_seed.py`. It writes SQL inserts for D1 and an R2 upload list. The repo contains the seed (`data/seed/seed.sql`), so the Worker tests run without Python. A Python test checks that the seed is current.
5. Replace the old hand-typed edge table with the exSpy edge table.

The repository does not contain the spectrum files. They live in `data/cache/` and R2.

## Research: what reading every file found

- 16 files exported from HyperSpy (MSA `DATATYPE: Y`) had impossible energy ranges. The old PHP parser assumed two columns. Energy searches never found these files.
- The 2014 import script wrote a wrong `XPERCHAN` in 8 files with non-uniform data. The value is more than 10% off the real step. The files also have 2 wrong `OFFSET`s and 5 non-increasing axes.
- The 17 `.txt` files use 5 layouts. Variants of `numpy.loadtxt` parse them.
- 224 of the 273 MSA files contain no acquisition metadata.
- The old edge table disagreed with exSpy for 59 of 154 comparable edges. It stored combined edges such as L2,3 as one value between the two onsets. For NiO it stored 864 eV, against 855 and 872 eV.
- The old upload parser did arithmetic on the first column of every line. Under PHP 7, a blank line or a header line without `#` became energy 0 with no warning. Do not trust old derived min/max energies.
- RosettaSciIO read all 273 MSA files correctly. It keeps padded keys (`BEAMKV   -kV`), so the reader must normalise them.
- MSA files can leave `#OFFSET` and `#XPERCHAN` blank when `#DATATYPE` is XY. The 2016 Corex files do this. If a blank header line has no trailing space, RosettaSciIO uses a 0, 1, 2… axis with no warning. The reader therefore checks the raw header values.
- A `DATATYPE: Y` file with no axis now fails with a clear error. EMSA 1.0 has not changed, so the age of a file does not matter.

## Clean-up at import

- The importer drops the keyword "imported from old site" (on 210 of 290 spectra) from the new data. It also drops the dead `pc-web.cemes.fr` links (on 210). The v1 replay keeps both.
- The importer removes links from public spectra to private ones. It removes them from the v1 objects too.
- Corrected energy ranges change the v1 object on purpose. `EXPECTED_DIFFS.md` lists each one.
- The importer sets `licence` to `ODbL-1.0` on every spectrum. The old site stored no licence per spectrum, but it stated the ODbL for all its data and its submit form asked contributors to agree to it ([ADR 0023](/docs/adr/0023-licences/)).

## Consequences

- The import scripts and the seed are built and run locally. The cut-over below has not happened, so the new site is not live and the old site still serves eelsdb.eu.
- In a fresh checkout, run the download scripts to fill `data/cache/` before you rebuild the seed. The committed seed is enough to run the Worker and its tests.
- We found data issues that we did not fix. One spectrum shows an energy step of 3,710 eV. Some download filenames look random (`DspecIk9kBZ.msa`).
- The private spectra need the `wp-content/uploads` folder from the old host. A person must copy it at cut-over.

## Cut-over (human tasks)

1. Make the WordPress site read-only. Record the API and run the imports one final time.
2. Copy `wp-content/uploads` from the host.
3. Create the Cloudflare resources and deploy. Move DNS for both hostnames.
4. Set up the redirects. `/forum/…`, `/jobs/…` and `/registered-users/` return 410. `/wp-login.php` redirects to the new sign-in.
5. Before you deploy, set up these items:
   - A Cloudflare email sending domain, `EMAIL_PROVIDER` and `EMAIL_FROM`.
   - Workers Paid on the Cloudflare account, which email sending needs.
   - Real Turnstile keys.
   - OAuth client IDs.
   - Two-step sign-in on the admin account of the owner. With the defaults, an admin without two-step sign-in has no powers, and contact messages reach nobody.
6. Watch 404s and failed sign-ins for a few weeks. Email the kept accounts. Announce the new site on HyperSpy channels.
7. Decommission the old host and rotate its credentials.
