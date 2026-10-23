---
title: "0027. Bulk download"
description: "A script outside Cloudflare builds the bulk download from API v2."
adr:
  date: 2026-10-20
---

## Context

People want all spectra in one archive. Building a zip of every file is heavy work, and it should stay out of the Worker's request path ([ADR 0001](/docs/adr/0001-cloudflare-workers-d1-r2/)).

## Decision

- `python/export.py` builds the zip from the public API v2. The zip holds the files of every published spectrum, `metadata.json`, and a README with licence and citation. File names in the zip are basenames, never raw names, to prevent zip-slip.
- An admin uploads the zip on the moderation page. The site serves it at `/downloads/`.
- The script can run on any machine or in a scheduled CI job. If the build moves into a Worker cron later, only the caller of the upload changes.

## Consequences

- A daily Worker cron could build the zip instead. On Workers Paid, a cron that runs once an hour or less often gets 15 minutes of CPU.
- The GitHub data backup offers the same data through GitHub's own zip download of the repository ([ADR 0035](/docs/adr/0035-github-data-backup/)).
