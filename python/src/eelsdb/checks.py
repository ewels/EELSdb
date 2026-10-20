"""Checks on a spectrum, shared by the browser (Pyodide) and the moderator CLI.

Pure functions over an energy axis and intensities: no network, no files, no HyperSpy signal.
Each check returns a list of Finding. Severity: "error" (the file cannot be used as it is),
"warning" (probably wrong, a person should look) or "info".
"""

import math
import re
from dataclasses import asdict, dataclass

import numpy as np

MIN_POINTS = 20
# Onsets this far outside the range still count as "in range", for edges that start just before the window.
EDGE_MARGIN_EV = 5.0
THICKNESS_TOLERANCE = 0.1  # t/λ; the estimate is a flag, not a value


@dataclass
class Finding:
    code: str
    severity: str
    message: str

    def as_dict(self):
        return asdict(self)


def _err(code, message):
    return Finding(code, "error", message)


def _warn(code, message):
    return Finding(code, "warning", message)


def _info(code, message):
    return Finding(code, "info", message)


def check_axis(energy, intensity, header_axis=None):
    """Energy axis present, increasing, matching the intensities and (for MSA) the header."""
    energy, intensity = np.asarray(energy, float), np.asarray(intensity, float)
    out = []
    if energy.size == 0 or intensity.size == 0:
        return [_err("empty", "The file has no data points.")]
    if energy.size != intensity.size:
        out.append(_err("length_mismatch", f"{energy.size} energies but {intensity.size} intensities."))
        return out
    if energy.size < MIN_POINTS:
        out.append(_warn("too_short", f"Only {energy.size} data points."))
    if not np.all(np.isfinite(energy)):
        out.append(_err("energy_not_finite", "The energy axis contains NaN or infinite values."))
        return out
    steps = np.diff(energy)
    if np.any(steps <= 0):
        n = int(np.sum(steps <= 0))
        out.append(_err("energy_not_increasing", f"The energy axis goes backwards or repeats at {n} points."))
    elif steps.size and not np.allclose(steps, steps[0], rtol=1e-2, atol=1e-6):
        out.append(_info("non_uniform", "The energy steps are not all equal."))
    if header_axis is not None and len(header_axis) == energy.size and energy.size > 1:
        step = (energy[-1] - energy[0]) / (energy.size - 1)
        header_step = header_axis[1] - header_axis[0]
        if abs(header_step - step) > 0.1 * abs(step):
            out.append(_warn("header_step_mismatch",
                             f"The header step (XPERCHAN = {header_step:g} eV) does not match the data ({step:.4g} eV per point)."))
        if abs(header_axis[0] - energy[0]) > abs(step):
            out.append(_warn("header_offset_mismatch",
                             f"The header start (OFFSET = {header_axis[0]:g} eV) does not match the data ({energy[0]:g} eV)."))
    return out


def check_intensity(intensity, intensity_units="counts"):
    intensity = np.asarray(intensity, float)
    out = []
    bad = int(np.sum(~np.isfinite(intensity)))
    if bad:
        out.append(_err("intensity_not_finite", f"{bad} intensities are NaN or infinite."))
    finite = intensity[np.isfinite(intensity)]
    if finite.size and np.all(finite == finite[0]):
        out.append(_err("intensity_constant", "Every intensity has the same value."))
    if intensity_units == "counts" and finite.size:
        neg = int(np.sum(finite < 0))
        if neg:
            out.append(_info("negative_counts", f"{neg} of {finite.size} points are negative (background subtracted?)."))
    return out


def zero_loss_position(energy, intensity):
    """Energy of the highest point, the zero-loss peak in a low-loss spectrum."""
    return float(np.asarray(energy)[int(np.nanargmax(intensity))])


def check_zero_loss(energy, intensity, spectrum_type, tolerance_ev=1.0):
    energy = np.asarray(energy, float)
    if spectrum_type not in ("lowloss", "zeroloss"):
        return []
    if not (energy.min() <= 0 <= energy.max()):
        return [_info("no_zero_loss", "The energy range does not include 0 eV, so the zero-loss peak is not in the data.")]
    zlp = zero_loss_position(energy, intensity)
    if abs(zlp) > tolerance_ev:
        return [_warn("zero_loss_offset", f"The zero-loss peak is at {zlp:.2f} eV, not 0 eV. Is the energy calibrated?")]
    return []


ELEMENT_RE = re.compile(r"[A-Z][a-z]?")


def formula_elements(formula):
    """Element symbols in a formula, in order, without repeats."""
    from eelsdb._elements import SYMBOLS

    found = [s for s in ELEMENT_RE.findall(formula or "") if s in SYMBOLS]
    return list(dict.fromkeys(found))


def check_formula(formula, elements):
    """The listed elements should all appear in the formula, and the reverse."""
    if not formula or not elements:
        return []
    in_formula = set(formula_elements(formula))
    listed = set(elements)
    out = []
    if listed - in_formula:
        out.append(_warn("element_not_in_formula", f"Listed but not in the formula: {', '.join(sorted(listed - in_formula))}."))
    if in_formula - listed:
        out.append(_info("formula_element_not_listed", f"In the formula but not listed: {', '.join(sorted(in_formula - listed))}."))
    return out


def edge_onsets(elements, edge_table):
    """[(element, subshell, onset_eV, major)] from an exSpy-style table {element: {subshell: {...}}}."""
    out = []
    for el in elements:
        for shell, info in (edge_table.get(el) or {}).items():
            onset = info.get("onset_energy (eV)")
            if onset is not None:
                out.append((el, shell, float(onset), info.get("relevance") == "Major"))
    return out


def _subshells(edge):
    """'L2,3' -> ['L2', 'L3']; 'K' -> ['K']; 'M' -> every M subshell."""
    m = re.fullmatch(r"([KLMNO])(\d)?(?:,(\d))?", edge)
    if not m:
        return []
    shell, a, b = m.groups()
    if a is None:
        return [shell] if shell == "K" else [f"{shell}{i}" for i in range(1, 8)]
    return [f"{shell}{i}" for i in range(int(a), int(b or a) + 1)]


def check_edges(energy, elements, edges, edge_table, spectrum_type=None):
    """Major edges of the elements that fall in the range but are not listed, and listed edges outside the range."""
    if spectrum_type not in (None, "coreloss", "xrayabs") or not elements:
        return []
    lo, hi = float(np.min(energy)) - EDGE_MARGIN_EV, float(np.max(energy)) + EDGE_MARGIN_EV
    onsets = {(el, shell): (e, major) for el, shell, e, major in edge_onsets(elements, edge_table)}
    out = []
    listed = set()
    for edge in edges:
        el, _, name = edge.partition("_") if "_" in edge else edge.partition(" ")
        shells = [(el, s) for s in _subshells(name) if (el, s) in onsets]
        listed.update(shells)
        if shells and not any(lo <= onsets[s][0] <= hi for s in shells):
            where = ", ".join(f"{s[1]} {onsets[s][0]:g} eV" for s in shells)
            out.append(_warn("edge_out_of_range", f"{el} {name} ({where}) is outside the energy range."))
    missing = sorted({(el, s) for (el, s), (e, major) in onsets.items()
                      if major and lo <= e <= hi and (el, s) not in listed})
    if missing:
        names = ", ".join(f"{el} {s} ({onsets[(el, s)][0]:g} eV)" for el, s in missing)
        out.append(_info("edge_in_range_not_listed", f"Major edges in the energy range that are not listed: {names}."))
    return out


def elastic_threshold(energy, intensity, start=1.0, window=10.0):
    """End of the zero-loss peak: where the smoothed slope is flattest between `start` and `start + window` eV.

    Same as exSpy's estimate_elastic_scattering_threshold with its defaults (Savitzky-Golay first
    derivative, 5 points, cubic).
    """
    energy, intensity = np.asarray(energy, float), np.asarray(intensity, float)
    idx = np.where((energy >= start) & (energy < start + window))[0]
    if idx.size < 10:
        return None
    seg = intensity[idx[0]: idx[-1] + 1]
    slope = np.convolve(seg, np.array([-1, 8, 0, -8, 1]) / 12.0, mode="same")[2:-2]
    flattest = int(np.argmin(np.abs(slope))) + 2
    return float(energy[idx[0] + flattest]) if flattest > 2 else None


def log_ratio_thickness(energy, intensity):
    """t/λ by the log-ratio method, ln(total / zero-loss), as exSpy's EELSSpectrum.estimate_thickness."""
    energy, intensity = np.asarray(energy, float), np.asarray(intensity, float)
    threshold = elastic_threshold(energy, intensity)
    if threshold is None:
        return None
    zlp = float(np.nansum(intensity[energy < threshold]))
    total = float(np.nansum(intensity))
    if zlp <= 0 or total <= zlp:
        return None
    return math.log(total / zlp)


def check_thickness(energy, intensity, spectrum_type, stated=None):
    if spectrum_type != "lowloss":
        return []
    energy = np.asarray(energy, float)
    if not (energy.min() <= 0 <= energy.max()):
        return []
    t = log_ratio_thickness(energy, intensity)
    if t is None:
        return []
    if stated is None:
        return [_info("thickness_estimate", f"Estimated thickness {t:.2f} t/λ (log-ratio).")]
    if abs(t - stated) > THICKNESS_TOLERANCE:
        return [_info("thickness_differs", f"Estimated thickness {t:.2f} t/λ (log-ratio); stated {stated:g} t/λ.")]
    return []


def run_all(energy, intensity, *, spectrum_type=None, formula=None, elements=(), edges=(), edge_table=None,
            thickness=None, header_axis=None, intensity_units="counts"):
    """Every check, in a stable order. Later checks are skipped when the axis is unusable."""
    findings = check_axis(energy, intensity, header_axis)
    if any(f.severity == "error" and f.code in ("empty", "length_mismatch", "energy_not_finite") for f in findings):
        return findings
    findings += check_intensity(intensity, intensity_units)
    findings += check_zero_loss(energy, intensity, spectrum_type)
    findings += check_formula(formula, elements)
    if edge_table is not None:
        findings += check_edges(energy, elements, edges, edge_table, spectrum_type)
    findings += check_thickness(energy, intensity, spectrum_type, thickness)
    return findings


def exspy_edge_table():
    """The installed exSpy's edge table, in the same shape as its eels_binding_energies.json."""
    import contextlib
    import sys

    # HyperSpy logs import-time warnings to stdout, which would corrupt JSON output.
    with contextlib.redirect_stdout(sys.stderr):
        from exspy.material import elements

    table = {}
    for symbol, el in elements.as_dictionary().items():
        energies = el.get("Atomic_properties", {}).get("Binding_energies") if isinstance(el, dict) else None
        if energies:
            table[symbol] = energies
    return table
