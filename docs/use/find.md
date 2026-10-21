---
title: Find spectra
description: Search and filter EELSdb spectra by element, edge, formula, energy range, resolution, author and acquisition settings.
---

The [browse page](/spectra/) lists every published spectrum and has filters in the side panel.
On every page of the main site, the **Search spectra** box in the header searches the titles.
On the [home page](/), click an element on the periodic table to list every spectrum that contains it.

## Filter the list

The filters combine: a spectrum must match all of them.

- Title or description: Text in the specimen name or the contributor's comments.
- Type: Core loss, low loss, zero loss or X-ray absorption. Select more than one to include each of them.
- Phase: Solid and liquid spectra by default. Choose **Gas only** to see gas-phase spectra.
- Formula contains: Text in the chemical formula, for example `TiO2`.
- Elements: Spectra that contain all the selected elements. Type symbols or names separated by spaces or commas, for example `Fe O`, or choose each one from the list. The number after each element is its spectrum count.
- Edge: One edge, for example `L2,3`. EELSdb matches the whole edge name, so `L2` does not match `L2,3`.
- Keywords: Spectra that have all the selected keywords. On a spectrum page, click a keyword to list the spectra that have it.
- Energy range, in eV: **Starts at or above**, **Ends at or below**, and **Includes** (spectra whose range contains that energy).
- Resolution at or better than: The largest energy resolution to include, in eV.
- Author: Part of the contributor's name. Separate several names with commas to include each of them.
- Monochromated only: Spectra recorded with a monochromator.
- Beam energy and angles known: Spectra whose beam energy, convergence angle and collection angle are all recorded.

Click a column heading in the results to sort by it. Click it again to reverse the order.

The browse page keeps the filters in its address, so you can bookmark a search or send it to a colleague.
For example, [`/spectra/?element=Fe&element=O`](/spectra/?element=Fe&element=O) lists the spectra that contain both iron and oxygen.
The browse page uses the same filter names as [API v2](/docs/use/api/#filter-and-sort), so you can turn a browse address into an API query.

## Keep a list of favourites

Sign in, then click the star on a spectrum page.
Your [account page](/account/) lists your favourite spectra.

## Find a contributor's spectra

Click the contributor's name on a spectrum page.
Their author page lists every spectrum they contributed, and their public profile if they have one.
