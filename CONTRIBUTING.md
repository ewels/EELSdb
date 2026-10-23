This guide is for people who change the EELSdb website code. To share spectra, use the submit form on [eelsdb.eu](https://eelsdb.eu) instead.

## How we work

Small changes need no architecture decision record (ADR). Examples are bug fixes, wording changes and small improvements. Open a pull request for them.

Larger features and changes follow these steps:

1. Open a GitHub issue that describes the problem or the feature.
2. Write an ADR in `docs/adr/` and open a pull request with it. [ADR 0000](https://eelsdb.eu/docs/adr/0000-record-architecture-decisions/) explains the format.
3. Discuss the ADR in the pull request until we agree on it. Then merge it.
4. Build the change with an AI coding agent. Give the agent the ADR as its specification.
5. Open a pull request with the code, and link it to the issue and the ADR.

If the build shows that the decision must change, update the ADR in the same pull request.

The [architecture decisions](https://eelsdb.eu/docs/adr/) explain why the site works the way it does. Read the relevant records before you change a design.

## Set up

Everything runs on your computer. You do not need a Cloudflare account.

You need Node.js and [uv](https://docs.astral.sh/uv/).

```bash
cd worker
npm install
npm run seed     # build the local D1 database and R2 bucket from data/fixtures and data/cache
npm run dev      # wrangler dev: pages on http://localhost:8787, API on http://api.localhost:8787
```

Copy `worker/.env.example` to `worker/.env` for OAuth, Turnstile and other keys. The site works without them. With the default `EMAIL_PROVIDER=log`, the site writes emails to the `wrangler dev` log and sends nothing.

## Where things are

- `worker/` is the Cloudflare Worker (TypeScript, Hono). It serves the pages, both APIs and the static files.
- `worker/migrations/` holds the D1 schema as plain SQL migrations.
- `docs/` holds the documentation pages as Markdown. `docs-site/` is the Astro Starlight project that builds them into `worker/public/docs/`.
- `python/eelsdb/` holds the file reader and checks that the browser runs with Pyodide. `npm run py` in `worker/` copies them to `worker/public/py/`.
- The other files in `python/` are single scripts for uv that import and export data. Each script lists its dependencies in its header.
- `data/fixtures/` holds recorded public data and test fixtures. `data/cache/` holds downloaded spectrum files and is not in git.

## Test

Run the Worker tests and the type check before you open a pull request:

```bash
cd worker
npm test
npx tsc --noEmit
```

Run the Python tests from `python/`:

```bash
cd python
uv run pytest
```

Some tests need a running Worker. Start `npm run dev`, then set `EELSDB_API=http://api.localhost:8787` before you run `pytest`.

Add at least one test for each piece of logic that is not trivial. The API v1 replay test (`worker/test/api-v1-replay.test.ts`) is the most important test in the repository.

## Build the docs

```bash
cd docs-site
npm install
npm run build    # or `npm run docs` from worker/
npm run dev      # live preview on http://localhost:4321/docs/
```

If `wrangler dev` runs while you rebuild the docs, it can miss the new files. Change any other file in `worker/public/` to make it reload.

## Rules

- Do not build anything new on API v1. It is frozen, and it exists only for exSpy and old scripts. Use API v2 for the website, examples and new tests.
- Do not commit personal data. The old database dump contains emails, password hashes and addresses. Only the account scripts read it, and they write to `data/private/`, which git ignores.
- Do not commit secrets. Keys go in `worker/.env`. List new key names in `worker/.env.example`.
- Treat the live site as read-only. Scripts may send only `GET` requests to eelsdb.eu and api.eelsdb.eu, at most one per second, with a User-Agent that names the project.
- Keep dependencies few. Prefer platform features (Web Crypto, `fetch`, D1, R2) to libraries. Check the latest version of a package when you add it.
- Write plain SQL migrations. Do not use an ORM.
- Write code comments only to explain why. Do not describe what the code does.
- After you change `wrangler.jsonc`, run `npm run types` in `worker/`.
