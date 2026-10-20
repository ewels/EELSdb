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


def _get(md, path):
    for key in path.split("."):
        if not isinstance(md, dict) or key not in md:
            return None
        md = md[key]
    return md


READERS = {".dm3": "digitalmicrograph", ".dm4": "digitalmicrograph", ".emd": "emd", ".hspy": "hspy", ".ser": "tia", ".emi": "tia"}


def read_any(path):
    """Any supported file as a Spectrum; `header` holds acquisition values found in it (kV, mrad, s).

    Spectrum images are summed to one spectrum. Files without an energy-loss axis (for example a
    companion image) return energy=None with their acquisition values.
    """
    import importlib

    path = Path(path)
    ext = path.suffix.lower()
    if ext in (".msa", ".emsa"):
        sp = read_msa(path)
        # Keywords may carry units, padded: "BEAMKV   -kV".
        base = {k.split("-")[0].strip(): v for k, v in sp.header.items()}
        sp.header = {**sp.header, "beam_energy_kv": base.get("BEAMKV"), "convergence_mrad": base.get("CONVANGLE"),
                     "collection_mrad": base.get("COLLANGLE")}
        return sp
    if ext in (".txt", ".csv"):
        return read_txt(path)
    if ext not in READERS:
        raise ValueError(f"cannot read {ext} files")
    reader = importlib.import_module(f"rsciio.{READERS[ext]}")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        signals = reader.file_reader(str(path))
    is_eels = lambda s: s["axes"] and s["axes"][-1].get("units") in ("eV", "keV")  # noqa: E731
    sig = next((s for s in signals if is_eels(s)), signals[0])
    tem = _get(sig.get("metadata", {}), "Acquisition_instrument.TEM") or {}
    header = {
        "beam_energy_kv": tem.get("beam_energy"),
        "convergence_mrad": tem.get("convergence_angle"),
        "collection_mrad": _get(tem, "Detector.EELS.collection_angle"),
        "exposure_s": _get(tem, "Detector.EELS.exposure"),
        "frames": _get(tem, "Detector.EELS.frame_number"),
    }
    if not is_eels(sig):
        return Spectrum(None, None, ext.lstrip("."), header)
    data = np.asarray(sig["data"], dtype=float)
    while data.ndim > 1:
        data = data.sum(axis=0)
    ax = sig["axes"][-1]
    factor = 1000.0 if ax.get("units") == "keV" else 1.0
    energy = (ax.get("offset", 0) + ax.get("scale", 1) * np.arange(data.size)) * factor
    return Spectrum(energy, data, ext.lstrip("."), header, header_axis=energy)
