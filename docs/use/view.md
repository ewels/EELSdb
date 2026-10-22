---
title: View a spectrum
description: Read a spectrum page on EELSdb, use its plot, compare your own spectra with it and export an image of the plot.
---

Each spectrum has its own page, at an address such as [`/spectra/graphite/`](/spectra/graphite/).
The page shows the plot of the spectrum, the contributor's comments and all its metadata.

At the top of the page are the title, the type of spectrum, the formula, the contributor and the date it was added.
The **Beam energy and angles known** label tells you that the beam energy and both semi-angles are recorded.
You need these values to compare fine structure between spectra or to do quantification.

The contributor's comments are in the box below the title.

## Use the plot

- Drag across the plot to zoom in. Double-click the plot to zoom out again.
- **Edge onsets (exSpy)** marks the onset energy of each listed edge, from the exSpy edge table.
- **Minor edges** adds the weaker edges of the same elements.
- **Show** switches between the main spectrum and its processed versions, for example oscillator strength, if the contributor added them.

## Compare with your own spectra

Click **Compare with your spectra** and choose one or more files, or drag the files onto the plot or onto the button.
EELSdb reads MSA, text, DigitalMicrograph, Velox EMD, HyperSpy and XDI files.
Your browser reads the files. EELSdb does not upload them.

Each of your spectra has its own colour, and the list below the button shows them. Click **Remove** to take one away.

With **Scale to match**, each of your spectra has its own y axis on the right, in its colour:

- Drag the top half of that axis up or down to move its maximum.
- Drag the bottom half to move its minimum.
- Double-click the axis to reset it.

When you zoom, your spectra keep their position relative to the reference.
Clear **Scale to match** to plot your values on the same axis as the reference.

## Export an image of the plot

Click **Export**, then choose PNG or SVG, and a light or dark background.
The image shows the plot as it is on the page: the energy range you zoomed to, the edge markers, and any spectra you compare with it.
It has the title of the spectrum and its address at the top.

## Read the metadata

Below the plot, the metadata is in sections:

- **Specimen**: formula, elements, edges, source and purity, keywords.
- **Acquisition**: microscope, detector, beam energy, angles and the other settings. Each value shows where it came from (see [Beam energy and angles](/docs/share/beam-energy-and-angles/)).
- **Treatment**: corrections and deconvolutions applied to the data.
- **Reference**: the paper the spectrum comes from, if there is one.
- **Associated spectra**: related spectra, for example the low-loss spectrum of the same specimen.
- **Metadata from the file**: every tag in the uploaded file, for spectra reviewed on the new site. A person has not checked these values.

**Use in HyperSpy** shows the Python code that downloads the spectrum as an MSA file and loads it in HyperSpy (see [Load spectra in Python](/docs/use/python/)).

To download the data or cite the spectrum, see [Download and cite spectra](/docs/use/download/).
