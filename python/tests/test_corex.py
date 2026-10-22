import io
import zipfile

from corex import build, curves, edges, parse

HEADER = """*********************  Core Excitation Data  ********************
* Formula: {formula}
* Name: {name}
* Edge: {edge}
* Alpha Formula: {alpha}
* Reference: {ref}
* Source and Purity: N/A
* Acquisition Mode: EELS, 2 deg, 2500 eV CRE mode, 0.7 eV fwhm
*--------------------------------------------------------------
* No. of Spectra: 2
*   E (eV)        Raw data             Osc. Str. per atom (E-2)
*--------------------------------------------------------------
"""


def os_file(rows, **kw):
    fields = {"formula": "N2", "name": "nitrogen", "edge": "N 1s", "alpha": "N2", "ref": "Phys. Rev. A 36 (87) 1683."} | kw
    return HEADER.format(**fields) + "".join("\t".join(map(str, r)) + "\n" for r in rows)


def test_edges():
    assert edges("C 1s") == [("C", "K")]
    assert edges("Si2p 2s") == [("Si", "L2,3"), ("Si", "L1")]
    assert edges("01s") == [("O", "K")]
    assert edges("N 1s & O 1s") == [("N", "K"), ("O", "K")]
    assert edges("all") == []


def test_parse_skips_tag_rows_and_commas():
    h, labels, rows = parse("* FORMULA: CO\n* Alpha Form la: CO\n*  E (eV)  Raw\n  x  3y  1y\n 1.0E+02, 2.0, 3.0,\n")
    assert h == {"formula": "CO", "alpha formula": "CO"}
    assert rows == [[100.0, 2.0, 3.0]]


def test_curves_by_column_count():
    assert curves("E (eV) Raw data Osc. Str.", 3) == [("main", 0, 1), ("os", 0, 2)]
    assert curves("E (eV) Raw data N2 peak set to 1", 3) == [("main", 0, 1)]
    assert curves("E (eV) Raw data E (eV) Osc. Str.", 4) == [("main", 0, 1), ("os", 2, 3)]
    assert curves("E (eV) Raw data Osc. Str. smoothed", 4) == [("main", 0, 1), ("os", 0, 2), ("os_smoothed", 0, 3)]
    assert curves("E (eV) Raw data Osc. Str.", 4) == [("main", 0, 1), ("impurity_removed", 0, 2), ("os", 0, 3)]


def test_build_keeps_ids_and_skips_calculated_curves(tmp_path):
    zip_path = tmp_path / "corex.zip"
    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("nn-0nnkk.os", os_file([[400.0, 10, 0.1], [401.0, 20, 0.2]]))
        z.writestr("NN-1NNKK.OS", os_file([[400.0, 11, 0.1], [401.0, 21, 0.2]], ref="unpublished"))
        z.writestr("aaa-nnkk.os", os_file([[400.0, 1, 2]], edge="N 1s", ref="optimal atomic photoabsorption"))
    records, files = build(zip_path, [{"source": "nn-0nnkk.os", "id": 30005, "slug": "nitrogen-n-k-gas"}])
    assert [(r["source"], r["id"], r["slug"]) for r in records] == [
        ("NN-1NNKK.OS", 30006, "nitrogen-n-k-gas-2"),
        ("nn-0nnkk.os", 30005, "nitrogen-n-k-gas"),
    ]
    n2 = records[1]
    assert n2["title"] == "Nitrogen" and n2["edges"] == [("N", "K")] and n2["resolution_ev"] == 0.7
    assert n2["reference"] == "Phys. Rev. A 36 (87) 1683." and records[0]["reference"] is None
    assert [(f["role"], f["variant"], f["filename"]) for f in n2["files"]] == [
        ("original", None, "nn-0nnkk.os"),
        ("msa", None, "nn-0nnkk.msa"),
        ("variant", "os", "nn-0nnkk-os.msa"),
    ]
    os_msa = files["files/30005/nn-0nnkk-os.msa"].decode()
    assert "#YUNITS      : oscillator strength" in os_msa and "401, 0.2\r\n" in os_msa
