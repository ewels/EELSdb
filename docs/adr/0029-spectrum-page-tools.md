---
title: "0029. Spectrum page tools"
description: "The compare, export and processing tools on the spectrum page run in the browser."
adr:
  date: 2026-10-21
---

## Context

Viewers want to check a reference against their own data and make figures. They also want to do the first steps of a HyperSpy analysis without leaving the page.

## Decision

### Plot

The page draws the spectrum with uPlot. It shows the exSpy edge onsets for the spectrum's elements as dashed markers. The onsets come from the pinned edge table. The plot shows major edges, and minor edges as an option.

### Compare

- Viewers can add their own files. They choose a file or drop it on the plot. The page reads MSA and text files in JS, and other formats with the shared Pyodide reader (`pyreader.js`). Files never leave the browser.
- Viewers can also add other EELSdb spectra. A type-ahead searches `/search/spectra.json?overlaps={slug}`, which returns spectra with an overlapping energy range. It lists spectra that share an edge first, then spectra that share an element. The page draws each one from its `/download/json`.
- The page draws compared spectra only within the energy range of the reference.
- "Scale to match" gives each compared spectrum its own y scale. Each scale has a right-hand axis in the spectrum's colour (`--compare-1` to `--compare-4`).
- Each compared scale keeps a linear map to the main scale (value = main × k + b). Zooming therefore keeps the overlays in place.
- A drag on the top half of an axis moves its maximum. A drag on the bottom half moves its minimum. A double-click resets the axis.
- The main scale comes first in `scales`, so uPlot knows its range first.
- Each compared spectrum has an energy shift input.

### Export

Viewers can export the current view as PNG or SVG, in light or dark. The page draws a second uPlot off-screen at 1200 × 560 in the chosen theme. uPlot draws only to canvas. The page therefore builds the SVG from the scales and ticks of that uPlot (`_splits`, `_values`, `_size`). These are internal fields of uPlot 1.6. Each export states the processing that the viewer applied.

### View processing

The page does view processing in plain JS (`worker/public/process.js`), not with HyperSpy in Pyodide. [ADR 0003](/docs/adr/0003-small-browser-python-stack/) has the timings.

- Power-law background: the viewer types a window, and the plot shades it. The page can show the fit or subtract it. This tool is for core-loss spectra only.
- The two-area estimate matches exSpy's `remove_background(signal_range=…)`. Like exSpy, it treats EELS counts as binned: A comes from plain sums, and the model is multiplied by the channel width.
- Savitzky–Golay smoothing uses order 2 and a window slider. It matches scipy's `savgol_filter` with mode "interp", which exSpy uses.
- The viewer can normalise to the maximum or to the area.
- A log scale labels only 1, 2 and 5 of each decade. On a log axis, compared spectra share one scale with the main spectrum.
- The steps run in this order: background, smoothing, normalisation. Compared spectra get the same steps.
- Processing never changes downloads.
- The "Use in HyperSpy" snippet gets the equivalent lines, so the code reproduces the view. The lines are `s = s.remove_background(signal_range=(a, b))`, `s.smooth_savitzky_golay(...)` and `s = s / s.data.max()`.

## Consequences

- `worker/test/process.test.ts` checks the JS against exSpy output that `python/record_process.py` records. The tolerance is 1e-9 relative.
- For X-ray absorption spectra, HyperSpy integrates differently because the data is not binned. The snippet line for area normalisation would therefore give a slightly different result.
- uPlot sets scales on its first commit. A read of the scales in the same tick as a rebuild returns `null`. Check for `null` before you reuse them.
- These tools are not built:
  - Edge-jump normalisation. It needs a second window.
  - Derivatives.
  - Deconvolution. It needs a matching low-loss spectrum, and most entries do not have one.
