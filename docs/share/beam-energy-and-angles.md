---
title: Beam energy and angles
description: Where EELSdb gets the beam energy, convergence angle and collection angle of a spectrum, and what to enter when you do not know them.
---

The beam energy, the convergence semi-angle and the collection semi-angle change the shape of an EELS spectrum.
Readers need them to compare fine structure or to quantify a spectrum.
For each of the three values, EELSdb records the value, where it came from, and an optional uncertainty.
For X-ray absorption spectra, the three values do not apply and the form does not ask for them.

## Where the values come from

The submit form fills in values from these sources, in this order:

1. **The spectrum file.** DigitalMicrograph, MSA, EMD and HyperSpy files can hold the beam energy and both angles. On many microscopes these values are missing or out of date, so the form asks you to check them.
2. **A companion file** from the same session, such as a Velox `.emd` or TIA `.ser` file. These files are written by the microscope software, so they usually have the correct beam energy and often the convergence angle.
3. **An [instrument profile](/docs/share/instrument-profiles/).** Facility staff record calibrated angles for each microscope setting. Click a calibrated angle under the profile to use it.
4. **You.** Type the value.

Each value on the spectrum page and in the API carries its source: `file`, `companion`, `profile`, `user`, `estimate` or `unknown`.

## When you are not sure

"Approximate" and "unknown" are valid answers. A spectrum with an honest "unknown" is more useful than one with a guessed value.

- If you know a value roughly, type it, check **Approximate** and give the uncertainty (±). EELSdb records the source as `estimate`.
- If you do not know a value, check **Unknown**.

The **Beam energy and angles known** label on a spectrum page, and the `complete=true` filter in the API, mean that the beam energy and both angles have a value from any source except `unknown`.

## Find the angles for your microscope

- The **convergence semi-angle** depends on the beam energy, the mode (TEM or STEM) and the condenser or probe aperture. Your facility's calibration tables list it.
- The **collection semi-angle** depends on the camera length and the spectrometer entrance aperture. The spectrometer manual or your facility's calibration tables list it.

Ask your facility staff to [add an instrument profile](/docs/share/instrument-profiles/), so that the next person does not need to look again.
