---
title: Instrument profiles
description: Record the calibrated convergence and collection angles of a microscope, so that contributors can pick them on the submit form.
---

An instrument profile holds the calibrated convergence and collection semi-angles of one microscope, for each setting.
Facility staff keep the profiles.
A contributor who chooses a profile on the submit form gets one-click calibrated angles instead of a guess.

The [instrument profiles page](/instruments/) lists every approved profile.

## Add an instrument

1. Sign in and open the [instrument profiles page](/instruments/).
2. Click **Add an instrument**.
3. Fill in the microscope details:
   - **Microscope**: the name that contributors will see, for example `Titan Themis 60-300 (Nantes)`.
   - **Facility**, **Manufacturer** and **Spectrometer**, for example `Gatan GIF Quantum ER 965`.
   - **Accelerating voltages (kV)**, separated by commas, for example `80, 200, 300`.
4. Under **Calibrated angles**, add one row for each setting:
   - Choose **Convergence** or **Collection**.
   - Fill in the settings that the angle depends on: **kV**, **Mode**, **Aperture** and **Camera length**. Leave the others empty.
   - Type the **Semi-angle (mrad)** and its uncertainty **± (mrad)**.
5. Add notes, for example how and when you measured the calibrations.
6. Click the button to save the profile.

A moderator approves each new profile before contributors can choose it.

## Change a profile

Any signed-in user can suggest a change: open the profile and click **Suggest a change**.
Each change makes a new version, and a moderator approves each version.
The profile page lists all versions.

Each spectrum records the profile version that it used, so a later change does not alter the values of spectra that were already published.
