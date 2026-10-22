---
title: Prepare drafts with an assistant
description: Let an AI assistant or a script prepare many spectra as drafts, then check them and submit them on the website.
---

To share many spectra, let an AI assistant or a script prepare them as drafts. An assistant can read the file headers and your notes and fill in the form for each spectrum. You then check each draft on the website and submit it.

A draft is not public, and moderators do not see it. Nothing goes to review until you submit it.

## Make a token

1. [Sign in](/docs/share/sign-in/) and open [Your drafts](/account/drafts/).
2. Under **Let an assistant make drafts**, type a label, for example "laptop", and click **Make a token**.
3. Copy the token. The page shows it only once.

A token can only make drafts in your account. It cannot submit, publish or change anything else. Treat it like a password. Revoke it on the same page when you no longer need it. Making or revoking a token needs a sign-in in the last 15 minutes: if yours is older, sign out and sign in again first.

## Give it to your assistant

Install the [`eelsdb` agent skill](/docs/use/agents/#install-the-agent-skill). It tells the assistant how to make drafts, and that it must not guess values.
Then ask in plain words, for example:

> Make EELSdb drafts for the spectra in `spectra/`. The token is in the `EELSDB_DRAFT_TOKEN` environment variable. Take the beam energy and angles from the file headers or from `notes.md`, and leave out any value you cannot find.

Give the token to the assistant in an environment variable or a file, not in the chat.

## Check and submit

If the site requires a [linked ORCID iD](/docs/share/submit/#orcid-id) to submit, you need one to submit a draft. Making drafts, and checking them, does not need it. The drafts page and the check page show a **Link ORCID** button when it is missing.

1. Open [Your drafts](/account/drafts/). The table shows each draft with its file, beam energy and angles, and where each value came from. "Unknown" means the assistant did not find the value.
2. Click a draft to open it in the submit form. The form plots the spectrum and runs the [file checks](/docs/share/checks/) in your browser. Correct what is wrong.
3. Agree to the licence and click **Submit for review**.

To send several drafts at once, choose them in the table, agree to the licence and click **Submit the chosen drafts for review**. Open at least one of them first to check that the assistant filled in the form correctly.

Submitted drafts go to the review queue like any other submission. See [Submit a spectrum](/docs/share/submit/#after-you-submit).

EELSdb deletes drafts that are not submitted after 30 days.

## Make drafts from a script

Send each spectrum to `POST https://api.eelsdb.eu/v2/drafts` as `multipart/form-data`, with the token in the `Authorization` header:

```sh
$ curl https://api.eelsdb.eu/v2/drafts \
    -H "Authorization: Bearer $EELSDB_DRAFT_TOKEN" \
    -F file=@hematite.msa -F title=Hematite -F type=coreloss -F formula=Fe2O3 \
    -F edges="Fe_L2,3; O_K" -F beam_energy=200 -F beam_energy_source=file \
    -F ref_doi=10.1016/j.jssc.2009.07.037
```

The fields have the same names as the fields of the submit form. See the [API v2 reference](/docs/api/v2/) and the [field reference](/docs/reference/fields/).

- `file`, `type` and `formula` are required. The title is the file name if you leave it out.
- Leave out `beam_energy`, `convergence` or `collection` when you do not know it. The draft records it as unknown, which is a valid answer.
- Add `beam_energy_source=file` (and `convergence_source`, `collection_source`) when the value comes from the file's header.

The response gives the address where you check the draft:

```json
{"id": 22240, "slug": "hematite", "status": "draft", "review_url": "https://eelsdb.eu/spectra/hematite/edit/"}
```

If a field has a problem, the response is `400` with a message for each field, and nothing is saved.
You can make up to 200 drafts an hour.
