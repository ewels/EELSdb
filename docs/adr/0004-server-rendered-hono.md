---
title: "0004. Server-rendered pages"
description: "The Worker renders pages with Hono JSX, and small scripts add the interactive parts."
adr:
  date: 2026-10-20
---

## Context

The Worker serves several things from one deployment:

- a website with tables, forms and a plot
- a byte-exact legacy API
- a new API
- OAuth sign-in
- admin screens.

The old site broke down partly because its toolchain and plugins drifted. The project should have few dependencies and little build machinery.

## Decision

- Hono is the Worker framework. The Worker renders pages on the server with `hono/jsx`. API v2 uses `@hono/zod-openapi` ([ADR 0009](/docs/adr/0009-api-v2/)).
- The site uses no SPA framework, no client-side routing and no hydration. Small vanilla JS files in `worker/public/` handle the interactive parts: the plot, the submit form, the live browse results and settings.
- Pages work without JavaScript wherever practical. Forms post normally, and filters live in the query string.
- The site reads D1 directly. It does not call its own API over HTTP.
- The plot uses uPlot, which is about 50 KB and fast with thousands of points. `npm run vendor` vendors uPlot into `worker/public/vendor/`.
- The site uses no Tailwind and no CSS build step. It has one stylesheet plus `tokens.css`, which holds colour roles with `light-dark()` and fonts. The site shares `tokens.css` with the docs site ([ADR 0005](/docs/adr/0005-docs-astro-starlight/)).
- The project uses no ORM. It uses plain SQL migrations in `worker/migrations/`, bound parameters and an allow-list for `ORDER BY`. API v1 needs exact SQL semantics.
- The server typesets formulas. MathJax and mhchem would add too much client JavaScript for short strings.
- The project keeps dependencies few. Prefer platform features (Web Crypto, `fetch`, D1, R2). Check the latest version of each package at install time.
- The vendored browser libraries are uPlot, `uqr` for QR codes and `@simplewebauthn/browser`. esbuild bundles `@simplewebauthn/browser`.

## Why Hono

- Hono uses Web-standard Request and Response objects, with no Node layer. Bindings come through `c.env`. Tests run in the real Workers runtime.
- Hono is small, has no dependencies of its own and has a stable API.
- `hono/jsx` gives typed templates with automatic escaping, without React.
- Hono has built-in host routing, CSRF protection, security headers and route mounting. These features suit one Worker that holds several apps: site, v1, v2, OAI and auth.

## Consequences

- Hono JSX has no client behaviour, so interactive code lives in separate JS files. As a result, some logic exists twice. For example, the edge-label regex in `submit.js` mirrors the regex on the server. Keep the two in step.
- JSX escaping protects only text that JSX renders. Scripts must not read values back from the DOM into `innerHTML` ([ADR 0032](/docs/adr/0032-security-baseline/)).
- Hono JSX renders a bare `popover` attribute as `popover="true"`. Browsers treat this value as manual, so Esc does nothing. Write `popover="auto"`.
- JSX joins wrapped lines with spaces. In code samples, keep each code line on one JSX line.
- `getComputedStyle` returns `light-dark()` colours unresolved. A script that needs a real colour for canvas drawing resolves it through a hidden probe element.
- SVG presentation attributes cannot take `var()`. Use `style` for these values.
- The layout must start with `<!doctype html>`. Without it, every page renders in quirks mode.
- Revisit the CSS approach if the CSS grows past about 1,000 unstructured lines, or if many front-end contributors join. The options are `@layer`s, split files and a token behind every value.

## Alternatives considered

- A plain Worker with no framework: about 60 routes would become `if` chains, with CSRF and escaping written by hand.
- Astro, SvelteKit or Next.js: these frameworks are built around pages and do not suit a byte-exact legacy API. They also bring churn in adapters and builds. The project uses Astro for the docs only ([ADR 0005](/docs/adr/0005-docs-astro-starlight/)).
- itty-router: a project on itty-router ends up rebuilding Hono.
- An SPA on API v2: the pages are tables and forms. HTML from the server gives a faster first paint and avoids duplicate validation and auth.
