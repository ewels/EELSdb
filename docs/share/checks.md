---
title: File checks
description: The checks that EELSdb runs on every spectrum file, what each finding means, and what to do about it.
---

EELSdb runs the same checks on a spectrum file in two places:

- in your browser, on the submit form, while you fill it in;
- at review, when the moderator's browser reads the file again.

The checks run in the browser, and they do not change the file.

## Severities

Each finding has a severity:

- **Error**: the file cannot be used as it is. Fix the file before you submit.
- **Warning**: something is probably wrong. Check it, and explain it in the comments if it is correct.
- **Info**: something to know, often expected. For example, negative counts after background subtraction.

The submit form shows the findings but does not stop you from submitting. The moderator sees the same findings.

## What EELSdb checks

### Errors

- `unreadable`: The file could not be read. Check the format (see [File formats](/docs/share/file-formats/)). Export the spectrum again as MSA or two-column text.
- `empty`: The file has no data points. Export the spectrum again.
- `length_mismatch`: The file has a different number of energies and intensities. Export the spectrum again.
- `energy_not_finite`: The energy axis has NaN or infinite values. Fix or remove those rows.
- `energy_not_increasing`: The energy axis goes backwards or repeats. Sort the rows by energy and remove repeated rows.
- `intensity_not_finite`: Some intensities are NaN or infinite. Fix or remove those rows.
- `intensity_constant`: Every intensity has the same value. Check that you exported the right signal.

### Warnings

- `too_short`: The spectrum has fewer than 20 points. Check that the export is complete.
- `header_step_mismatch`: In an MSA file, the `XPERCHAN` header does not match the energy step of the data. Correct the header, or export the file again.
- `header_offset_mismatch`: In an MSA file, the `OFFSET` header does not match the first energy. Correct the header, or export the file again.
- `zero_loss_offset`: In a low-loss spectrum, the zero-loss peak is more than 1 eV from 0 eV. Calibrate the energy axis, or say in the comments that it is not calibrated.
- `element_not_in_formula`: An element in **Elements** is not in the formula. Correct the formula or the elements.
- `edge_out_of_range`: A listed edge is outside the energy range of the spectrum. Correct the edges.

### Information

- `non_uniform`: The energy steps are not all equal. This is expected if your data has a non-uniform axis.
- `negative_counts`: Some intensities are negative. This is expected after background subtraction.
- `no_zero_loss`: The low-loss spectrum does not include 0 eV, so EELSdb cannot check the zero-loss peak.
- `formula_element_not_listed`: An element in the formula is not in **Elements**. Add it, unless the spectrum does not show it.
- `edge_in_range_not_listed`: A major edge of one of the elements is in the energy range, but is not in **Edges**. Add the edge if the spectrum shows it.
- `thickness_estimate`: The estimated thickness of a low-loss spectrum, in t/λ. Type it under **Treatment** if you have no better value.
- `thickness_differs`: The estimated thickness differs from the stated thickness by more than 0.1 t/λ. Check the stated value.

## Edge onsets and thickness

The edge checks use the edge table from [exSpy](https://hyperspy.org/exspy/): the onset energies of 504 subshells of 95 elements, each marked major or minor.
EELSdb counts an edge as in range if its onset is within 5 eV of the energy range.

The thickness estimate uses the log-ratio method: t/λ = ln(total intensity / zero-loss intensity).
It is a rough estimate. Use a measured value when you have one.
