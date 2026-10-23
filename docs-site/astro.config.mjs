import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import codeblocks, { linksValidatorExclude } from 'starlight-codeblocks';
import { python } from 'starlight-codeblocks/adapters/python';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import starlightPageActions from 'starlight-page-actions';

import { openapiV2 } from '../worker/src/api/v2.ts';

// API v2's OpenAPI file comes from the Worker's route schemas, the same code that serves /api/openapi-v2.json.
// v1 is frozen, so its file is written by hand.
const OPENAPI_V2 = '.astro/openapi-v2.json';
mkdirSync('.astro', { recursive: true });
writeFileSync(OPENAPI_V2, JSON.stringify(openapiV2(), null, 1));

// CONTRIBUTING.md at the repo root is the source of the Development > Contributing page. The copy in docs/ is
// generated (and gitignored) so the page is plain Markdown for search, the table of contents and its .md route.
mkdirSync('../docs/development', { recursive: true });
writeFileSync(
  '../docs/development/contributing.md',
  `---
title: Contribution guidelines
description: How to set up, test and change the EELSdb website code.
editUrl: https://github.com/ewels/EELSdb/edit/rewrite/CONTRIBUTING.md
---

${readFileSync('../CONTRIBUTING.md', 'utf-8')}`,
);

// The Worker (worker/) serves the build from its static assets at /docs/.
// Fonts and tokens.css come from the Worker too, so `astro dev` proxies them to `wrangler dev`. The favicon is a
// symlink in public/, because Starlight puts it under the /docs base.
const WORKER = 'http://localhost:8787';

// The agent skills live in ../skills/ (where `npx skills add` finds them) and are also served at /docs/skills/.
const skills = {
  name: 'eelsdb-skills',
  hooks: { 'astro:build:done': ({ dir }) => cpSync('../skills', new URL('skills/', dir), { recursive: true }) },
};

export default defineConfig({
  site: 'https://eelsdb.eu',
  base: '/docs',
  outDir: '../worker/public/docs',
  trailingSlash: 'always',
  vite: {
    // src/content/docs links to ../docs/; resolve pages from the link so their imports and node_modules work.
    resolve: { preserveSymlinks: true },
    server: { proxy: Object.fromEntries(['/tokens.css', '/fonts', '/logo', '/partners', '/account/me.json'].map((p) => [p, WORKER])) },
  },
  integrations: [
    skills,
    starlight({
      title: 'EELSdb docs',
      description: 'How to find, download, load and share spectra in the EELS Data Base.',
      favicon: '/favicon.svg',
      head: [{ tag: 'link', attrs: { rel: 'stylesheet', href: '/tokens.css' } }],
      customCss: ['./src/styles/eelsdb.css'],
      editLink: { baseUrl: 'https://github.com/ewels/EELSdb/edit/rewrite/' },
      routeMiddleware: './src/routeData.ts',
      lastUpdated: true,
      // The Worker serves the site's own 404 page for every missing path, /docs/ included.
      disable404Route: true,
      components: {
        Head: './src/components/Head.astro',
        Header: './src/components/Header.astro',
        PageTitle: './src/components/PageTitle.astro',
        MobileMenuFooter: './src/components/MobileMenuFooter.astro',
        MobileMenuToggle: './src/components/MobileMenuToggle.astro',
        Sidebar: './src/components/Sidebar.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      sidebar: [
        { label: 'Overview', link: '/' },
        {
          label: 'Use the data',
          items: ['use/find', 'use/view', 'use/download', 'use/python', 'use/api', 'use/harvest', 'use/agents'],
        },
        {
          label: 'Share spectra',
          items: [
            'share/sign-in',
            'share/submit',
            'share/file-formats',
            'share/beam-energy-and-angles',
            'share/instrument-profiles',
            'share/checks',
            'share/edit',
            'share/drafts',
          ],
        },
        { label: 'Moderate', items: ['moderate/review', 'moderate/accounts'] },
        { label: 'Reference', items: ['reference/fields', ...openAPISidebarGroups] },
        {
          label: 'About',
          items: ['about', 'about/citation', 'about/logo', { label: 'Moderators', link: '/moderators/', attrs: { 'data-site-link': '' } }, 'about/contact'],
        },
        {
          label: 'Development',
          collapsed: true,
          items: [
            'development/contributing',
            { label: 'Architecture decisions', collapsed: true, items: [{ autogenerate: { directory: 'adr' } }] },
          ],
        },
      ],
      plugins: [
        codeblocks({
          swatches: { prose: true },
          apiLinks: {
            adapters: [
              python({
                inventories: [
                  'https://hyperspy.org/hyperspy-doc/current/objects.inv',
                  'https://hyperspy.org/exspy/objects.inv',
                  'https://numpy.org/doc/stable/objects.inv',
                  'https://requests.readthedocs.io/en/latest/objects.inv',
                ],
              }),
            ],
          },
        }),
        starlightOpenAPI([
          { base: 'api/v2', schema: OPENAPI_V2, sidebar: { label: 'API v2 reference' } },
          { base: 'api/v1', schema: '../worker/src/api/openapi-v1.json', sidebar: { label: 'API v1 reference (deprecated)' } },
        ]),
        // The validator sees only content pages: not the Worker's pages outside /docs/, the starlight-openapi pages, the
        // skills copied in after the build, or the generated .md and .txt files.
        starlightLinksValidator({
          exclude: ({ link }) =>
            !link.startsWith('/docs/') || /^\/docs\/(api|skills)\//.test(link) || /\.(txt|md)$/.test(link) || linksValidatorExclude({ link }),
        }),
        starlightLlmsTxt({
          projectName: 'EELS Data Base',
          description:
            'Open reference spectra for electron energy-loss (EELS) and X-ray absorption (XAS) spectroscopy, with a public JSON API.',
          customSelectors: { all: ['.scb-deco'] },
          // The generated API reference pages are not in llms-full.txt; their OpenAPI files describe the API in full.
          optionalLinks: [
            { label: 'API v2 OpenAPI file', url: 'https://eelsdb.eu/api/openapi-v2.json', description: 'Every API v2 parameter and response field.' },
            { label: 'API v1 OpenAPI file', url: 'https://eelsdb.eu/api/openapi-v1.json', description: 'Deprecated. The old API, kept only for exSpy and older scripts.' },
          ],
        }),
        starlightPageActions({
          prompt: 'Read {url}. It is a page of the EELS Data Base documentation. I want to ask questions about it.',
          share: false,
        }),
      ],
    }),
  ],
});
