---
title: Review submissions
description: How EELSdb moderators check submissions and instrument profiles on the moderation page.
---

Moderators check each new spectrum, each edit to the data of a spectrum, and each new instrument profile version before EELSdb publishes it.
An administrator gives the moderator role on the **Users and roles** admin page.
The [moderators page](/moderators/) lists the current moderators.

You review on the website. You do not need to install anything.

## Review a submission

1. Open the [moderation page](/admin/). It lists the submissions and the instrument profile versions that wait for a decision.
2. Open a submission. The page shows:
   - the files;
   - **Checks at review**: your browser reads the file again and shows the results (see below);
   - **Checks at submission**: the results of the checks in the submitter's browser, or a note that their browser did not run them;
   - for an edit, the proposed values.
3. Read the results, choose a decision, add notes for the submitter, and save.

What each decision does:

- Approve: EELSdb publishes the spectrum, or applies the edit.
- Request changes: The submitter gets an email with your notes and can edit the submission. It then comes back to the queue.
- Reject: The submission is not published. The submitter gets an email with your notes.

Write notes that the submitter can act on, for example "The convergence angle of 100 mrad looks too large. Please check it."

For instrument profiles, open the profile version and click approve or reject.

## Checks at review

When you open a submission, your browser reads the file with a pinned version of RosettaSciIO. It takes some seconds the first time, while the reader downloads. Then the page shows:

- a plot of the spectrum;
- the [file checks](/docs/share/checks/), run against the type, formula, elements and edges of the submission (for an edit, against the proposed values);
- the beam energy and angles that the submitter gave, beside the values in the file. Values that do not agree are highlighted.

The **Approve** button is available when the checks are done.
When you approve, your browser uploads the files that it made, and then EELSdb publishes the spectrum:

- an MSA file with the EELS header fields;
- a HyperSpy (`.hspy`) file with the metadata;
- a JSON file with all the metadata in the original file;
- a processing record with the tool versions.

For an edit, these files replace the published ones only when you approve.
EELSdb does not process the contributor's processed versions. It publishes them as they were uploaded.

If your browser cannot read the file, the page tells you why. You can still decide. If you approve, EELSdb publishes the spectrum without the processed files.

## What to look for

- The file reads, and the plot looks like the spectrum type: A zero-loss peak at 0 eV for a low-loss spectrum, edges at the right energies for a core-loss spectrum.
- The formula, the elements and the edges agree with each other and with the plot.
- The beam energy and angles are plausible for the microscope. "Unknown" is a valid answer; a guess is not.
- The reference is the paper that the spectrum comes from.
- The submission is not spam. Every spam submission on the old site had no data file.

## Update the bulk download

Administrators make the zip file for the [bulk download](/downloads/) page with a script in the EELSdb repository:

```sh
$ uv run python/export.py
```

Then they upload `eelsdb-spectra.zip` in the **Bulk download** section of the [moderation page](/admin/).
