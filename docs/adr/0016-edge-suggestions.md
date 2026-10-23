---
title: "0016. Edge suggestions"
description: "A numpy detector suggests edges on the plot, and the contributor confirms them in a text field."
adr:
  date: 2026-10-21
---

## Context

Contributors list the absorption edges in their spectrum, for example `C K, Fe L2,3`. Mistakes are common, and many contributors do not know the exact labels. HyperSpy and exSpy do not detect edges. They only look them up, with `get_edges_near_energy`, `print_edges_near_energy`, `edges_at_energy()`, and `add_elements` with `plot_edges`. The browser does not load exSpy or scipy ([ADR 0003](/docs/adr/0003-small-browser-python-stack/)).

## Decision

- `checks.detect_edges` suggests onsets on core-loss spectra. It uses numpy only and lives in `python/eelsdb/checks.py`. It works as follows:
  - It puts the data on a uniform grid. If the data looks background-subtracted, it adds an offset. The test for this is a minimum below twice the channel noise.
  - It compares the local log-log slope with a power law. It fits the power law over the 20 eV before each point, with 1 eV Gaussian smoothing. Slope peaks are onsets, and the detector reports each onset at the steepest rise. Running sums make the fit O(n), so it takes at most about 6 ms per file.
  - It computes confidence = (1 − e^(−jump/0.2)) × min(1, slope SNR/3) × min(1, jump/counting noise/5). Here, jump is ln(data / extrapolated background) over the next 10 eV.
  - It returns only onsets with confidence ≥ 0.5, and at most 6. It merges onsets within 10 eV. It drops a rise within 50 eV after a stronger edge (at least twice as strong) as fine structure.
  - It returns nothing for low-loss, zero-loss and X-ray absorption spectra. It also returns nothing for fewer than 50 points or for a non-increasing axis.
- `checks.edges_near` lists candidate labels within ±15 eV. It groups subshells into stored labels (L2 + L3 → L2,3). It ranks the candidates in this order:
  1. exSpy "Major" edges first.
  2. Distance, in 5 eV steps.
  3. K, L2,3 and M4,5 before other shells. With this rule, C K beats Ru M4,5 at 282 eV.
- On the submit form plot, suggestions show as dashed markers. When a contributor chooses a candidate, the form adds it to the edges field at once. Relabelling and confirming are one action. A click on the plot lists nearby candidates. Each marker sits at the table onset of the lowest subshell of its label. The contributor cannot drag markers, because the site stores edges as labels only ([ADR 0007](/docs/adr/0007-data-model/)).
- The edges text field stays the source of truth. The reasons are accessibility, exactness and a fallback when Pyodide fails.
- The site does not suggest edges automatically for legacy spectra ("being too clever").

## Research: tuning on the 188 legacy core-loss files

- The detector finds 172 of 214 listed major edges in range. The misses have almost no pre-edge, or are weak M4,5 or high-energy L edges.
- 190 of 243 suggestions match a listed element. Some "unmatched" suggestions are real edges that the contributor did not list, for example O K in CrC.
- The expected failures are chemical shifts and weak M4,5 edges. Because of chemical shifts, the label menu matters more than the position.
- The weak points are unlikely candidates (Pu N6,7, At N4,5) and false positives (Sn M4,5 on SrTiO3). We offered to rank the formula's elements first, but did not do it.
