import json
from collections import Counter

import pytest

from analyse_files import OUTPUT, txt_layout


def test_known_file_problems():
    analysis = json.loads(OUTPUT.read_text())
    flags = Counter(f for a in analysis for f in a["flags"])
    assert len(analysis) == 290
    assert flags["datatype_y_range_mismatch"] == 16
    assert flags["bad_xperchan"] == 8
    txt = [a for a in analysis if a["format"] == "txt"]
    assert len(txt) == 17
    assert len({a["layout"] for a in txt}) == 5


@pytest.mark.parametrize(
    "text, layout",
    [
        ("1700.0 , 95.2\n1700.5 , 92.5\n", "space-comma-space"),
        ("-10,0\r\n-9.95,1\r\n", "comma"),
        ("150\t369.3\r\n151\t367.2\r\n", "tab"),
        ("259.5\t  0.0\r\n259.6\t  1.0\r\n", "tab+spaces"),
        ("Energy Counts\n0.2 17567.79\n0.21 16204.01\n", "space"),
    ],
)
def test_txt_layouts(tmp_path, text, layout):
    path = tmp_path / "s.txt"
    path.write_bytes(text.encode())
    found, energy, intensity = txt_layout(path)
    assert found == layout
    assert len(energy) == len(intensity) == 2
    assert energy[1] > energy[0]
