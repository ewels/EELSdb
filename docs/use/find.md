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
- Formula contains: Text in the chemical formula, for example `TiO2`.
- Elements: Spectra that contain all the selected elements. The number after each element is its spectrum count.
- Edge: One edge, for example `L2,3`. EELSdb matches the whole edge name, so `L2` does not match `L2,3`.
- Energy range: The start and end energy of the spectrum, in eV. Choose the comparison (greater than, less than or equal to) beside each value.
- Resolution: The energy resolution, in eV.
- Author: Part of the contributor's name.
- Monochromated only: Spectra recorded with a monochromator.
- Beam energy and angles known: Spectra whose beam energy, convergence angle and collection angle are all recorded.

Click a column heading in the results to sort by it. Click it again to reverse the order.

The browse page keeps the filters in its address, so you can bookmark a search or send it to a colleague.
For example, [`/spectra/?element[]=Fe&element[]=O`](/spectra/?element[]=Fe&element[]=O) lists the spectra that contain both iron and oxygen.

## Read a spectrum page

Each spectrum has a page with an interactive plot and all its metadata.

- The plot:
  - Drag across the plot to zoom in. Double-click to zoom out again.
  - **Edge onsets (exSpy)** marks the onset energy of each listed edge, from the exSpy edge table.
  - **Minor edges** adds the weaker edges of the same elements.
- The metadata, in sections:
  - **Specimen**: formula, elements, edges, source and purity, keywords.
  - **Acquisition**: microscope, detector, beam energy, angles and the other settings. Each value shows where it came from (see [Beam energy and angles](/docs/share/beam-energy-and-angles/)).
  - **Treatment**: corrections and deconvolutions applied to the data.
  - **Reference**: the paper the spectrum comes from, if there is one.
  - **Associated spectra**: related spectra, for example the low-loss spectrum of the same specimen.

The **Beam energy and angles known** label beside the title tells you that the beam energy and both semi-angles are recorded.
You need these values to compare fine structure between spectra or to do quantification.

## Keep a list of favourites

Sign in, then click the star on a spectrum page.
Your [account page](/account/) lists your favourite spectra.

## Find a contributor's spectra

Click the contributor's name on a spectrum page.
Their author page lists every spectrum they contributed, and their public profile if they have one.
