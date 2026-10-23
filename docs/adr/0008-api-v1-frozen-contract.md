---
title: "0008. API v1 is frozen"
description: "API v1 returns exactly what the old site returned, and a replay of recorded responses proves it."
adr:
  date: 2026-10-20
---

## Context

These clients use `api.eelsdb.eu`:

- exSpy (`exspy.data.eelsdb()`), the main client.
- pyTEMlib.
- hyperspyUI.
- The NOMAD search facets.
- Course material and unknown scripts.

castep-docs, SpectraFit-Core and EELSAnalyser also refer to EELSdb, and re3data lists it. exSpy stores the whole spectrum object in `original_metadata`, so somebody may use any field.

exSpy depends on these behaviours (`exspy/data/_eelsdb.py`, 0.3.2 and main, October 2026):

- It sends one `GET https://api.eelsdb.eu/spectra` with no trailing slash. The parameters are `type`, `title`, `author`, `element` or `element[]`, `formula`, `edge`, `min_energy`, `max_energy`, `resolution`, `*_compare` (defaults `gt`, `lt`, `lt`), `monochromated`, `per_page` (default `-1`), `order` and `order_direction`.
- It sends a desktop Chrome User-Agent. The old host blocked plain Python requests in 2024 (exspy#64, #66).
- A `message` key in the JSON makes it raise an error.
- It downloads `download_link` only when the link ends in `.msa`. It therefore skips the 17 `.txt` spectra.
- It reads `description`, `formula`, `author.name` and `microscope` without a check. These four fields must always be present.

## Decision

- v1 returns the same data, in the same shapes, for the same queries. The source of truth is the recorded live responses in `data/fixtures/api-v1/`. A written description is not the source of truth.
- `worker/test/api-v1-replay.test.ts` replays every recorded request against the Worker. The local D1 holds data seeded from the fixtures. The test compares the parsed JSON and the status. Any difference fails unless `data/fixtures/api-v1/EXPECTED_DIFFS.md` lists it. The test also checks listed differences as far as possible. For example, `ge` must equal the recorded `gt`.
- For migrated spectra, the object is the recorded response (`spectra.legacy_v1`), so it matches byte for byte. A function formats new spectra with the old rules.
- v1 is frozen and deprecated:
  - Nothing new may depend on it. This includes the website, docs examples, the CLI and tests of new features.
  - Do not add parameters or features.
  - Only the v1 routes import `worker/src/api/query.ts`.
  - The website and all examples use API v2 ([ADR 0009](/docs/adr/0009-api-v2/)).
  - The v1 OpenAPI file stays hand-written and marks every operation `deprecated: true`.
- The API does not block non-browser clients. The API host does not use Bot Fight Mode. The API accepts honest User-Agents.
- All API responses send `Access-Control-Allow-Origin: *`.
- The API answers `/spectra` and `/spectra/` directly, without a redirect. It returns the route index at `/`. The live root redirected because of a WordPress canonical redirect.

`EXPECTED_DIFFS.md` lists each of these deliberate changes:

- The API treats `ge` as ≥ and `lt` as ≤, as the documentation states. The old code treated any value other than `gt` or `eq` as ≤. exSpy sends `gt`, `lt` and `eq`, so it sees no change.
- `monochromated=0` returns only non-monochromated spectra.
- The edge filter matches whole edge names. `K` matches `C_K`, not `K_L2,3`.
- The author search matches names and ORCID iDs only, not emails or logins. An author filter that matches nobody returns `[]`. The live site dropped the filter and listed every post.
- The API returns corrected energy ranges for files that the old parser misread ([ADR 0010](/docs/adr/0010-migrating-public-data/)).
- `order=author` sorts by name. The old site sorted by the private WordPress user ID.
- `/registered-users/` and `/author/{user}/` return contributors only, with no personal fields. The live routes exposed emails and addresses. We never recorded these routes as fixtures.
- New data (gas phase) appears only when a query asks for it with `phase=gas`. Old queries therefore return what they did before. exSpy downloads every match, so a carbon query would otherwise gain up to 615 gas-phase files.

## Consequences

- The Worker sorts with `Intl.Collator` after an SQL filter. SQLite `NOCASE` orders punctuation differently from MySQL `utf8mb4_unicode_ci` (`(C8H8.` against `(C8H8)`). The result sets are small. For ties in the default formula order, the Worker uses the recorded position (`legacy_rank`).
- WordPress percent-encoded the slugs and "texturised" the titles (`&#8211;`). The replay keeps these.
- The fixtures store recorded list responses as IDs into `spectra/all.json`. This takes 2 MB instead of 28 MB.
- The recorder refuses unpublished spectra. It stops if an `email` key appears in a response.
- exSpy gets the same spectra and data from `wrangler dev` as from the live site. `python/tests/test_exspy_against_worker.py` checks this when `EELSDB_API` is set.
- We can remove v1 only after two things happen. exSpy must move to v2 through an exSpy pull request ([ADR 0006](/docs/adr/0006-no-hard-external-dependencies/)). Old exSpy versions must also go out of use.

## Alternatives considered

- Extend v1 with new fields. Old fields can never become typed, so a response would have `beamenergy: "200 kV"` next to `beam_energy_kv: 200`. This is "v2 squeezed into v1". A frozen v1 costs only a replay test and a formatter.
- Generate the v1 OpenAPI file from code. This would mean a rewrite of frozen query code.
