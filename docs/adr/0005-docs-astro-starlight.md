---
title: "0005. Docs on Starlight"
description: "The documentation is an Astro Starlight site, built into the Worker's static assets at /docs."
adr:
  date: 2026-10-21
---

## Context

The rebuild needs 10–15 pages of documentation. They cover the API, loading spectra in Python, submitting, moderating and the About pages. Hand-built Hono pages work for about five pages. More pages need a sidebar, search, a Markdown pipeline and a build step. Building all of that ourselves would give a worse copy of Starlight.

## Decision

- The docs are an Astro Starlight project in `docs-site/`. The build uses `base: '/docs'` and writes to `worker/public/docs/`. The Worker serves the result as static assets on the same domain. The docs need no subdomain, DNS or CORS.
- The main site stays on Hono ([ADR 0004](/docs/adr/0004-server-rendered-hono/)). We rejected a full Astro rewrite. The site is a dynamic app with sessions, D1 and R2, and a rewrite would touch every route with no benefit to users.
- The content lives in a top-level `docs/` folder, so editors can find it easily. `docs-site/src/content/docs` is a symlink to it.
- The two sites share one design:
  - Both sites load `worker/public/tokens.css`.
  - `docs-site/src/styles/eelsdb.css` maps the Starlight `--sl-*` variables onto the tokens.
  - The nav links live in `worker/src/nav.ts`. The docs header imports them and the logo SVG.
  - Both sites use the same `theme` localStorage key, the same header size and the same column width.
- The docs use these plugins:
  - starlight-codeblocks runs Python and JS code blocks.
  - starlight-llms-txt owns `llms.txt`.
  - starlight-page-actions owns the `.md` routes.
  - starlight-links-validator.
  - starlight-openapi.
- The docs build generates the API v2 OpenAPI file. It imports the route code of the Worker to do this. The repo contains no generated files.
- About, How to cite, Logo and colours are docs pages at `/docs/about/…`. The old addresses redirect with 301 and forward the old `#cite` and `#logo` fragments. The moderators page and the contact form stay Worker pages, because they read D1 or post data.
- The docs turn off the Starlight 404 route (`disable404Route: true`). Any path that the assets do not match goes to the Worker 404 page. This includes `/docs/`.
- The docs header shows the signed-in state from a small account cache. Main-site pages write this cache to the browser. The header refreshes it from `/account/me.json` after 10 minutes. The header therefore does not jump when the page loads.

## Consequences

- The project has a second toolchain. It runs only at build time and stays out of the Worker bundle.
- We found these problems:
  - Vite resolves symlinks to their real path. This breaks relative imports in `.mdx`. Set `vite.resolve.preserveSymlinks: true`.
  - Git and GitHub do not follow directory symlinks, so "Edit page" and "Last updated" were wrong. `docs-site/src/routeData.ts` points them at the real file.
  - starlight-links-validator skips links without the `/docs/` prefix and gives no warning.
  - Generated API pages have no Markdown source, so "Copy Markdown" would return 404. A `PageTitle` override removes those buttons on those pages.
  - `llms.txt` leaves out pages that plugins generate. It links the OpenAPI files instead.
  - A custom codeblocks adapter list replaces the plugin defaults.
  - `wrangler dev` can miss a docs rebuild in `public/`. Touch any file there to fix it.
- In the docs, use "term: explanation" lists instead of tables. Tables become too narrow on phones.
- Code blocks link names to the HyperSpy and eXSpy Sphinx inventories (`objects.inv`). Only names that the block imports get links.
- The HyperSpy snippets on main-site pages copy the code style of the docs by hand. One `HyperSpySnippet` component does this with Night Owl token spans. Expressive Code at build time would add tens of KB to each page. Review this choice if the site gets many code blocks.
