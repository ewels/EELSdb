"""Record exSpy's background removal and smoothing on a synthetic core-loss spectrum into data/fixtures/process.json.

worker/public/process.js reimplements these for the spectrum page; worker/test/process.test.ts checks it against this file.

    uv run python record_process.py
"""

import json
from pathlib import Path

import exspy
import numpy as np

OUT = Path(__file__).resolve().parent.parent / "data" / "fixtures" / "process.json"

x = np.arange(400.0, 700.0, 1.5)
rng = np.random.default_rng(1)
y = 3e9 * x**-3.2 + 40 * (x > 532) * (x / 532) ** -2 + rng.normal(0, 2, x.size)

s = exspy.signals.EELSSpectrum(y)
s.axes_manager[0].offset = x[0]
s.axes_manager[0].scale = x[1] - x[0]

window = (412.0, 520.0)
smooth = dict(window_length=11, polynomial_order=2)
sg = s.deepcopy()
sg.smooth_savitzky_golay(**smooth)

r = lambda a: [float(f"{v:.10g}") for v in a]
OUT.write_text(
    json.dumps(
        {
            "x": r(x),
            "y": r(y),
            "background_window": window,
            "remove_background": r(s.remove_background(signal_range=window).data),
            "smooth": smooth,
            "smooth_savitzky_golay": r(sg.data),
        }
    )
    + "\n"
)
print(f"wrote {OUT}")
