---
title: "0028. Access for AI agents"
description: "AI agents read EELSdb through llms.txt, Markdown pages and a skill, without an MCP server."
adr:
  date: 2026-10-21
---

## Context

More and more people reach data through AI assistants. EELSdb should be easy for these assistants to read correctly. This should not need new services to build and run.

## Decision

- The docs build owns `/llms.txt`. The site also serves `/robots.txt`, which blocks `/admin/`, `/account/` and `/submissions/`.
- Spectrum, author and news pages have Markdown versions at the page address plus `.md` (`worker/src/pages/markdown.ts`). Each page links to its Markdown version with `rel="alternate"`. Docs pages have `.md` routes too.
- One Agent Skill, `skills/eelsdb`, covers reading the API and creating drafts ([ADR 0017](/docs/adr/0017-no-package-drafts-api/)). The skill points to `llms.txt` and the OpenAPI files and does not copy them, so it cannot drift. Users install it with `npx skills add ewels/EELSdb`. The site serves it at `/docs/skills/`.
- EELSdb has no MCP server for now. [ADR 0017](/docs/adr/0017-no-package-drafts-api/) gives the reasons.

## Consequences

- `npx skills add` reads the default branch of the repository. It works only after the rewrite becomes the default branch.
- Agents create drafts and people submit them ([ADR 0017](/docs/adr/0017-no-package-drafts-api/)).
