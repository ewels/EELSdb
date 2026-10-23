---
title: "0003. Browser Python stack"
description: "The browser loads RosettaSciIO and h5py only, and plain JavaScript does the interactive processing."
adr:
  date: 2026-10-20
---

## Context

[ADR 0002](/docs/adr/0002-no-server-side-python/) puts Python in the browser. We must choose how much of the HyperSpy stack to load there. Each extra package adds download size and start-up time. Every contributor, moderator and viewer who triggers the load pays this cost.

## Decision

The browser loads Pyodide core, numpy, micropip, h5py, RosettaSciIO and the `eelsdb` modules. It loads nothing else.

- The browser does not load exSpy. The edge table comes from a pinned copy of exSpy's `eels_binding_energies.json`, which the Worker serves from `worker/public/`. `checks.log_ratio_thickness` reimplements exSpy's log-ratio thickness method in numpy.
- The browser does not load HyperSpy. RosettaSciIO's own `hspy.file_writer` writes the HSPY files, with h5py and a signal dictionary that the code builds by hand ([ADR 0025](/docs/adr/0025-hspy-files/)).
- The browser does not load scipy. Edge detection ([ADR 0016](/docs/adr/0016-edge-suggestions/)) uses only numpy.
- Interactive processing on the spectrum page is plain JavaScript in `worker/public/process.js`. This covers background subtraction, smoothing and normalisation. Tests check it against exSpy ([ADR 0029](/docs/adr/0029-spectrum-page-tools/)).

## Research

### Spike 1, 2026-10-20

This spike used `spikes/pyodide/spike.mjs`, with Pyodide 314.0.7 and Python 3.14, on Node 26 and Apple silicon.

- RosettaSciIO 0.15.0 installs with micropip and reads EELSdb MSA files. `eelsdb.checks` runs unchanged.
- exSpy 0.3.2 installs, but `import exspy` fails with `ModuleNotFoundError: h5py`. The cause is that micropip does not pull in h5py. If you load h5py first with `pyodide.loadPackage("h5py")`, the import works.
- Pyodide core downloads about 12 MB before compression. RosettaSciIO adds about 6 MB, so the total is about 18 MB.
- exSpy adds about 38 MB more, for a total of about 56 MB. This download includes scipy, matplotlib, sympy, pillow, h5py and HyperSpy.
- With a warm cache, the core is ready at 0.8 s and RosettaSciIO at 1.6 s. The file read and checks finish at 3 s. The exSpy import finishes at 7 s.

### Spike 2, 2026-10-23

This spike loaded HyperSpy plus exSpy in Chrome, to judge interactive processing on the spectrum page.

| | cold cache | warm cache |
|---|---|---|
| Download | 46 MB, 109 requests | n/a |
| Pyodide + numpy + h5py | 1.2 s | 0.8 s |
| + scipy, matplotlib, hyperspy, exspy | +2.0 s | +1.2 s |
| `import hyperspy.api, exspy` (CPU time, the cache does not help) | 4.4 s | 4.0 s |
| First result possible | about 7.6 s | about 6.0 s |
| `remove_background` per call (1,749 points) | 12 ms | 9 ms |
| `smooth_savitzky_golay` per call | 1.2 ms | 1.2 ms |

We ran this spike on a fast Mac on a fast network. HyperSpy and exSpy work in Pyodide. numba is optional, and HyperSpy falls back when numba is missing.

## Consequences

- exSpy in the browser would cost 3x the download and about twice the start-up time. The only gain would be an edge table that we already have as JSON.
- The same operations in JS run in well under 1 ms, so sliders can update the plot live.
- Tests must check each reimplementation against the real library:
  - `python/record_process.py` runs exSpy's `remove_background` and `smooth_savitzky_golay`, and writes `data/fixtures/process.json`.
  - `worker/test/process.test.ts` checks that the JS matches to 1e-9.
  - The numpy thickness port matches exSpy within 0.05 t/λ on 71 of 72 files.
- When you update the pinned edge table, note the exSpy source version next to it.

## When to revisit

On-demand loading of HyperSpy becomes reasonable for heavy, explicit operations that are too large to rewrite. Examples are full ELNES model fitting, quantification with cross-sections and deconvolution. For these operations, a few seconds of loading behind a "Run" button is acceptable. Live controls should stay in JS.
