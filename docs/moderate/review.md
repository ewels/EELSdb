---
title: Review submissions
description: How EELSdb moderators check submissions and instrument profiles, on the website or with eelsdb review.
---

Moderators check each new spectrum, each edit to the data of a spectrum, and each new instrument profile version before EELSdb publishes it.
An administrator gives the moderator role on the **Users and roles** admin page.
The [moderators page](/moderators/) lists the current moderators.

There are two ways to review:

- **On the website**, from the [moderation page](/admin/). Use it for quick decisions and for text-only problems.
- **With `eelsdb review`** on your computer. It reads the file again with pinned versions of RosettaSciIO and exSpy, and uploads the processed MSA and HyperSpy files. Use it to publish a new spectrum with processed files.

## Decide on the website

1. Open the [moderation page](/admin/). It lists the submissions and the instrument profile versions that wait for a decision.
2. Open a submission. The page shows:
   - the files;
   - the results of the browser checks, or a note that the submitter's browser did not run them;
   - for an edit, the proposed values beside the current values.
3. Choose a decision, add notes for the submitter, and save.

What each decision does:

- Approve: EELSdb publishes the spectrum, or applies the edit.
- Request changes: The submitter gets an email with your notes and can edit the submission. It then comes back to the queue.
- Reject: The submission is not published. The submitter gets an email with your notes.

Write notes that the submitter can act on, for example "The convergence angle of 100 mrad looks too large. Please check it."

For instrument profiles, open the profile version and click approve or reject.

## Review with eelsdb review

Install the [`eelsdb` tool](/docs/share/command-line/#install) and sign in with `eelsdb login`, using a token from your moderator account.
Then run:

```sh
$ eelsdb review
```

For each submission in the queue, `eelsdb review`:

1. downloads the file (for an edit with a new file, that file);
2. reads it with RosettaSciIO and runs the [file checks](/docs/share/checks/) with the exSpy edge table;
3. makes an MSA file with the EELS header fields and a HyperSpy file with the metadata;
4. opens a review page in your browser, with the plot and the submitter's values beside the values from the file;
5. asks for a decision: `a` approve, `c` request changes, `r` reject or `s` skip.

When you approve, `eelsdb review` uploads the MSA and HyperSpy files, a JSON file with all the metadata in the original file, and a processing record with the tool versions. Then it publishes the spectrum.
`eelsdb review` does not process the contributor's processed versions. EELSdb publishes them as they were uploaded.

Options:

- `--id N`: Review only submission N.
- `--no-browser`: Do not open the review page. The path of the page is still printed.

## What to look for

- The file reads, and the plot looks like the spectrum type: A zero-loss peak at 0 eV for a low-loss spectrum, edges at the right energies for a core-loss spectrum.
- The formula, the elements and the edges agree with each other and with the plot.
- The beam energy and angles are plausible for the microscope. "Unknown" is a valid answer; a guess is not.
- The reference is the paper that the spectrum comes from.
- The submission is not spam. Every spam submission on the old site had no data file.
