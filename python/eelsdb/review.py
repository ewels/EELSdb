"""Reprocessing at review: the MSA, HyperSpy and metadata files that EELSdb publishes for a spectrum.

Runs in the moderator's browser (Pyodide) on the moderation page, so it needs only RosettaSciIO, h5py and numpy.
"""

import json
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import numpy as np

from eelsdb import checks
from eelsdb.io import read_any

TOOLS = ["rosettasciio", "numpy", "h5py"]
PLOT_POINTS = 2000


def tool_versions():
    tools = [{"tool": t, "version": version(t)} for t in TOOLS]
    try:
        import pyodide

        tools.append({"tool": "pyodide", "version": pyodide.__version__})
    except ImportError:
        pass
    return tools


def write_msa(path, energy, intensity, title, acq):
    """EMSA/MAS file with the EELS header fields, as XY so non-uniform axes stay exact."""
    energy, intensity = np.asarray(energy, float), np.asarray(intensity, float)
    step = (energy[-1] - energy[0]) / (energy.size - 1) if energy.size > 1 else 1.0
    now = datetime.now(timezone.utc)
    lines = [
        "#FORMAT      : EMSA/MAS Spectral Data File",
        "#VERSION     : 1.0",
        f"#TITLE       : {title[:64]}",
        f"#DATE        : {now.strftime('%d-%b-%Y').upper()}",
        f"#TIME        : {now.strftime('%H:%M')}",
        "#OWNER       : EELS Data Base",
        f"#NPOINTS     : {energy.size}",
        "#NCOLUMNS    : 1",
        "#XUNITS      : eV",
        "#YUNITS      : counts",
        "#DATATYPE    : XY",
        f"#XPERCHAN    : {step:.8g}",
        f"#OFFSET      : {energy[0]:.8g}",
        "#SIGNALTYPE  : ELS",
    ]
    for key, field in (("BEAMKV   -kV", "beam_energy_kv"), ("CONVANGLE-mR", "convergence_mrad"), ("COLLANGLE-mR", "collection_mrad")):
        if acq.get(field) is not None:
            lines.append(f"#{key}: {acq[field]:g}")
    lines.append("#SPECTRUM    : Spectral Data Starts Here")
    lines += [f"{x:.8g}, {y:.8g}" for x, y in zip(energy, intensity)]
    lines.append("#ENDOFDATA   :")
    Path(path).write_text("\n".join(lines) + "\n", encoding="latin-1", errors="replace")
    return Path(path)


def json_safe(value, max_items=64):
    """File metadata as JSON: arrays longer than max_items (image thumbnails, lookup tables) are summarised."""
    if isinstance(value, dict):
        return {str(k): json_safe(v, max_items) for k, v in value.items()}
    if isinstance(value, np.ndarray):
        if value.size > max_items:
            return f"<array {'x'.join(map(str, value.shape))} {value.dtype}>"
        value = value.tolist()
    if isinstance(value, (list, tuple)):
        if len(value) > max_items:
            return f"<list of {len(value)}>"
        return [json_safe(v, max_items) for v in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def write_metadata(path, sp):
    Path(path).write_text(json.dumps(json_safe(sp.original_metadata), indent=1, ensure_ascii=False), encoding="utf-8")
    return Path(path)


def write_hspy(path, energy, intensity, title, acq, reference):
    """HyperSpy file with EELS metadata, written by RosettaSciIO alone (non-uniform energy axes are kept as such)."""
    from rsciio.hspy import file_writer

    energy = np.asarray(energy, float)
    steps = np.diff(energy)
    uniform = steps.size == 0 or np.allclose(steps, steps[0], rtol=1e-6)
    axis = {"units": "eV", "name": "Energy loss", "navigate": False}
    axis |= {"size": energy.size, "offset": float(energy[0]), "scale": float(steps[0]) if steps.size else 1.0} if uniform else {"axis": energy}
    tem = {"beam_energy": acq.get("beam_energy_kv"), "convergence_angle": acq.get("convergence_mrad")}
    tem = {k: float(v) for k, v in tem.items() if v is not None}
    if acq.get("collection_mrad") is not None:
        tem["Detector"] = {"EELS": {"collection_angle": float(acq["collection_mrad"])}}
    general = {"title": title} | ({"doi": reference["doi"]} if reference and reference.get("doi") else {})
    metadata = {"General": general, "Signal": {"signal_type": "EELS"}}
    if tem:
        metadata["Acquisition_instrument"] = {"TEM": tem}
    # The keys HyperSpy's own save passes; RosettaSciIO's writer reads every one of them.
    file_writer(str(path), {
        "data": np.asarray(intensity, float), "axes": [axis], "metadata": metadata, "original_metadata": {},
        "tmp_parameters": {}, "attributes": {"_lazy": False}, "learning_results": {}, "models": {},
        "package_info": {"package": "rosettasciio", "package_version": version("rosettasciio")},
    })
    return Path(path)


def compare(submitted, from_file):
    """The acquisition values the submitter gave beside those in the file, flagging those that differ."""
    rows = []
    for field, label in (("beam_energy_kv", "Beam energy (kV)"), ("convergence_mrad", "Convergence (mrad)"), ("collection_mrad", "Collection (mrad)")):
        a, b = submitted.get(field), from_file.get(field)
        differs = a is not None and b is not None and abs(float(a) - float(b)) > 1e-6 * max(1.0, abs(float(a)))
        rows.append({"label": label, "submitted": a, "file": b, "differs": differs})
    return rows


def process(detail, original, workdir, edge_table):
    """Reprocess one submission: the checks, the files to publish and the processing record."""
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    s, acq = detail["spectrum"], detail.get("acquisition") or {}
    proposed = detail.get("proposed")
    if proposed:
        # An edit: check the file against what the spectrum would become.
        s = {**s, **{k: proposed["spectrum"][k] for k in ("title", "type", "formula")}}
        acq = proposed["acquisition"]
        detail = {**detail, "elements": proposed["elements"], "edges": [f"{e['element']}_{e['edge']}" for e in proposed["edges"]]}
    sp = read_any(original)
    elements = detail.get("elements") or checks.formula_elements(s.get("formula"))
    outputs, values, plot = {}, {}, None
    if sp.energy is None:
        findings = [checks.Finding("no_spectrum", "error", "No energy-loss spectrum found in the file.")]
    else:
        findings = checks.run_all(sp.energy, sp.intensity, spectrum_type=s["type"], formula=s.get("formula"),
                                  elements=elements, edges=detail.get("edges") or [], edge_table=edge_table,
                                  header_axis=sp.header_axis, navigation_shape=sp.navigation_shape)
        slug = s["slug"]
        outputs["msa"] = write_msa(workdir / f"{slug}.msa", sp.energy, sp.intensity, s["title"], acq)
        outputs["hspy"] = write_hspy(workdir / f"{slug}.hspy", sp.energy, sp.intensity, s["title"], acq, detail.get("reference"))
        if sp.original_metadata:
            outputs["metadata"] = write_metadata(workdir / f"{slug}.metadata.json", sp)
        values = {"min_energy_ev": float(np.min(sp.energy)), "max_energy_ev": float(np.max(sp.energy)),
                  "step_ev": float((sp.energy[-1] - sp.energy[0]) / (sp.energy.size - 1)) if sp.energy.size > 1 else None}
        step = max(1, sp.energy.size // PLOT_POINTS)
        plot = [sp.energy[::step].tolist(), np.nan_to_num(sp.intensity[::step]).tolist()]
    return {
        "outputs": outputs,
        "findings": findings,
        "compare": compare(acq, sp.header),
        "plot": plot,
        "points": None if sp.energy is None else int(sp.energy.size),
        "navigation_shape": list(sp.navigation_shape) if sp.navigation_shape else None,
        "record": {"tools": tool_versions(), "warnings": [f.as_dict() for f in findings], "values": values},
    }
