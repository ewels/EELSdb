"""Moderator review: reprocess a submitted file with pinned tools and show it next to the submitted values."""

import base64
import contextlib
import html
import io as _io
import json
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import numpy as np

from eelsdb import checks
from eelsdb.io import read_any

TOOLS = ["rosettasciio", "exspy", "hyperspy", "numpy", "eelsdb"]


def tool_versions():
    return [{"tool": t, "version": version(t)} for t in TOOLS]


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
    Path(path).write_text("\n".join(lines) + "\n", encoding="latin-1")
    return Path(path)


def write_hspy(path, energy, intensity, title, acq, reference):
    """HyperSpy file with EELS metadata (non-uniform energy axes are kept as such)."""
    with contextlib.redirect_stdout(sys.stderr):
        import exspy  # noqa: F401  (registers the EELS signal type)
        import hyperspy.api as hs
    steps = np.diff(energy)
    uniform = steps.size == 0 or np.allclose(steps, steps[0], rtol=1e-6)
    axis = (
        {"size": energy.size, "offset": float(energy[0]), "scale": float(steps[0]) if steps.size else 1.0, "units": "eV", "name": "Energy loss"}
        if uniform
        else {"axis": np.asarray(energy, float), "units": "eV", "name": "Energy loss"}
    )
    s = hs.signals.Signal1D(np.asarray(intensity, float), axes=[axis])
    s.set_signal_type("EELS")
    s.metadata.General.title = title
    tem = {"beam_energy": acq.get("beam_energy_kv"), "convergence_angle": acq.get("convergence_mrad")}
    for k, v in tem.items():
        if v is not None:
            s.metadata.set_item(f"Acquisition_instrument.TEM.{k}", v)
    if acq.get("collection_mrad") is not None:
        s.metadata.set_item("Acquisition_instrument.TEM.Detector.EELS.collection_angle", acq["collection_mrad"])
    if reference and reference.get("doi"):
        s.metadata.set_item("General.doi", reference["doi"])
    with contextlib.redirect_stdout(sys.stderr):
        s.save(str(path), overwrite=True)
    return Path(path)


def compare(submitted, from_file):
    """Rows of (field, submitted value, value in the file, differs?)."""
    rows = []
    for field, label in (("beam_energy_kv", "Beam energy (kV)"), ("convergence_mrad", "Convergence (mrad)"), ("collection_mrad", "Collection (mrad)")):
        a, b = submitted.get(field), from_file.get(field)
        differs = a is not None and b is not None and abs(float(a) - float(b)) > 1e-6 * max(1.0, abs(float(a)))
        rows.append((label, a, b, differs))
    return rows


def plot_png(energy, intensity, title):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(9, 3.6), dpi=110)
    ax.plot(energy, intensity, color="#a21e16", lw=1)
    ax.set_xlabel("Energy loss (eV)")
    ax.set_title(title, fontsize=10)
    fig.tight_layout()
    buf = _io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def report_html(detail, sp, findings, rows):
    esc = lambda v: html.escape("" if v is None else str(v))  # noqa: E731
    s = detail["spectrum"]
    finding_items = "".join(f'<li class="{esc(f.severity)}">{esc(f.message)}</li>' for f in findings) or "<li>No problems found.</li>"
    table = "".join(
        f'<tr class="{"differs" if d else ""}"><th>{esc(label)}</th><td>{esc(a)}</td><td>{esc(b)}</td></tr>' for label, a, b, d in rows
    )
    img = f'<img alt="Plot of the spectrum" src="data:image/png;base64,{plot_png(sp.energy, sp.intensity, s["title"])}">' if sp.energy is not None else ""
    return f"""<!doctype html><meta charset="utf-8"><title>Review: {esc(s['title'])}</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1b1a19}}
img{{max-width:100%}}table{{border-collapse:collapse}}td,th{{border-bottom:1px solid #ddd;padding:.3rem .8rem;text-align:left}}
.differs td{{background:#fbe3c4}}.error{{color:#a21e16;font-weight:600}}.warning{{color:#b96716}}.info{{color:#5d5852}}</style>
<h1>{esc(s['title'])}</h1>
<p>{esc(s.get('formula'))} · {esc(s['type'])} · submitted by {esc(detail.get('submitter'))} · {esc(detail['kind'])}</p>
{img}
<h2>Checks (this machine)</h2><ul>{finding_items}</ul>
<h2>Submitted values and values in the file</h2>
<table><tr><th></th><th>Submitted</th><th>In the file</th></tr>{table}</table>
<h2>Browser checks at submission</h2><pre>{esc(json.dumps(detail.get('browser_checks'), indent=1)[:4000])}</pre>"""


def process(detail, original, workdir):
    """Reprocess one submission. Returns the outputs and the processing record to upload."""
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    s, acq = detail["spectrum"], detail.get("acquisition") or {}
    sp = read_any(original)
    with contextlib.redirect_stdout(sys.stderr):
        table = checks.exspy_edge_table()
    elements = detail.get("elements") or checks.formula_elements(s.get("formula"))
    findings = []
    outputs = {}
    values = {}
    if sp.energy is None:
        findings.append(checks.Finding("no_spectrum", "error", "No energy-loss spectrum found in the file."))
    else:
        findings = checks.run_all(sp.energy, sp.intensity, spectrum_type=s["type"], formula=s.get("formula"),
                                  elements=elements, edges=detail.get("edges") or [], edge_table=table,
                                  header_axis=sp.header_axis)
        slug = s["slug"]
        outputs["msa"] = write_msa(workdir / f"{slug}.msa", sp.energy, sp.intensity, s["title"], acq)
        outputs["hspy"] = write_hspy(workdir / f"{slug}.hspy", sp.energy, sp.intensity, s["title"], acq, detail.get("reference"))
        values = {"min_energy_ev": float(np.min(sp.energy)), "max_energy_ev": float(np.max(sp.energy)),
                  "step_ev": float((sp.energy[-1] - sp.energy[0]) / (sp.energy.size - 1)) if sp.energy.size > 1 else None}
    rows = compare(acq, sp.header)
    report = workdir / "review.html"
    report.write_text(report_html(detail, sp, findings, rows))
    record = {"tools": tool_versions(), "warnings": [f.as_dict() for f in findings], "values": values}
    return {"outputs": outputs, "report": report, "findings": findings, "record": record}
