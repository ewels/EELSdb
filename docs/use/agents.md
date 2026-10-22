---
title: Use EELSdb with AI agents
description: The Markdown, JSON and llms.txt addresses that AI assistants and agents can read, the EELSdb agent skill, and how to install it.
---

AI assistants and coding agents can use EELSdb with no extra setup: every page has a Markdown version, the API is plain JSON with no key, and an agent skill describes how to search, download and cite spectra.

## Give an agent these addresses

- [`https://eelsdb.eu/llms.txt`](/llms.txt): What EELSdb is, with links to everything below. Start here.
- [`https://eelsdb.eu/docs/llms-full.txt`](/docs/llms-full.txt): All the documentation in one Markdown file.
- [`https://eelsdb.eu/docs/llms.txt`](/docs/llms.txt): An index of the documentation pages.
- [`https://eelsdb.eu/api/openapi-v2.json`](/api/openapi-v2.json): Every API v2 parameter and response field. The code that serves the API generates it.
- `https://api.eelsdb.eu/v2/spectra?…`: Search results as JSON. See [Use the API](/docs/use/api/).

## Markdown versions of pages

Replace the trailing slash of a page address with `.md` to get the page as Markdown:

- A documentation page: `/docs/use/api/` becomes `/docs/use/api.md`
- A spectrum: `/spectra/iron-iii-oxide-hematite/` becomes `/spectra/iron-iii-oxide-hematite.md`
- A contributor: `/author/simon/` becomes `/author/simon.md`
- A news post: `/hyperspy/` becomes `/hyperspy.md`

A spectrum's Markdown page has its metadata, the source of each acquisition value, its files with checksums, and a ready-made citation with BibTeX.
Each HTML page links to its Markdown version in a `<link rel="alternate" type="text/markdown">` tag, and each spectrum page also links to its API v2 record (`type="application/json"`).

On documentation pages, **Copy Markdown** copies the page, and **Open** sends it to ChatGPT, Claude and other assistants.
The API reference pages have no Markdown version. The OpenAPI files describe the same information.

## Install the agent skill

A skill is a set of instructions that an agent loads when a task needs it.
EELSdb has one, in the [Agent Skills](https://agentskills.io) format that Claude Code, Codex, Cursor and other agents read:

- [`eelsdb`](/docs/skills/eelsdb/SKILL.md): Find, download, load and cite spectra through API v2.

Install it from GitHub with the [`skills`](https://www.npmjs.com/package/skills) tool:

```sh
$ npx skills add ewels/EELSdb
```

Add `-g` to install it for all your projects.

To install a skill by hand, download its `SKILL.md` and save it in your agent's skills folder, for example `~/.claude/skills/eelsdb/SKILL.md` for Claude Code.

## Ask an agent

With the `eelsdb` skill installed, or after you give the agent `https://eelsdb.eu/llms.txt`, ask in plain words. For example:

- "Find EELSdb core-loss spectra of titanium oxides with the Ti L2,3 edge, recorded at 200 kV with known angles, and plot them together."
- "Download the EELSdb hematite Fe L2,3 spectrum and compare its L3/L2 ratio with my file `sample.msa`."
- "Which EELSdb spectra of carbon have a convergence angle from an instrument profile?"

## Rules for agents

The `eelsdb` skill tells agents to follow these rules. Check that yours does:

- Send a User-Agent that names the tool and a contact.
- Ask for 500 spectra per page instead of many small pages, make one request at a time, and use the [bulk download](/downloads/) for the whole database.
- Report an acquisition value with the source `unknown` as unknown. Never fill it in from another spectrum.
- Cite the contributor's paper and the EELS Data Base for every spectrum that the work uses.
- Never submit spectra for the user. The API is read-only, and contributors submit on the website.
