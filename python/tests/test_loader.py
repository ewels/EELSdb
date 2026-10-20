import json

import eelsdb
from eelsdb.loader import load

MSA = b"#FORMAT : EMSA/MAS Spectral Data File\n#DATATYPE : XY\n#SPECTRUM : x\n280.0, 1\n280.5, 2\n281.0, 3\n281.5, 2\n"
RECORD = {
    "id": 7, "title": "Graphite", "technique": "eels", "elements": ["C"],
    "acquisition": {"beam_energy": {"value_kv": 200, "source": "user"}, "convergence_angle": {"value_mrad": None, "source": "unknown"},
                    "collection_angle": {"value_mrad": 12.5, "source": "file"}, "microscope": "Titan"},
    "reference": {"doi": "10.1/x"},
    "download_url": "https://eelsdb.eu/files/7/graphite.msa",
}


def fetcher(url):
    return json.dumps(RECORD).encode() if "/v2/spectra/" in url else MSA


def test_load_returns_signal_with_metadata():
    s = load(7, api="https://api.example", fetcher=fetcher)
    md = s.metadata
    assert md.General.title == "Graphite"
    assert md.Acquisition_instrument.TEM.beam_energy == 200
    assert md.Acquisition_instrument.TEM.Detector.EELS.collection_angle == 12.5
    assert not md.has_item("Acquisition_instrument.TEM.convergence_angle")
    assert md.General.doi == "10.1/x"
    assert s.axes_manager[0].offset == 280.0 and s.axes_manager[0].scale == 0.5
    assert s.original_metadata.eelsdb.id == 7
    assert "C" in md.Sample.elements


def test_package_exposes_load_without_importing_hyperspy():
    assert callable(eelsdb.load)
