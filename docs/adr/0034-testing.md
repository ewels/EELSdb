---
title: "0034. Testing"
description: "Tests run in the Workers runtime, and a replay of recorded responses protects API v1."
adr:
  date: 2026-10-20
---

## Context

The most important promise is that old API clients see no change ([ADR 0008](/docs/adr/0008-api-v1-frozen-contract/)). Several parts of the code reimplement library behaviour, such as exSpy's background removal and thickness. These parts must stay faithful to the library.

## Decision

- Worker tests use Vitest in the real Workers runtime, with local D1 and R2. The plugin is `@cloudflare/vitest-plugin`. Cloudflare deprecated the older `@cloudflare/vitest-pool-workers` and renamed it.
- `wrangler types` generates the Worker types into `worker-configuration.d.ts`, and the file is committed.
- `npm test` and `npx tsc --noEmit` must pass after every change.
- Python tests use `pytest` in `python/` (`uv run pytest`).
- Every non-trivial piece of logic gets at least one test.
- The API v1 fixture replay is the most important test (`worker/test/api-v1-replay.test.ts`).
- Reference fixtures from the real libraries cover all reimplemented behaviour:
  - exSpy's background removal and smoothing (`data/fixtures/process.json`)
  - thickness
  - HSPY output that HyperSpy opens.
- Tests check API v2 responses against the zod schemas with strict objects.
- Sync tests check three things:
  - The committed D1 seed is current.
  - `worker/public/py/` matches `python/eelsdb/`.
  - The settings section links match the headings.
- Some tests need a running Worker: exSpy end to end, OAI XSD validation and DCAT SHACL validation. They run when `EELSDB_API` is set. For example, set `EELSDB_API=http://api.localhost:8787` and run `wrangler dev`.
- We check new pages in a browser with `agent-browser` against `wrangler dev`. We check them in light mode, in dark mode and at phone width.

## Consequences

- Vitest loads `worker/.env`, so real local keys can change test results. `vitest.config.ts` pins the Turnstile, email and ORCID bindings.
- Test users have made-up data and ids from 9910000. The tests delete them afterwards.
- Test users are not marked as test accounts. Leftover test users therefore appear on public pages, such as the moderators page.
- We generated the password hash test vectors independently, with passlib and bcrypt. We did not use the code under test.
- A browser can keep an old script or stylesheet in its cache and run it. Do a hard reload before you treat a failure as real.
