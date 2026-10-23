---
title: "0017. No Python package"
description: "EELSdb has no Python package or CLI. Scripts submit in bulk as drafts, which a person confirms."
adr:
  date: 2026-10-21
---

## Context

Three needs could each justify a dedicated Python package:

- Users want to load spectra.
- Contributors want to submit many spectra at once.
- Moderators want to process submissions.

A package is one more thing to maintain and release. The project owner said: "I would rather push people to use standard packages instead of our own custom cli / python package that we have to maintain." People who want tools can build them on the API. HyperSpy, RosettaSciIO and exSpy ship no command-line tool that we could build on.

## Decision

- EELSdb has no package and no CLI.
- Users load spectra with standard tools:
  - HyperSpy can read the Worker's MSA download (`/spectra/{slug}/download/msa`). Every published spectrum has this download, with beam energy and angles in the header.
  - Every spectrum has an HSPY file ([ADR 0025](/docs/adr/0025-hspy-files/)).
  - `requests` can call API v2.
  - exSpy's `eelsdb()` works, but it uses v1.

  The "Use in HyperSpy" snippets use plain HyperSpy and not `exspy.data.eelsdb()`, because `exspy.data.eelsdb()` builds on v1.
- Moderation runs in the browser ([ADR 0012](/docs/adr/0012-submission-and-moderation/)).
- Bulk submission uses drafts. `POST /v2/drafts` saves a spectrum with `status = 'draft'` in the owner's account. The request is multipart and uses the field names of the submit form. The v2 OpenAPI file documents it. The endpoint needs a drafts-only token (`draft_tokens`). The owner makes and revokes these tokens on the account's token settings page. A drafts token cannot submit or change anything else. The Worker records omitted beam energy and angles as unknown.
  - Only the owner can see a draft. Moderators cannot see drafts.
  - The owner checks each draft in the edit form and then submits it. The edit form runs the browser checks on the stored file and shows the licence agreement. The owner can also submit or delete several drafts at once.
  - Each user can save at most 200 drafts an hour. A daily cron deletes drafts older than 30 days and their files.
  - Drafts tokens stop working for accounts that must set up two-step sign-in ([ADR 0019](/docs/adr/0019-two-step-and-passkeys/)).
  - The `eelsdb` agent skill documents the endpoint and the never-guess rule ([ADR 0028](/docs/adr/0028-agent-facing-surface/)).

## Reasons for drafts rather than an MCP server

- For reading, MCP adds little over `llms.txt`, the Markdown pages, the OpenAPI file and the skill ([ADR 0028](/docs/adr/0028-agent-facing-surface/)).
- For writing, MCP does not solve the hard parts:
  - A remote MCP server cannot see the user's local files.
  - A local MCP server is a package to maintain.
  - MCP needs EELSdb to be an OAuth provider.
  - EELSdb needs a write API underneath in any case.
- An agent is useful because it fills in metadata, and that is also the risk. A guessed convergence angle breaks the rule that "unknown is valid". So a person confirms each draft in the browser.
- Drafts need no new services. MCP would add `workers-oauth-provider`, which needs a KV namespace. It would also add Durable Objects, with the Agents SDK `McpAgent`. Both fit the free plan, but they are more services to run.
- The code treats a drafts token as a scoped token (`drafts:write`), so future OAuth tokens can reuse the code.

## Alternatives considered

- An `eelsdb` package with a CLI and an `eelsdb.load()` helper. The CLI would have `login`, `check`, `submit` (for files and folders), `review` and `export`. We rejected it for these reasons:
  - It has a maintenance cost.
  - Standard tools cover loading.
  - Review works better in the browser, with pinned versions and nothing to install.
  - Drafts cover bulk submission.
  - A folder-based bulk upload is also weak. Each spectrum needs a hand-written metadata file, and every file repeats the shared values. Nothing is pre-filled from headers. The checks run without elements or edges.
- Keep only `check` and `submit` as a power-user extra. This is still a package to maintain.
- A submit function upstream in exSpy. It would depend on exSpy's maintainers and releases. exSpy's EELSdb code builds on frozen v1. HyperSpy core is generic.
- `eelsdb.submit(signal)` from a HyperSpy signal. HyperSpy metadata has no title, type, formula, edges, reference or instrument.
- A CSV batch format. We could add it later. Drafts cover the need now.
- EELSdb as an OAuth/OIDC provider now. No users need "Sign in with EELSdb" on other sites yet. EELSdb keeps one session system and one sign-in page, so a future consent screen will inherit two-step sign-in.
