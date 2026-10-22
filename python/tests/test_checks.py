import json
import logging
import warnings
from pathlib import Path

import numpy as np
import pytest

from eelsdb import checks
from eelsdb.io import read_spectrum
from analyse_files import OUTPUT as ANALYSIS
from download_files import CACHE

codes = lambda findings: {f.code for f in findings}  # noqa: E731
E = np.linspace(0, 100, 200)

TABLE = {
    "C": {"K": {"onset_energy (eV)": 284.0, "relevance": "Major"}},
    "O": {"K": {"onset_energy (eV)": 532.0, "relevance": "Major"}},
    "Fe": {
        "L3": {"onset_energy (eV)": 708.0, "relevance": "Major"},
        "L2": {"onset_energy (eV)": 721.0, "relevance": "Major"},
        "M2,3": {"onset_energy (eV)": 54.0, "relevance": "Major"},
    },
}


def test_axis_problems():
    assert codes(checks.check_axis([], [])) == {"empty"}
    assert "length_mismatch" in codes(checks.check_axis(E, E[:-1]))
    assert "too_short" in codes(checks.check_axis(E[:5], E[:5]))
    assert "energy_not_increasing" in codes(checks.check_axis(E[::-1], E))
    assert checks.check_axis(E, np.ones_like(E)) == []


def test_header_mismatch():
    found = codes(checks.check_axis(E, E, header_axis=10 + 0.2 * np.arange(E.size)))
    assert found == {"header_step_mismatch", "header_offset_mismatch"}


def test_intensity_problems():
    y = np.ones_like(E)
    assert "intensity_constant" in codes(checks.check_intensity(y))
    y = np.linspace(-1, 1, E.size)
    y[3] = np.nan
    assert {"intensity_not_finite", "negative_counts"} <= codes(checks.check_intensity(y))


def test_zero_loss_position():
    e = np.linspace(-10, 50, 601)
    peak = lambda at: np.exp(-((e - at) ** 2)) + 0.01  # noqa: E731
    assert checks.check_zero_loss(e, peak(0.0), "lowloss") == []
    assert codes(checks.check_zero_loss(e, peak(3.0), "lowloss")) == {"zero_loss_offset"}
    assert checks.check_zero_loss(e, peak(3.0), "coreloss") == []


def test_formula_and_elements():
    assert checks.formula_elements("Fe2O3 (alpha)") == ["Fe", "O"]
    assert checks.formula_elements("(La0.7,Sr0.3)MnO3") == ["La", "Sr", "Mn", "O"]
    assert checks.check_formula("Fe2O3", ["Fe", "O"]) == []
    assert codes(checks.check_formula("Fe2O3", ["Fe", "Ti"])) == {"element_not_in_formula", "formula_element_not_listed"}


def test_edges():
    e = np.linspace(250, 600, 500)
    assert checks.check_edges(e, ["C", "O"], ["C_K", "O_K"], TABLE) == []
    found = checks.check_edges(e, ["C", "O", "Fe"], ["C_K", "Fe_L2,3"], TABLE)
    assert codes(found) == {"edge_out_of_range", "edge_in_range_not_listed"}
    assert "O K" in next(f.message for f in found if f.code == "edge_in_range_not_listed")
    assert checks.check_edges(e, ["C"], [], TABLE, spectrum_type="lowloss") == []


def test_run_all_stops_on_unusable_axis():
    assert codes(checks.run_all([], [])) == {"empty"}


needs_cache = pytest.mark.skipif(not CACHE.exists(), reason="run download_files.py first")


def cached(spectrum_id):
    entry = next(a for a in json.loads(ANALYSIS.read_text()) if a["spectrum_id"] == spectrum_id)
    return CACHE / entry["path"]


@needs_cache
@pytest.mark.parametrize(
    "spectrum_id, expected",
    [
        (21550, "energy_not_increasing"),  # 2014 import script: XPERCHAN 0, X column repeats
        (21546, "header_step_mismatch"),  # bad XPERCHAN
        (22061, "header_offset_mismatch"),  # OFFSET does not match the X column
    ],
)
def test_real_files_with_known_problems(spectrum_id, expected):
    sp = read_spectrum(cached(spectrum_id))
    assert expected in codes(checks.check_axis(sp.energy, sp.intensity, sp.header_axis))


@needs_cache
def test_real_core_loss_file_is_clean():
    sp = read_spectrum(cached(21529))  # AlN, Al K edge
    found = checks.run_all(sp.energy, sp.intensity, spectrum_type="coreloss", formula="AlN", elements=["Al"],
                           edges=["Al_K"], edge_table=BINDING, header_axis=sp.header_axis)
    assert [f for f in found if f.severity != "info"] == []


@needs_cache
def test_thickness_matches_exspy():
    logging.getLogger("hyperspy").setLevel(logging.ERROR)
    import exspy

    sp = read_spectrum(cached(21690))
    sig = exspy.signals.EELSSpectrum(sp.intensity)
    sig.axes_manager[0].offset = sp.energy[0]
    sig.axes_manager[0].scale = (sp.energy[-1] - sp.energy[0]) / (sp.energy.size - 1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        expected = float(np.ravel(sig.estimate_thickness(threshold=sig.estimate_elastic_scattering_threshold()).data)[0])
    assert checks.log_ratio_thickness(sp.energy, sp.intensity) == pytest.approx(expected, abs=0.02)


BINDING = json.loads((Path(__file__).parents[2] / "worker" / "public" / "eels_binding_energies.json").read_text())["elements"]


def synthetic(edges, lo=250.0, hi=900.0, n=2048, seed=0):
    """Power law with step edges {onset: relative jump}, Poisson noise at about 10^4 counts."""
    e = np.linspace(lo, hi, n)
    y = 1e4 * (e / hi) ** -3.0
    for at, jump in edges.items():
        y *= 1 + jump * (e >= at) * np.exp(-np.clip(e - at, 0, None) / 200)
    return e, np.random.default_rng(seed).poisson(y).astype(float)


def top(found):
    return [(d["candidates"][0]["element"], d["candidates"][0]["edge"]) for d in found]


@pytest.mark.parametrize("seed", range(3))
def test_detect_edges_synthetic(seed):
    e, y = synthetic({284: 0.5, 532: 0.3, 708: 0.5}, seed=seed)
    found = checks.detect_edges(e, y, BINDING)
    json.dumps(found)
    assert sorted(top(found)) == [("C", "K"), ("Fe", "L2,3"), ("O", "K")]
    for d in found:
        assert abs(d["energy"] - d["candidates"][0]["onset"]) < 3
        assert 0.5 <= d["confidence"] <= 1


def test_detect_edges_high_energy_k_edge():
    e, y = synthetic({1560: 0.3}, lo=1400, hi=2000)
    assert top(checks.detect_edges(e, y, BINDING)) == [("Al", "K")]


def test_detect_edges_plain_background_finds_nothing():
    e, y = synthetic({})
    assert checks.detect_edges(e, y, BINDING) == []


def test_detect_edges_skips_low_loss_and_xas():
    e, y = synthetic({532: 0.5})
    for kind in ("lowloss", "zeroloss", "xrayabs"):
        assert checks.detect_edges(e, y, BINDING, spectrum_type=kind) == []
    assert checks.detect_edges(e, y, BINDING, spectrum_type="coreloss")


def test_edges_near():
    near = checks.edges_near(708, BINDING)
    assert near[0] == {"element": "Fe", "edge": "L2,3", "onset": 708.0}
    assert checks.edges_near(286, BINDING)[0]["element"] == "C"  # C K before Ru M4,5 despite being further
    assert {"element": "Fe", "edge": "L1", "onset": 846.0} in checks.edges_near(846, BINDING)
    assert checks.edges_near(5, BINDING, window=1) == []


@needs_cache
@pytest.mark.parametrize(
    "spectrum_id, expected",
    [
        (21633, {("C", "K"), ("N", "K")}),
        (21644, {("Ti", "L2,3"), ("O", "K")}),
        (21702, {("B", "K"), ("N", "K")}),
        (21529, {("Al", "K")}),
        (22056, {("Fe", "L2,3")}),
    ],
)
def test_detect_edges_real_core_loss(spectrum_id, expected):
    sp = read_spectrum(cached(spectrum_id))
    assert set(top(checks.detect_edges(sp.energy, sp.intensity, BINDING, spectrum_type="coreloss"))) == expected
