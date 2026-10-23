---
title: "0001. Cloudflare Workers, D1 and R2"
description: "EELSdb runs as one Cloudflare Worker, with D1 for data and R2 for files, on Workers Paid."
adr:
  date: 2026-10-14
---

## Context

The old WordPress site needed a server, PHP updates, a custom plugin and several third-party plugins. Nobody had time to maintain them. Upgrades broke the site, and also broke the API that exSpy relies on. The spam protection had no maintenance, and it let in thousands of spam accounts. The new site must not depend on that kind of upkeep.

The new site has these requirements:

- Contributors are experimentalists. They need a web form, and they must not need Git, pull requests or a terminal.
- Every spectrum URL, file URL and `api.eelsdb.eu` query that works today must keep working.
- Existing accounts carry over, but spam accounts do not.
- The site needs very little maintenance.

## Decision

- One Cloudflare Worker, written in TypeScript, serves both hostnames. The Worker routes on the `Host` header. It sends `api.eelsdb.eu` requests to the API and `eelsdb.eu` requests to the pages.
- D1 (SQLite) holds all structured data. SQL does the filtering and sorting, so the Worker does little CPU work per request.
- R2 holds the spectrum files. Legacy files keep their exact paths (`wp-content/uploads/YYYY/MM/name.msa`), so old download links work.
- The Worker's assets binding serves the static assets. These are the CSS, the JS, uPlot, the Pyodide loader, the edge table JSON and the built docs.
- The Worker runs on Workers Paid ($5 a month). Cloudflare Email Service sends to arbitrary recipients only on the paid plan, and sign-in links, address confirmations and account notices are all emails ([ADR 0022](/docs/adr/0022-email-and-contact/)).
- The project uses one provider, one account and one set of credentials.

## Consequences

- There is no server, OS or PHP to patch. Dependencies are few and pinned ([ADR 0004](/docs/adr/0004-server-rendered-hono/)).
- Local development runs entirely in `wrangler dev`, with Miniflare's local D1 and R2. Developers do not need a Cloudflare account to develop or test.
- Keep the work per request small, and keep it in D1 queries. Workers Paid allows 30 s of CPU per request by default, but heavy work in the request path still makes pages slow and costs CPU time. Examples are parsing a large JSON index and password hashing.
- D1 allows at most 100 bound parameters per query. Code must cap or chunk every `IN (...)` that it builds from user input.
- Heavy work stays out of the request path:
  - Old WordPress password checks use a lot of CPU. They sit behind a flag, and the Worker rehashes each password on first use ([ADR 0018](/docs/adr/0018-sign-in/)).
  - The project does not need server-side HyperSpy, because Python runs in the browser ([ADR 0002](/docs/adr/0002-no-server-side-python/)).
  - A process outside Cloudflare builds the bulk zip ([ADR 0027](/docs/adr/0027-bulk-download/)).
- Email uses Cloudflare Email Service, behind a provider switch with a "log" default, so local development sends nothing ([ADR 0022](/docs/adr/0022-email-and-contact/)).
- A cron trigger runs a daily clean-up of old drafts and old contact messages.

## Alternatives considered

- The Workers free plan. It cannot send email to arbitrary recipients, and it allows only 10 ms of CPU and 50 subrequests per request.
- Keep WordPress and patch it: this does not remove the cause.
- A static site backed by Git, with contributions as pull requests: contributors would need GitHub.
  - We also worked out a free variant. It used a static site on GitHub Pages, a free Worker for the API and form, and a GitHub App that turns each submission into a pull request. GitHub Actions ran RosettaSciIO.
  - This variant was free, but it lost existing passwords, built-in email, instant pre-fill, private pending submissions and easy edits.
  - Every design also needs server-side filtering on the API host, because a static JSON file cannot answer exSpy's queries.
- A Python service in a Cloudflare Container: Containers are paid-only and add infrastructure. Pyodide in the browser replaces this option.
- Free Python hosts: we researched these on 2026-10-14. We rejected all of them, because each one adds a provider.
  - Google Cloud Run and AWS Lambda have free tiers and accept container images. Cold starts take several seconds, and both need a card on file.
  - Hugging Face Spaces, Render and Koyeb sleep when idle. Their memory is tight for scipy.
  - Modal gives free credits, but the credits can change.
  - Vercel and Netlify functions have size limits that are too small for numpy, scipy and HyperSpy together.
  - Oracle Always Free gives a VM, which someone must patch.
  - FastAPI Cloud Hobby is free in beta, with 0.1 vCPU and 512 MB, and scales to zero. At that CPU, a HyperSpy import after a cold start could take tens of seconds. Beta pricing can also change.
