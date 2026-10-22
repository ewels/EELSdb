# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy>=2.5.4", "rosettasciio>=0.15.0"]
# ///
"""Read every downloaded spectrum file and record its true energy axis in data/fixtures/file-analysis.json.

Flags:
- datatype_y_range_mismatch: MSA `DATATYPE: Y` file whose live-API energy range is wrong (the old PHP
  parser read the first column of each line as an energy).
- bad_xperchan: MSA `DATATYPE: XY` file whose XPERCHAN is more than 10% off the mean step of its X column.
  RosettaSciIO builds the axis from OFFSET and XPERCHAN, so it gets the wrong energies.
- bad_offset: MSA `DATATYPE: XY` file whose OFFSET is more than one step away from its first X value.
- non_uniform: the energy axis has uneven steps.
- not_increasing: the energy axis goes backwards or repeats somewhere.
"""

import json

import numpy as np

from download_files import CACHE, MANIFEST
from eelsdb.io import read_msa, read_txt
from record_api import OUT as API_FIXTURES, ROOT

OUTPUT = ROOT / "data" / "fixtures" / "file-analysis.json"


def v1_energy(s, key):
    v = s.get(key)
    return float(v.removesuffix(" eV")) if v else 0.0


def analyse_msa(path):
    sp = read_msa(path)
    n = len(sp.intensity)
    xperchan, offset = sp.header.get("XPERCHAN"), sp.header.get("OFFSET")
    datatype = str(sp.header.get("DATATYPE", "")).strip()
    result = {
        "format": "msa",
        "datatype": datatype,
        "header": {"npoints": sp.header.get("NPOINTS"), "xperchan": xperchan, "offset": offset},
        "has_beamkv": any(k.startswith("BEAMKV") for k in sp.header),
    }
    flags = []
    if datatype == "XY" and len(sp.energy) == n and n > 1:
        step = (sp.energy.max() - sp.energy.min()) / (n - 1)
        if abs(sp.header_axis[1] - sp.header_axis[0] - step) > 0.1 * step:
            flags.append("bad_xperchan")
        if abs(sp.header_axis[0] - sp.energy[0]) > step:
            flags.append("bad_offset")
    return sp.energy, sp.intensity, result, flags


def txt_layout(path):
    sp = read_txt(path)
    return sp.layout, sp.energy, sp.intensity


def analyse(s, entry):
    path = CACHE / entry["path"]
    flags = []
    if path.suffix.lower() == ".msa":
        energy, data, result, flags = analyse_msa(path)
    else:
        layout, energy, data = txt_layout(path)
        result = {"format": "txt", "layout": layout}
    diffs = np.diff(energy)
    step = float(np.mean(diffs)) if len(diffs) else None
    if len(diffs) and not np.allclose(diffs, diffs[0], rtol=1e-2, atol=1e-6):
        flags.append("non_uniform")
    if not np.all(diffs > 0):
        flags.append("not_increasing")
    e_min, e_max = float(np.min(energy)), float(np.max(energy))
    v1_min, v1_max = v1_energy(s, "min_energy"), v1_energy(s, "max_energy")
    if result.get("datatype") == "Y" and (abs(v1_min - e_min) > abs(step) or abs(v1_max - e_max) > abs(step)):
        flags.append("datatype_y_range_mismatch")
    return {
        "spectrum_id": s["id"],
        "path": entry["path"],
        **result,
        "n_points": int(len(energy)),
        "energy_min": round(e_min, 4),
        "energy_max": round(e_max, 4),
        "step_mean": round(step, 6) if step is not None else None,
        "v1_min_energy": v1_min,
        "v1_max_energy": v1_max,
        "intensity_finite": bool(np.all(np.isfinite(data))),
        "flags": flags,
    }


def main():
    spectra = {s["id"]: s for s in json.loads((API_FIXTURES / "spectra" / "all.json").read_text())["body"]}
    manifest = json.loads(MANIFEST.read_text())
    results = [analyse(spectra[e["spectrum_id"]], e) for e in manifest]
    OUTPUT.write_text(json.dumps(results, indent=1) + "\n")
    counts = {}
    for r in results:
        for f in r["flags"]:
            counts[f] = counts.get(f, 0) + 1
    print(f"{len(results)} files; flags: {counts}")


if __name__ == "__main__":
    main()
