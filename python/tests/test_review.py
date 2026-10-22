import json
from pathlib import Path

import numpy as np
import pytest

from analyse_files import OUTPUT as ANALYSIS
from download_files import CACHE
from eelsdb.io import read_any
from eelsdb.review import compare, json_safe, process, write_hspy, write_msa

ACQ = {"beam_energy_kv": 200.0, "convergence_mrad": 21.5, "collection_mrad": None}
BINDING = json.loads((Path(__file__).parents[2] / "worker" / "public" / "eels_binding_energies.json").read_text())["elements"]


def test_msa_roundtrip_keeps_non_uniform_axis_and_header(tmp_path):
    energy = np.array([280.0, 280.1, 280.25, 280.4])
    data = np.array([1.0, 2.0, 3.0, 4.0])
    sp = read_any(write_msa(tmp_path / "x.msa", energy, data, "Test", ACQ))
    np.testing.assert_allclose(sp.energy, energy)
    np.testing.assert_allclose(sp.intensity, data)
    assert sp.header["beam_energy_kv"] == 200.0
    assert sp.header["convergence_mrad"] == 21.5


@pytest.mark.parametrize("energy", [100 + 0.5 * np.arange(50), 100 + np.arange(50) ** 1.1], ids=["uniform", "non-uniform"])
def test_hspy_roundtrip_through_rosettasciio(tmp_path, energy):
    path = write_hspy(tmp_path / "x.hspy", energy, np.arange(50.0), "Test", ACQ, {"doi": "10.1/x"})
    sp = read_any(path)
    np.testing.assert_allclose(sp.energy, energy)
    assert sp.header["beam_energy_kv"] == 200.0
    assert sp.header["convergence_mrad"] == 21.5


def test_hspy_opens_in_hyperspy_as_eels(tmp_path):
    hs = pytest.importorskip("hyperspy.api")
    pytest.importorskip("exspy")
    s = hs.load(write_hspy(tmp_path / "x.hspy", 100 + 0.5 * np.arange(50), np.arange(50.0), "Test", ACQ, {"doi": "10.1/x"}))
    assert s.metadata.Signal.signal_type == "EELS"
    assert s.metadata.General.doi == "10.1/x"
    assert s.metadata.Acquisition_instrument.TEM.beam_energy == 200.0


def test_xas_hspy_is_a_plain_signal(tmp_path):
    hs = pytest.importorskip("hyperspy.api")
    s = hs.load(write_hspy(tmp_path / "x.hspy", 280 + 0.1 * np.arange(50), np.arange(50.0), "Test", ACQ, None, eels=False))
    assert type(s).__name__ == "Signal1D"
    assert s.axes_manager[0].name == "Energy"
    assert "Acquisition_instrument" not in s.metadata


def test_every_seeded_spectrum_has_an_hspy_file():
    from build_seed import COREX, HSPY, API_FIXTURES, load

    ids = {s["id"] for s in load(API_FIXTURES / "spectra" / "all.json")["body"] if "download_link" in s}
    ids |= {r["id"] for r in load(COREX)}
    assert {f["spectrum_id"] for f in load(HSPY)} == ids


def test_compare_flags_differences():
    rows = compare({"beam_energy_kv": 200, "convergence_mrad": 20}, {"beam_energy_kv": 300, "convergence_mrad": 20})
    assert [r["differs"] for r in rows] == [True, False, False]


@pytest.mark.skipif(not CACHE.exists(), reason="run download_files.py first")
def test_process_real_file(tmp_path):
    entry = next(a for a in json.loads(ANALYSIS.read_text()) if a["spectrum_id"] == 21529)
    detail = {"spectrum": {"title": "AlN", "slug": "aln", "type": "coreloss", "formula": "AlN"}, "acquisition": ACQ}
    result = process(detail, CACHE / entry["path"], tmp_path, BINDING)
    assert set(result["outputs"]) == {"msa", "hspy", "metadata"}
    assert result["record"]["values"]["min_energy_ev"] == pytest.approx(1533.4, abs=0.01)
    assert {t["tool"] for t in result["record"]["tools"]} >= {"rosettasciio", "numpy", "h5py"}
    assert result["points"] == 1020 and len(result["plot"][0]) == 1020
    assert read_any(result["outputs"]["msa"]).energy.size == 1020


def test_spectrum_image_is_rejected_and_metadata_kept(tmp_path):
    from rsciio.hspy import file_writer

    file_writer(str(tmp_path / "si.hspy"), {
        "data": np.ones((2, 3, 40)),
        "axes": [{"size": 2, "navigate": True}, {"size": 3, "navigate": True}, {"size": 40, "offset": 280.0, "scale": 0.5, "units": "eV", "navigate": False}],
        "metadata": {"General": {"title": "SI"}, "Signal": {"signal_type": "EELS"}},
        "original_metadata": {"Session": {"Voltage": 200, "Thumbnail": np.zeros((64, 64))}},
        "tmp_parameters": {}, "attributes": {"_lazy": False}, "learning_results": {}, "models": {},
        "package_info": {"package": "rosettasciio", "package_version": "0"},
    })
    detail = {"spectrum": {"title": "SI", "slug": "si", "type": "coreloss", "formula": "C"}, "acquisition": ACQ}
    result = process(detail, tmp_path / "si.hspy", tmp_path / "out", BINDING)
    assert result["findings"][0].code == "spectrum_image" and result["findings"][0].severity == "error"
    assert result["navigation_shape"] == [2, 3]
    assert json.loads(result["outputs"]["metadata"].read_text())["Session"] == {"Voltage": 200, "Thumbnail": "<array 64x64 float64>"}


def test_json_safe_handles_numpy_bytes_and_nan():
    assert json_safe({"a": np.float32(1.5), "b": b"x", "c": float("nan"), "d": np.arange(3), 1: (1, 2)}) == \
        {"a": 1.5, "b": "x", "c": None, "d": [0, 1, 2], "1": [1, 2]}
