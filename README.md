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

Run `npm run types` after changing `wrangler.jsonc`.

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
