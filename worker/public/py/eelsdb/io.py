"""Read a spectrum file into a plain energy axis and intensities (no HyperSpy signal needed)."""

import re
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

TXT_SEPARATORS = {" , ": "space-comma-space", ",": "comma", "\t": "tab", " ": "space"}


@dataclass
class Spectrum:
    energy: np.ndarray
    intensity: np.ndarray
    format: str
    header: dict = field(default_factory=dict)
    layout: str | None = None
    header_axis: np.ndarray | None = None  # OFFSET + i * XPERCHAN, for MSA files


def msa_x_column(path):
    """X values of an XY MSA file, read directly (RosettaSciIO ignores them)."""
    xs, in_data = [], False
    for line in Path(path).read_text(encoding="latin-1").splitlines():
        if line.startswith("#SPECTRUM"):
            in_data = True
        elif line.startswith("#ENDOFDATA"):
            break
        elif in_data and line.strip() and not line.startswith("#"):
            xs.append(float(line.replace(",", " ").split()[0]))
    return np.array(xs)


def read_msa(path):
    from rsciio.msa import file_reader

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sig = file_reader(str(path))[0]
    header = dict(sig["original_metadata"])
    ax = sig["axes"][0]
    header_axis = ax["offset"] + ax["scale"] * np.arange(ax["size"])
    datatype = str(header.get("DATATYPE", "")).strip()
    energy = msa_x_column(path) if datatype == "XY" else header_axis
    return Spectrum(energy, np.asarray(sig["data"], dtype=float), "msa", header, header_axis=header_axis)


def read_txt(path):
    """Two-column text. The layout names the column separator."""
    lines = Path(path).read_text(encoding="latin-1").splitlines()
    data_lines = [line for line in lines if re.match(r"\s*[-+]?\d", line)]
    sep = re.match(r"\s*\S+?(\s*[,;]\s*|\s+)[-+\d.]", data_lines[0]).group(1)
    layout = TXT_SEPARATORS.get(sep, "tab+spaces" if sep.startswith("\t") else repr(sep))
    rows = np.array([[float(v) for v in re.split(r"[\s,;]+", line.strip())[:2]] for line in data_lines])
    return Spectrum(rows[:, 0], rows[:, 1], "txt", layout=layout)


def read_spectrum(path):
    path = Path(path)
    return read_msa(path) if path.suffix.lower() == ".msa" else read_txt(path)
