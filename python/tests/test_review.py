import email
import json

import numpy as np
import pytest

from eelsdb.client import multipart, site_url
from eelsdb.io import read_any
from eelsdb.legacy.analyse_files import OUTPUT as ANALYSIS
from eelsdb.legacy.download_files import CACHE
from eelsdb.review import compare, json_safe, process, write_hspy, write_msa

ACQ = {"beam_energy_kv": 200.0, "convergence_mrad": 21.5, "collection_mrad": None}


def test_msa_roundtrip_keeps_non_uniform_axis_and_header(tmp_path):
    energy = np.array([280.0, 280.1, 280.25, 280.4])
    data = np.array([1.0, 2.0, 3.0, 4.0])
    sp = read_any(write_msa(tmp_path / "x.msa", energy, data, "Test", ACQ))
    np.testing.assert_allclose(sp.energy, energy)
    np.testing.assert_allclose(sp.intensity, data)
    assert sp.header["beam_energy_kv"] == 200.0
    assert sp.header["convergence_mrad"] == 21.5


def test_hspy_roundtrip_through_rosettasciio(tmp_path):
    energy = 100 + 0.5 * np.arange(50)
    path = write_hspy(tmp_path / "x.hspy", energy, np.arange(50.0), "Test", ACQ, {"doi": "10.1/x"})
    sp = read_any(path)
    np.testing.assert_allclose(sp.energy, energy)
    assert sp.header["beam_energy_kv"] == 200.0
    assert sp.header["convergence_mrad"] == 21.5


def test_compare_flags_differences():
    rows = compare({"beam_energy_kv": 200, "convergence_mrad": 20}, {"beam_energy_kv": 300, "convergence_mrad": 20})
    assert [r[3] for r in rows] == [True, False, False]


@pytest.mark.skipif(not CACHE.exists(), reason="run eelsdb.legacy.download_files first")
def test_process_real_file(tmp_path):
    entry = next(a for a in json.loads(ANALYSIS.read_text()) if a["spectrum_id"] == 21529)
    detail = {"spectrum": {"title": "AlN", "slug": "aln", "type": "coreloss", "formula": "AlN"},
              "acquisition": ACQ, "kind": "new", "submitter": "Test", "browser_checks": None}
    result = process(detail, CACHE / entry["path"], tmp_path)
    assert set(result["outputs"]) == {"msa", "hspy", "metadata"}
    assert result["record"]["values"]["min_energy_ev"] == pytest.approx(1533.4, abs=0.01)
    assert {t["tool"] for t in result["record"]["tools"]} >= {"rosettasciio", "exspy"}
    assert "AlN" in result["report"].read_text()
    assert read_any(result["outputs"]["msa"]).energy.size == 1020


def test_multipart_encoding(tmp_path):
    f = tmp_path / "a.msa"
    f.write_bytes(b"1, 2\n")
    body, ctype = multipart({"title": "Ångström", "empty": ""}, {"file": f})
    msg = email.message_from_bytes(f"Content-Type: {ctype}\r\n\r\n".encode() + body)
    parts = {p.get_param("name", header="content-disposition"): p for p in msg.get_payload()}
    assert set(parts) == {"title", "file"}
    assert parts["title"].get_payload(decode=True).decode() == "Ångström"
    assert parts["file"].get_filename() == "a.msa"
    assert parts["file"].get_payload(decode=True) == b"1, 2\n"


def test_site_url():
    assert site_url("https://api.eelsdb.eu") == "https://eelsdb.eu"
    assert site_url("http://api.localhost:8787") == "http://localhost:8787"


def test_spectrum_image_is_rejected_and_metadata_kept(tmp_path):
    import hyperspy.api as hs

    cube = hs.signals.Signal1D(np.ones((2, 3, 40)))
    cube.axes_manager[-1].units, cube.axes_manager[-1].offset, cube.axes_manager[-1].scale = "eV", 280.0, 0.5
    cube.original_metadata.add_dictionary({"Session": {"Voltage": 200, "Thumbnail": np.zeros((64, 64))}})
    cube.save(tmp_path / "si.hspy")
    detail = {"spectrum": {"title": "SI", "slug": "si", "type": "coreloss", "formula": "C"},
              "acquisition": ACQ, "kind": "new", "submitter": "Test", "browser_checks": None}
    result = process(detail, tmp_path / "si.hspy", tmp_path / "out")
    assert result["findings"][0].code == "spectrum_image" and result["findings"][0].severity == "error"
    assert "2 × 3 spectra" in result["report"].read_text()
    assert json.loads(result["outputs"]["metadata"].read_text())["Session"] == {"Voltage": 200, "Thumbnail": "<array 64x64 float64>"}


def test_json_safe_handles_numpy_bytes_and_nan():
    assert json_safe({"a": np.float32(1.5), "b": b"x", "c": float("nan"), "d": np.arange(3), 1: (1, 2)}) == \
        {"a": 1.5, "b": "x", "c": None, "d": [0, 1, 2], "1": [1, 2]}
