# AGENTS.md

This file guides AI coding agents (Claude Code, Codex, Cursor and others) that work in this repository.

The repository is a from-scratch rebuild of [eelsdb.eu](https://eelsdb.eu), a public database of EELS and XAS reference spectra. It runs on Cloudflare Workers with D1 and R2. The old WordPress site is on the `main` branch; read it with `git show main:wp-content/...` when you need to check how something used to work.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for set-up and workflow. The architecture decision records in [`docs/adr/`](docs/adr/) (index in `docs/adr/index.md`) are the accepted design and explain why the site works the way it does. Read the relevant ADRs before you change a design.

## Workflow

- Small changes (bug fixes, wording, small improvements) need no ADR.
- Larger changes follow: GitHub issue → ADR pull request, discussed and merged → build with the ADR as the specification → code pull request linked to the issue and ADR.
- If the build shows the decision must change, rewrite the ADR in the same pull request.
- Write ADRs by the rules in [ADR 0000](docs/adr/0000-record-architecture-decisions.md): describe the decision as it stands now (no history; git has that), put losing options and why they lost under "Alternatives considered", keep research and measurements, and never include personal data.

## Hard rules

- **No `git push`, deploy or cloud resources unless the user asks.** That covers `wrangler deploy`, `wrangler d1 create` against a real account and DNS changes. Development runs locally (`wrangler dev`, local D1/R2 through Miniflare); no Cloudflare account is needed.
- **The live site is read-only.** Only `GET` requests to eelsdb.eu and api.eelsdb.eu, at most 1 per second, with a User-Agent that names this project, for example `EELSdb-rewrite/0.1 (+https://github.com/ewels/EELSdb)`. Never log in, submit forms or call admin URLs.
- **Personal data never enters the repo.** The old site's database dump lives outside the repo and holds emails, password hashes and addresses. Only the account scripts in `python/` (`export_accounts.py`) may read it, and they write to `data/private/` (gitignored). Never print rows from it; log counts only. Never commit anything derived from it except aggregate counts.
- **No secrets in the repo.** Keys go in `worker/.env` (gitignored). List new key names in `worker/.env.example`.
- **Never build on API v1.** It is frozen and deprecated, kept only so exSpy and old scripts keep working ([ADR 0008](docs/adr/0008-api-v1-frozen-contract.md)). Nothing new may depend on it: not the website, docs examples or tests of new features. Use API v2 (`worker/src/api/v2.ts`). Do not add parameters or features to v1, and do not import `worker/src/api/query.ts` outside the v1 routes in `worker/src/api/index.ts`.
- **Questions no ADR settles:** pick the simplest option that keeps the decision reversible and flag it in the pull request. If it is a decision a future developer could get wrong, propose an ADR for it.

## Commands

Worker (run from `worker/`):

```bash
npm install
npm run seed            # build local D1 + R2 (.wrangler/) from data/seed/
npm run dev             # site on http://localhost:8787, API on http://api.localhost:8787
npm test                # Vitest in the Workers runtime
npx vitest run test/api-v2.test.ts        # one file
npx vitest run test/api-v2.test.ts -t "reports bad parameters"   # one test by name
npx tsc --noEmit        # type check; must pass with npm test after every change
npm run types           # regenerate worker-configuration.d.ts after editing wrangler.jsonc (see below)
npm run py              # copy python/eelsdb/*.py to public/py/ (a test fails if they drift)
npm run docs            # build docs-site/ into public/docs/
npm run vendor          # copy browser libraries (uPlot, uqr, simplewebauthn) into public/vendor/
```

`wrangler types` also writes the key names from your local `worker/.env` into `worker-configuration.d.ts`. Those keys are typed as optional in `src/env.d.ts` instead, so remove them from the generated file before committing (or run `npx wrangler types --env-file /dev/null`, which reproduces the committed file).

Python (run from `python/`, managed with `uv`):

```bash
uv run pytest
uv run pytest tests/test_checks.py -k name
EELSDB_API=http://api.localhost:8787 uv run pytest tests/test_exspy_against_worker.py   # needs `npm run dev`
uv run build_seed.py    # rebuild data/seed/ after the fixtures change, then `npm run seed`
```

Docs (from `docs-site/`): `npm run dev` previews on http://localhost:4321/docs/. If `wrangler dev` is running while the docs rebuild, touch another file in `worker/public/` to make it reload.

## Architecture

- **One Worker, two hosts.** `worker/src/index.ts` sends `api.*` hostnames to the `api` Hono app (`src/api/index.ts`) and everything else to `pages` (`src/pages/index.tsx`). It also runs a daily cron that deletes stale drafts and contact messages.
- **API.** `src/api/index.ts` holds the frozen v1 routes (built from `query.ts` and `format.ts`, and replayed against recorded responses in `data/fixtures/api-v1/`). It mounts `/v2` (`@hono/zod-openapi`; the OpenAPI document is generated from the zod schemas in `v2-schema.ts`), `/oai` (OAI-PMH) and `/dcat`. The browse page reuses v2's `spectraFilter`/`listSpectra`.
- **Pages** are server-rendered Hono JSX (`.tsx`) with `pages/layout.tsx` as the shell; little client JS. Most pages also have a `.md` twin for agents (`/spectra/{slug}.md`, `/llms.txt`). Feature areas (`account`, `settings`, `submit/`, `instruments`, `admin`, `contact`) are sub-apps mounted on `pages`. `auth.ts` loads the user into `c.get("user")`; sign-in covers ORCID/Google/GitHub OAuth, email links, migrated legacy passwords, TOTP and passkeys.
- **Storage.** D1 (`DB`) holds everything relational; the schema is plain SQL in `worker/migrations/` (no ORM, add a new numbered file rather than editing an old one). R2 (`FILES`) holds spectrum files, processed variants and the bulk export. Static files come from `worker/public/` via the `ASSETS` binding.
- **No server-side Python.** The file reader, checks and review processing in `python/eelsdb/` run in the browser through Pyodide, served from `worker/public/py/`. The same modules are tested with pytest, so `python/eelsdb/` is the source and `public/py/` is a copy.
- **Submission flow.** Contributors build drafts in the web form (`submit/`); moderators approve, request changes or reject (`moderation.ts`). Processed outputs (MSA, HSPY, metadata) are stored as variants of the original.
- **Data pipeline.** Python scripts in `python/` record public data from the live site into `data/fixtures/` and download spectrum files into `data/cache/` (not in git). `build_seed.py` turns these into `data/seed/seed.sql` and `r2-uploads.json`, which `npm run seed` and the test setup load. Each script is a single `uv` script with its dependencies in its header.
- **Docs.** Markdown in `docs/` (including the ADRs) is built by the Astro Starlight project in `docs-site/` into `worker/public/docs/` (gitignored). `skills/eelsdb/SKILL.md` is the public agent skill for using EELSdb.
- **Design.** `DESIGN.md` holds the design tokens and rules; `PRODUCT.md` describes the users. Read both before UI work.

## Testing

- The API v1 replay test (`worker/test/api-v1-replay.test.ts`) is the most important test in the repo. If it fails, the change is wrong.
- Worker tests run in the real Workers runtime with local D1/R2 (`@cloudflare/vitest-plugin`). `test/setup.ts` applies migrations and loads the seed. `vitest.config.ts` pins OAuth, Turnstile and email bindings so `worker/.env` can't change results.
- Test users use made-up data with ids from 9910000 and must be deleted afterwards.
- Behaviour reimplemented from libraries (exSpy background removal and smoothing, thickness, HSPY output) is checked against reference fixtures produced by the real libraries.
- Sync tests check that the committed seed is current, that `public/py/` matches `python/eelsdb/`, and that settings links match headings.
- Every non-trivial piece of logic gets at least one test.
- Check new pages in a browser against `wrangler dev` in light mode, dark mode and at phone width. Hard-reload before trusting a failure; cached scripts linger.

## Conventions

- Keep dependencies few. Prefer platform features (Web Crypto, `fetch`, D1, R2) to libraries. Check the latest npm/PyPI version when you add a package; don't use versions from memory.
- TypeScript for the Worker; Python with `uv` for data import, checks and the in-browser code.
- Code comments only explain *why*, never narrate what the code does.
- After editing a GitHub Actions workflow, run `npx actions-up` and `zizmor`.
