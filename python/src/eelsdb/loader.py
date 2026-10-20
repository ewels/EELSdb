"""eelsdb.load(): one spectrum as a HyperSpy signal, with the metadata from API v2."""

import contextlib
import json
import sys
import tempfile
import urllib.parse
from pathlib import Path

from eelsdb.client import load_config, site_url
from eelsdb.export import fetch
from eelsdb.io import read_any


def to_signal(record, energy, intensity):
    with contextlib.redirect_stdout(sys.stderr):
        import exspy  # noqa: F401  (registers the EELS signal type)
        import hyperspy.api as hs
    import numpy as np

    steps = np.diff(energy)
    uniform = steps.size == 0 or np.allclose(steps, steps[0], rtol=1e-6)
    axis = (
        {"size": len(energy), "offset": float(energy[0]), "scale": float(steps[0]) if steps.size else 1.0, "units": "eV", "name": "Energy loss"}
        if uniform
        else {"axis": np.asarray(energy, float), "units": "eV", "name": "Energy loss"}
    )
    s = hs.signals.Signal1D(np.asarray(intensity, float), axes=[axis])
    s.set_signal_type("EELS" if record["technique"] == "eels" else "")
    md = s.metadata
    md.General.title = record["title"]
    a = record.get("acquisition") or {}
    for path, item, unit in (
        ("Acquisition_instrument.TEM.beam_energy", a.get("beam_energy"), "value_kv"),
        ("Acquisition_instrument.TEM.convergence_angle", a.get("convergence_angle"), "value_mrad"),
        ("Acquisition_instrument.TEM.Detector.EELS.collection_angle", a.get("collection_angle"), "value_mrad"),
    ):
        if item and item.get(unit) is not None:
            md.set_item(path, item[unit])
    if a.get("microscope"):
        md.set_item("Acquisition_instrument.TEM.microscope", a["microscope"])
    if record["elements"] and record["technique"] == "eels":
        with contextlib.redirect_stdout(sys.stderr):
            s.add_elements(record["elements"])
    ref = record.get("reference") or {}
    if ref.get("doi"):
        md.set_item("General.doi", ref["doi"])
    s.original_metadata.add_dictionary({"eelsdb": json.loads(json.dumps(record))})
    return s


def load(spectrum, api=None, fetcher=fetch):
    """A spectrum by id or slug, as a HyperSpy signal; the full API v2 record is in original_metadata.eelsdb."""
    api = (api or load_config()["api"]).rstrip("/")
    record = json.loads(fetcher(f"{api}/v2/spectra/{urllib.parse.quote(str(spectrum))}"))
    url = record["download_url"]
    if url is None:
        raise ValueError(f"Spectrum {spectrum} has no data file.")
    site = site_url(api)
    if "localhost" in site:
        url = site + urllib.parse.urlparse(url).path
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / Path(urllib.parse.urlparse(url).path).name
        path.write_bytes(fetcher(url))
        sp = read_any(path)
    return to_signal(record, sp.energy, sp.intensity)
