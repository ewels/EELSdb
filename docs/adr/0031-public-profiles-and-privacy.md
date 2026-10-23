---
title: "0031. Profiles and privacy"
description: "EELSdb publishes only what each person chooses to share, and never publishes a full email address."
adr:
  date: 2026-10-22
---

## Context

On the old site, the `/registered-users/` and `/author/` API routes showed email addresses and other personal data to the public. The rebuild credits contributors by name and ORCID iD. It must publish nothing that a person did not choose to share.

## Decision

- The site has no public list of users.
- A user has a public page (`/author/{username}/`) only in these cases (`HAS_PAGE_SQL`):
  - The user has published spectra.
  - The user chose to show profile details or links.
  - The user is a moderator or admin.
- A staff page with nothing else public shows only the name, the initials avatar and the role.
- Two switches control the visibility of profile sections. `show_details` controls the job title and affiliation. `show_links` controls web pages, social accounts and the ORCID iD. Both switches are off for new accounts.
- `show_links` also controls whether the metadata formats publish the ORCID iD ([ADR 0026](/docs/adr/0026-metadata-harvesting/)).
- The site always shows an uploaded picture wherever avatars appear.
- Without an uploaded picture, `use_gravatar` controls whether the site looks up the account's primary confirmed address on Gravatar. If it is off, the site shows initials everywhere, also in the account's own header. Only the hash of the address reaches the page.
- The browser shrinks uploaded pictures to 256 px. The site refuses SVG, because SVG can carry scripts. The server checks the magic bytes.
- Email addresses are never public. They do not appear in pages, APIs or metadata. The masked uploader hint shows only the first letter and the domain ([ADR 0020](/docs/adr/0020-one-account-per-person/)).
- The site shows an ORCID iD publicly only if it comes from a linked ORCID identity ([ADR 0020](/docs/adr/0020-one-account-per-person/)).
- The public history shows only events after publication. The draft, submission and approval steps are not public.
- The contact form stores no IP address. The site deletes messages after a year ([ADR 0022](/docs/adr/0022-email-and-contact/)).
- Admin logs hold field names, not values. They never hold secrets ([ADR 0021](/docs/adr/0021-admin-account-tools/)).

## Consequences

- API v1 `/registered-users/` and `/author/` return only contributors, without personal fields. This is a deliberate difference from the old API ([ADR 0008](/docs/adr/0008-api-v1-frozen-contract/)).
- The site stores the theme on the account, and the server applies it. The site also stores the theme in `localStorage`, which the docs site shares.
