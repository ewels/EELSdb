# Expected differences from the live API

The replay test (`worker/test/api-v1-replay.test.ts`) runs every recorded request against the new Worker. A response must match the recording (status code and parsed JSON) unless this file lists it. The JSON block below is read by the test; the sections after it explain each entry.

```json
{
  "differs": {
    "spectra/order-author-ASC": "sort by author",
    "spectra/order-author-DESC": "sort by author"
  },
  "membership": {
    "spectra/monochromated-0": "monochromated=0 filters",
    "spectra/exspy-monochromated-0-slash": "monochromated=0 filters",
    "spectra/exspy-monochromated-0-noslash": "monochromated=0 filters",
    "spectra/order-ref_year-ASC": "empty meta rows",
    "spectra/order-ref_year-DESC": "empty meta rows"
  },
  "ties": {
    "spectra/order-title-ASC": "tie order",
    "spectra/order-title-DESC": "tie order",
    "spectra/order-direction-lower": "tie order",
    "spectra/exspy-order-title-slash": "tie order",
    "spectra/exspy-order-title-noslash": "tie order",
    "spectra/order-spectrumMin-ASC": "tie order",
    "spectra/order-spectrumMin-DESC": "tie order",
    "spectra/exspy-order-spectrumMin-DESC-slash": "tie order",
    "spectra/exspy-order-spectrumMin-DESC-noslash": "tie order",
    "spectra/order-beamenergy-ASC": "tie order",
    "spectra/order-beamenergy-DESC": "tie order",
    "spectra/order-resolution-ASC": "tie order",
    "spectra/order-resolution-DESC": "tie order",
    "spectra/order-spectrumType-ASC": "tie order",
    "spectra/order-spectrumType-DESC": "tie order",
    "spectra/order-microscope-ASC": "tie order",
    "spectra/order-microscope-DESC": "tie order",
    "spectra/order-monochromated-ASC": "tie order",
    "spectra/order-monochromated-DESC": "tie order"
  },
  "same_as": {
    "spectra/min_energy-ge": "spectra/min_energy-gt",
    "spectra/max_energy-ge": "spectra/max_energy-gt",
    "spectra/resolution-ge": "spectra/resolution-gt"
  },
  "energy_affected": [
    "spectra/min_energy-ge",
    "spectra/max_energy-ge",
    "spectra/exspy-min-max-noslash",
    "spectra/exspy-min-max-slash",
    "spectra/exspy-order-spectrumMin-DESC-noslash",
    "spectra/exspy-order-spectrumMin-DESC-slash",
    "spectra/max_energy-gt",
    "spectra/max_energy-lt",
    "spectra/max_energy-nocompare",
    "spectra/max_energy-zz",
    "spectra/min_energy-gt",
    "spectra/min_energy-lt",
    "spectra/min_energy-nocompare",
    "spectra/min_energy-zz",
    "spectra/order-spectrumMax-ASC",
    "spectra/order-spectrumMax-DESC",
    "spectra/order-spectrumMin-ASC",
    "spectra/order-spectrumMin-DESC"
  ],
  "corrected_energy": [22005, 22007, 22009, 22010, 22012, 22013, 22014, 22015, 22016, 22017, 22018, 22019, 22020, 22022, 22024, 22025]
}
```

## How the test reads each list

- `differs`: the response is not compared, only listed here with a reason below.
- `membership`: only the status code is compared; which spectra come back changes on purpose.
- `same_as`: the response must equal another recording (a deliberate change made this query behave like that one).
- `ties`: the same spectra must come back and the sort values must be in the same order. Spectra with equal sort values may come back in a different order: MySQL returned ties in an order that depended on internal row order, which the public data does not show. Ties in the default formula order *are* reproduced (from each spectrum's position in the recorded default order), so the default order and every exSpy query without `order` match exactly.
- `energy_affected`: the 16 spectra in `corrected_energy` are removed from both sides, and the rest must match exactly (or as `ties`, if listed there too).
- `corrected_energy`: in every comparison, `min_energy` and `max_energy` of these spectra are ignored.
- Links to private spectra in `associated_spectra` are ignored in every comparison.

## Deliberate changes

### Corrected energy ranges (`corrected_energy`, `energy_affected`)

16 spectra exported from HyperSpy (MSA `DATATYPE: Y`, one or more intensity values per line) had impossible energy ranges in the live API (for example `-2051.71 eV` to `70696.6 eV`), because the old PHP parser read the first number on each line as an energy. The new API returns the true range from `OFFSET` and `XPERCHAN` (see `data/fixtures/file-analysis.json`). Filters and sorts on `min_energy`/`max_energy` use the corrected values, so these spectra can appear in or disappear from range queries.

The 8 files with a wrong `XPERCHAN` already had the right range in the live API (the old parser read their X column), so their v1 objects are unchanged. Their files are fixed when they are reprocessed.

### `ge` means "greater than or equal" (`same_as`)

The live API treated every compare value except `gt` and `eq` as "less than or equal", including the documented `ge`. The new API treats `ge` like `gt` (≥). exSpy sends only `gt`, `lt` and `eq`, so it sees no change.

### `monochromated=0` returns only non-monochromated spectra (`membership`)

The live API ignored `monochromated=0` (all spectra). The new API returns only spectra recorded as not monochromated, which is what exSpy users asking for `monochromated=False` expect. `monochromated=1` is unchanged.

### `order=author` (`differs`)

WordPress sorted by the author's internal user ID, which is not public data. The new API sorts by the author's display name.

### `order=ref_year` (`membership`)

WordPress listed only spectra with a `ref_year` database row, including empty rows that the API never showed, so which spectra it included cannot be reproduced. The new API lists all spectra, with missing years first (ascending).

### Links to private spectra

One spectrum (21675) listed a private spectrum under `associated_spectra`, with its title and a link that led to a login page. The link is dropped.

## Deliberate changes not covered by a recording

These are tested in `worker/test/api-v1.test.ts`:

- An `author` search that matches no one returns `[]`. On the live site it dropped the filter and listed every post of the spectra type, including private spectra and the 1,877 spam submissions with their authors' names, so those queries were not recorded.
- `author` matches display names and profile slugs only, not logins, emails or URLs.
- `edge` matches whole edge names: `K` matches `C_K` but not `K_L2,3`. (No recorded query changes, because no published spectrum has a potassium edge.)
- `/` returns the route index (the live site redirected to eelsdb.eu; `/index.php` returned the index and still does).
- `/registered-users/` and `/author/{slug}/` list contributors only (people with published spectra), with no email, address, phone or social IDs other than ORCID.
- `Access-Control-Allow-Origin: *` on every API response.

## Kept on purpose

- `min_energy` and `max_energy` filters compare against values rounded to whole eV, and `resolution` against values truncated to whole eV, because WordPress cast the stored strings with `CAST(… AS DECIMAL)` and `CAST(… AS SIGNED)`. For example `resolution=0.5&resolution_compare=lt` also returns spectra with 0.9 eV resolution. This matches the live API exactly but is probably not what users expect; see the open questions in `TODO.md`.
- An empty page after the first returns the 404 body, as WordPress did.
