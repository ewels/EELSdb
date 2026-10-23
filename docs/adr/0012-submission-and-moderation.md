---
title: "0012. Submission and moderation"
description: "The contributor's browser checks each file, and the moderator's browser makes the published files."
adr:
  date: 2026-10-20
---

## Context

Contributors are experimentalists. They submit rarely, and often send a backlog of spectra in one sitting. Files come in many formats: DM3/DM4, MSA, EMD, HSPY, two-column text and XDI. The old site checked almost nothing. It also created accounts automatically for anonymous submissions. Moderation should need nothing installed ([ADR 0002](/docs/adr/0002-no-server-side-python/)).

## Decision

### Contributor flow

The contributor flow at `/submit-data/` has these steps:

1. The contributor signs in. The site does not accept anonymous submissions. A site setting can require a linked ORCID iD ([ADR 0018](/docs/adr/0018-sign-in/)).
2. The contributor drops one or more files. Pyodide starts to load when the page opens. Each file gets a card with the check result and a plot. The page assigns roles automatically.
3. The form pre-fills fields from the file: the MSA or XDI header, DM tags and the energy range. Pre-filled fields stay tinted until the contributor edits them.
4. The form has steps, and it validates each step. The XAS step appears only for XAS. A review step runs the checks again.
5. The page sends the form as a background POST, so the files survive a validation error. Without JavaScript, the form is one long page.

### Server on submit

When a contributor submits, the server does these things:

- The server stores the original files in R2, unchanged.
- The server stores the form values and the browser check results in D1.
- The server runs cheap sanity checks: size limits, value ranges and required fields. A file must be present and readable.

The form uses Turnstile. The server derives content types from file extensions and never takes them from the client. The server treats browser check results as untrusted and validates them.

### Rules for fields

- Formula checks only warn. They warn about wrong capitals (with a one-click fix), unknown symbols, unmatched brackets and a mismatch with the elements. The server accepts any non-empty formula. It derives elements only from real symbols. Real submissions include names such as "Zircaloy-4", `(La0.7,Sr0.3)MnO3`, `ZrO2-8.5mol%Y2O3` and `((Y_{0.2} La{0.8})S)1.16-TaS_2`.
- The site never infers elements from edges or the energy range. Onsets lie close together, so a guess is unreliable. Elements come from the formula (until the contributor edits them) or from an XAS file header.
- These fields are required:
  - The specimen name, type and formula.
  - The spectrum file, for new submissions.
  - The licence agreement.
  - The beam energy and both angles, except for XAS. "Unknown" is an allowed answer ([ADR 0013](/docs/adr/0013-beam-energy-and-angles/)).
- A contributor can paste a DOI to fill the reference from CrossRef. A free-text reference is also allowed.

### Moderation

Moderators review each submission at `/admin/submissions/{id}/`.

- The review page loads `review.py` into the same Pyodide, with pinned RosettaSciIO 0.15.0 and h5py. It reads the file and runs the checks with the pinned edge table. It shows the plot and the findings. It also shows the submitted values beside the values in the file.
- The "Approve" button stays disabled until processing has run. On approval, the page uploads these files:
  - The MSA, with EELS header fields.
  - The HSPY file.
  - The file metadata JSON.
  - The processing record.

  The upload uses `POST /admin/submissions/{id}/processed/`, with session and CSRF. Then the page publishes the spectrum.
- If the browser cannot read the file, the moderator can still decide. In that case the site publishes nothing processed.
- The submitter's own browser run never produces published files. That run can fail, and the form continues anyway. Its JSON is untrusted.
- "Request changes" and "Reject" send a message to the submitter. When the submitter edits a submission in "changes requested", it goes back into the queue.
- The site supports several moderators. It records every action in `history`.

### File metadata

At review, the page writes every tag that RosettaSciIO reads to a `metadata` JSON file. An example is the DM tag tree. The page replaces arrays longer than 64 items with a short description. The spectrum page shows the metadata on request, labelled "not checked by a person".

### Editing published spectra

Text changes publish at once. Changes to the file, specimen or measurement wait as an `edit` submission. Approval applies only those changes. Only one such edit can wait per spectrum. The site records all edits in `history`.

### Limits

The limits are per hour and protect only against floods. Each account can send 60 web submissions and create 200 drafts an hour. A daily cap gets in the way of contributors who send a backlog in one sitting.

## Consequences

- The submitter and the moderator see the same checks. Moderators install nothing.
- Published files always come from a reviewed run with recorded tool versions.
- Each spectrum records the rosettasciio, numpy, h5py and pyodide versions in its processing record.
- Drafts ([ADR 0017](/docs/adr/0017-no-package-drafts-api/)) keep work safe across a refresh.
- A microscopist gave this view. DM3/DM4 files matter most. The site should flag file metadata as unchecked. Per-microscope instrument files are not worth the effort.

## Alternatives considered

- A moderator CLI. We rejected it because moderators should install nothing ([ADR 0002](/docs/adr/0002-no-server-side-python/)).
- Showing the submitter the files that would be published. We rejected this because the moderator's run is the one that counts.
- Python Workers or Containers for review. [ADR 0002](/docs/adr/0002-no-server-side-python/) gives the reasons against them.
