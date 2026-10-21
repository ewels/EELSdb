---
title: File formats
description: The spectrum files that EELSdb accepts, what it reads from each one, and how to prepare a two-column text file.
---

EELSdb accepts files of up to 50 MB in these formats, and reads these values from them:

- DigitalMicrograph (`.dm3`, `.dm4`): The spectrum, the energy axis, and the beam energy, angles, exposure and number of frames when the file records them.
- EMSA/MSA (`.msa`, `.emsa`): The spectrum, the energy axis, and the `#BEAMKV`, `#CONVANGLE` and `#COLLANGLE` header fields.
- Velox EMD (`.emd`): The spectrum and the acquisition values in the file.
- HyperSpy (`.hspy`): The spectrum and the acquisition values in the signal's metadata.
- XAS Data Interchange (`.xdi`): The energy column, the absorption column, and the facility, beamline, monochromator and sample fields.
- Two-column text (`.txt`, `.csv`): Energy in the first column, intensity in the second.

EELSdb stores the file that you upload without a change.
At review, the moderator adds an MSA file and a HyperSpy file made from it.

## Spectrum images

If the file holds a spectrum image or a stack of spectra, EELSdb adds them into one spectrum.
To share one spectrum from a spectrum image, extract it before you upload.

## DigitalMicrograph files often lack the beam energy

On many microscopes, DigitalMicrograph is not connected to the microscope.
The `.dm3` or `.dm4` file then has no beam energy and no angles, or it has old values that someone typed by hand.
The form fills in the values it finds in the file. Check them before you submit.

To get the missing values, add a companion file from the same session (see the next section), or choose an [instrument profile](/docs/share/instrument-profiles/).

## Companion files

A companion file is a second file from the same session, for example a survey image.
EELSdb reads the beam energy and often the convergence angle from it.
It accepts `.emd`, `.ser`, `.emi`, `.dm3` and `.dm4` companion files.

## Two-column text files

A text file needs one row for each data point: the energy in eV, then the intensity.
Separate the two columns with spaces, a tab, a comma or a semicolon.
EELSdb ignores lines that do not start with a number, so a header line is fine:

```txt title="spectrum.txt"
Energy (eV)  Counts
280.0  1523
280.1  1519
280.2  1531
```

The energy values must increase from row to row.
To check that a file reads correctly, load it the way EELSdb does. Click **Run code** to run this example in the page:

```py runnable
from io import StringIO

import numpy as np

text = """Energy (eV)  Counts
280.0  1523
280.1  1519
280.2  1531
"""

rows = [line for line in text.splitlines() if line[:1].isdigit() or line[:1] in "+-."]
energy, counts = np.loadtxt(StringIO("\n".join(rows)), delimiter=None, unpack=True)
print(f"{energy.size} points from {energy[0]} to {energy[-1]} eV")
print("Energy increases:", bool(np.all(np.diff(energy) > 0)))
```

Replace the text with the first lines of your own file. For a comma or semicolon separator, add `delimiter=","` or `delimiter=";"`.

For a full check of a file, with the same tests as the submit form, use [`eelsdb check`](/docs/share/command-line/#check-a-file).
