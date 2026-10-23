---
title: Architecture decisions
description: The main design decisions in EELSdb, with the reasons and research behind them.
sidebar:
  label: Overview
  order: 0
---

These records explain the main design decisions in EELSdb. Each record gives the decision, the reasons for it, the options we rejected and the research we did. [ADR 0000](/docs/adr/0000-record-architecture-decisions/) explains how to write a record.

## Foundations

| Decision | Summary |
|---|---|
| [0001. Cloudflare Workers, D1 and R2](/docs/adr/0001-cloudflare-workers-d1-r2/) | EELSdb runs as one Cloudflare Worker, with D1 for data and R2 for files, on Workers Paid. |
| [0002. No server-side Python](/docs/adr/0002-no-server-side-python/) | Python never runs on the server. It runs in the browser with Pyodide, and in offline scripts. |
| [0003. Browser Python stack](/docs/adr/0003-small-browser-python-stack/) | The browser loads RosettaSciIO and h5py only, and plain JavaScript does the interactive processing. |
| [0004. Server-rendered pages](/docs/adr/0004-server-rendered-hono/) | The Worker renders pages with Hono JSX, and small scripts add the interactive parts. |
| [0005. Docs on Starlight](/docs/adr/0005-docs-astro-starlight/) | The documentation is an Astro Starlight site, built into the Worker's static assets at /docs. |
| [0006. No hard external dependencies](/docs/adr/0006-no-hard-external-dependencies/) | EELSdb works without Zenodo, GitHub, DOI agencies or new HyperSpy releases, and every integration is optional. |

## Data and APIs

| Decision | Summary |
|---|---|
| [0007. Data model](/docs/adr/0007-data-model/) | Values are typed and record their source, migrated records keep their old identity, and original files never change. |
| [0008. API v1 is frozen](/docs/adr/0008-api-v1-frozen-contract/) | API v1 returns exactly what the old site returned, and a replay of recorded responses proves it. |
| [0009. API v2](/docs/adr/0009-api-v2/) | All new code uses API v2, which returns typed values, provenance and paging links. |
| [0010. Migrating public data](/docs/adr/0010-migrating-public-data/) | We record the old site's public data, fix its energy errors and drop dead content. |
| [0011. Migrating accounts](/docs/adr/0011-migrating-accounts/) | We keep real accounts, drop spam, and keep all personal data out of the repository. |
| [0014. Extracted spectra only](/docs/adr/0014-extracted-spectra-only/) | EELSdb keeps single extracted spectra and refuses spectrum images and other large files. |
| [0015. Processed versions](/docs/adr/0015-processed-versions-as-variants/) | Processed versions of a measurement are extra files on one spectrum, not separate spectra. |
| [0023. Licences](/docs/adr/0023-licences/) | Spectra are under ODbL 1.0 unless their record states another licence, such as CC0 for Corex. |
| [0024. Gas phase and X-ray data](/docs/adr/0024-scope-gas-phase-and-xas/) | EELSdb includes gas-phase EELS and soft X-ray absorption spectra, and links to other sites for hard X-ray data. |
| [0025. HSPY files](/docs/adr/0025-hspy-files/) | Every spectrum has an HSPY file, which RosettaSciIO writes without HyperSpy. |
| [0026. Metadata harvesting](/docs/adr/0026-metadata-harvesting/) | EELSdb serves OAI-PMH, DCAT-AP and schema.org metadata, with page URLs as identifiers. |
| [0027. Bulk download](/docs/adr/0027-bulk-download/) | A script outside Cloudflare builds the bulk download from API v2. |
| [0028. Access for AI agents](/docs/adr/0028-agent-facing-surface/) | AI agents read EELSdb through llms.txt, Markdown pages and a skill, without an MCP server. |
| [0035. GitHub data backup](/docs/adr/0035-github-data-backup/) | A GitHub repository holds a copy of every published spectrum as plain files. |

## Contributing data

| Decision | Summary |
|---|---|
| [0012. Submission and moderation](/docs/adr/0012-submission-and-moderation/) | The contributor's browser checks each file, and the moderator's browser makes the published files. |
| [0013. Beam energy and angles](/docs/adr/0013-beam-energy-and-angles/) | Each beam energy and angle records where its value came from, and "unknown" is a valid value. |
| [0016. Edge suggestions](/docs/adr/0016-edge-suggestions/) | A numpy detector suggests edges on the plot, and the contributor confirms them in a text field. |
| [0017. No Python package](/docs/adr/0017-no-package-drafts-api/) | EELSdb has no Python package or CLI. Scripts submit in bulk as drafts, which a person confirms. |

## Accounts

| Decision | Summary |
|---|---|
| [0018. Sign-in](/docs/adr/0018-sign-in/) | Six sign-in methods all end in one function, and ORCID is the first choice. |
| [0019. Two-step sign-in](/docs/adr/0019-two-step-and-passkeys/) | Accounts can add an authenticator app or passkeys, and site settings decide which groups must use them. |
| [0020. One account per person](/docs/adr/0020-one-account-per-person/) | EELSdb links services to one account, asks before it creates an account, and merges duplicates. |
| [0021. Admin account tools](/docs/adr/0021-admin-account-tools/) | Admins can fix locked-out and duplicate accounts, under strict safety rules. |
| [0022. Email and contact form](/docs/adr/0022-email-and-contact/) | The Worker sends email through Cloudflare Email Service, and the contact form emails the admins. |
| [0031. Profiles and privacy](/docs/adr/0031-public-profiles-and-privacy/) | EELSdb publishes only what each person chooses to share, and never publishes a full email address. |

## Website

| Decision | Summary |
|---|---|
| [0029. Spectrum page tools](/docs/adr/0029-spectrum-page-tools/) | The compare, export and processing tools on the spectrum page run in the browser. |
| [0030. Browse page](/docs/adr/0030-browse/) | The browse page uses the API v2 query, updates results live and caches thumbnails in D1. |
| [0033. Visual design](/docs/adr/0033-visual-design/) | The colour, type, logo and layout choices that the code depends on. |

## Quality

| Decision | Summary |
|---|---|
| [0032. Security baseline](/docs/adr/0032-security-baseline/) | The security rules that all code must follow, and the checks that passed. |
| [0034. Testing](/docs/adr/0034-testing/) | Tests run in the Workers runtime, and a replay of recorded responses protects API v1. |
