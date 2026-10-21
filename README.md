<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/ewels/EELSdb/blob/main/logo/mono_white/EELSdb_logo_bw_invert-big.png?raw=true">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/ewels/EELSdb/blob/main/logo/EELSdb_logo-medium.png?raw=true">
  <img alt="Logo for the EELS Data Base" src="https://github.com/ewels/EELSdb/blob/main/logo/EELSdb_logo-medium.png?raw=true">
</picture>

# [EELS Data Base](https://eelsdb.eu) website code

Website source code for the **EELS Data Base** - _Inner & Outer Shell Excitation Spectroscopy Repository_: <https://eelsdb.eu>

## Introduction

Source code for EELSdb. This branch is a fresh rewrite of the site. The previous WordPress plugin and theme are on the [`main`](https://github.com/ewels/EELSdb/tree/main) branch. The repository also holds high-res versions of the logo and past conference posters.

## Development

Everything runs locally. No Cloudflare account is needed.

The Worker (TypeScript, Hono) is in `worker/`:

```bash
cd worker
npm install
npm run seed     # build the local D1 database and R2 bucket from data/fixtures and data/cache
npm run dev      # wrangler dev on http://localhost:8787 (pages) and http://api.localhost:8787 (API)
npm test         # Vitest, in the Workers runtime
```

The documentation pages are Markdown files in [`docs/`](docs/): edit them there. The Astro Starlight site that builds them is in `docs-site/` (its `src/content/docs` is a link to `docs/`). It builds into `worker/public/docs/`, and the Worker serves it at `/docs/`:

```bash
cd docs-site
npm install
npm run build    # or `npm run docs` from worker/; `npm run dev` there builds it once if it is missing
npm run dev      # live preview on http://localhost:4321/docs/, with fonts and tokens from wrangler dev on :8787
```

The docs header uses the site's nav (`worker/src/nav.ts`), logo and colour tokens (`worker/public/tokens.css`). The About, citation, logo and contact pages are in the docs too. The API v2 reference is generated from the OpenAPI file that the Worker builds from its route schemas (`worker/src/api/v2-schema.ts`); the v1 file (`worker/src/api/openapi-v1.json`) is written by hand, as v1 is frozen. Agent skills (`eelsdb`, `eelsdb-submit`) are in `skills/`, where `npx skills add ewels/EELSdb` finds them; the docs build also serves them at `/docs/skills/`. If `wrangler dev` is running when you rebuild the docs, it can miss the new files until another file in `public/` changes.

Run `npm run types` after changing `wrangler.jsonc`. OAuth, Turnstile and other keys go in `worker/.env` (gitignored); `worker/.env.example` lists them.

The Python tools (import scripts, file checks) are in `python/`, managed with [uv](https://docs.astral.sh/uv/):

```bash
cd python
uv run pytest
uv run eelsdb --version
uv run eelsdb check FILE --type coreloss --formula Fe2O3 --edges "Fe_L2,3;O_K"   # offline checks on a spectrum file
uv run eelsdb login                         # paste an API token from /account/tokens/
uv run eelsdb submit FILE --title … --type coreloss --formula …   # or a folder of files with .json fields
uv run eelsdb review                        # moderators: reprocess, compare, decide
```

Point the CLI at a local Worker with `EELSDB_API=http://api.localhost:8787` (and `EELSDB_TOKEN`, or run `eelsdb login --api …`).

```bash
uv run python -m eelsdb.legacy.record_api      # record the live API into data/fixtures/api-v1/
uv run python -m eelsdb.legacy.download_files  # download spectrum files into data/cache/files/
uv run python -m eelsdb.legacy.analyse_files   # write data/fixtures/file-analysis.json
uv run python -m eelsdb.legacy.build_seed      # write the local D1 seed and R2 upload list
```

## Citation

If you use EELSdb in your research, please consider citing the main paper:

> _“A Complete Overhaul of the Electron Energy-Loss Spectroscopy and X-Ray Absorption Spectroscopy Database: eelsdb.eu.”_
>
> Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie.
>
> Microscopy and Microanalysis, 22, 717–724 (2016)
>
> doi: [10.1017/S1431927616000179](http://dx.doi.org/10.1017/S1431927616000179)
