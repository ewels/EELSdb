import json
import logging
import warnings

import numpy as np
import pytest

from eelsdb import checks
from eelsdb.cli import main
from eelsdb.io import read_spectrum
from eelsdb.legacy.analyse_files import OUTPUT as ANALYSIS
from eelsdb.legacy.download_files import CACHE

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


needs_cache = pytest.mark.skipif(not CACHE.exists(), reason="run eelsdb.legacy.download_files first")


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
                           edges=["Al_K"], edge_table=checks.exspy_edge_table(), header_axis=sp.header_axis)
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


@needs_cache
def test_cli_check(capsys):
    assert main(["check", str(cached(21550)), "--json"]) == 1
    findings = json.loads(capsys.readouterr().out)
    assert "energy_not_increasing" in {f["code"] for f in findings}
    assert main(["check", str(cached(21529)), "--type", "coreloss", "--formula", "AlN", "--edges", "Al_K"]) == 0
