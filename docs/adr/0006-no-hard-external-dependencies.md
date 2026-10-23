---
title: "0006. No hard external dependencies"
description: "EELSdb works without Zenodo, GitHub, DOI agencies or new HyperSpy releases, and every integration is optional."
adr:
  date: 2026-10-14
---

## Context

Each outside service is one more part that can fail or change its terms ([ADR 0001](/docs/adr/0001-cloudflare-workers-d1-r2/)). The project owner had repeated problems with Zenodo in other projects. exSpy had Zenodo and pooch rate-limit problems when it fetched its GOS files (exspy#156, #164, #168). Two or three people maintain the HyperSpy project. exSpy has had no release since 0.3.2 (March 2025).

## Decision

EELSdb works on its own. It never waits for, or breaks because of, any of these:

- Zenodo, GitHub, or any archive or mirror.
- A HyperSpy, exSpy or RosettaSciIO release. `pyreader.js` pins the Python versions, and the edge table is a pinned copy.
- A DOI registration agency.

Integrations are small and opt-in, for users and for other projects. Requests to the HyperSpy maintainers stay small and easy to decline.

The bulk download of the site is the archive. Mirrors are extras.

## Consequences

- We design each feature that needs an outside service so that nothing happens and nothing breaks without the credentials or the service. For example, email has a "log" provider. If the public ORCID email lookup fails, the account has no address.
- The GitHub data backup follows this rule ([ADR 0035](/docs/adr/0035-github-data-backup/)).
- Any DOI integration must follow this rule too. The research below covers DataCite.

## Research: minting DOIs with DataCite (2026-10-21)

We decided and built nothing. We found these facts:

- DataCite has no tier for individuals. You need a Repository account under a member organisation.
  - Under an existing member, such as a university or institute that already mints DOIs, the account is often free to EELSdb. This is the most realistic route.
  - A consortium organisation pays €0 membership, a €200–700 infrastructure fee and any consortium fee. Examples are CNRS in France, the British Library, TIB in Germany and ETH in Switzerland. This route needs a legal entity.
  - A direct member pays €2,000 plus €200–700. This is too much for about 300 DOIs.
  - Since April 2026, DataCite charges no per-DOI fees below 100k DOIs a year.
  - DataCite gives a free 6-month test account on request.
- The decision that blocks this work is which organisation owns the EELSdb DOIs and accepts the obligations.
- DOIs bring these obligations:
  - Nobody can delete a findable DOI. A withdrawn spectrum therefore needs a tombstone page with the citation and the reason, never a 404.
  - Landing pages must stay available. A domain move means a bulk update of URLs.
  - If the membership ends, the DOIs still resolve, but nobody can update them.
  - Use an opaque suffix that DataCite generates, not the slug.
  - Nobody can delete test DOIs either.
- A design sketch needs about 2 days of work:
  - Add `spectra.doi` and `doi_synced_at`. These are separate from the paper DOI in `reference.doi`.
  - Add a `datacite.ts` that sends a POST to `https://api.datacite.org/dois` with `"event": "publish"` and sends a PUT for updates. It uses fetch with basic auth and keeps the credentials as secrets.
  - Add an hourly cron. It mints or updates published spectra where `doi IS NULL` or `updated_at > doi_synced_at`, and tries again on the next run if a call fails.
  - We rejected calls from each edit path, because retries become difficult.
  - A new spectrum waits up to an hour for a DOI.
  - DOIs for each version add about a day. Withdrawal tombstones add about half a day.
- For legacy spectra, mint DOIs for new submissions first. Backfill old spectra when the licences and the pre-2014 authorship are clear.
- Metadata harvesting ([ADR 0026](/docs/adr/0026-metadata-harvesting/)) does not need DOIs.
