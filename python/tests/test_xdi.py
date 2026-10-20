import numpy as np

from eelsdb import checks
from eelsdb.io import read_any

# Shape of the XDI 1.0 specification's example (cu_metal_rt.xdi), shortened.
XDI = """# XDI/1.0 GSE/1.0
# Column.1: energy eV
# Column.2: i0
# Column.3: itrans
# Column.4: mutrans
# Element.edge: K
# Element.symbol: Cu
# Scan.edge_energy: 8980.0
# Mono.name: Si 111
# Mono.d_spacing: 3.13553
# Beamline.name: 13ID
# Facility.name: APS
# Facility.xray_source: APS Undulator A
# Sample.formula: Cu
# ///
# Cu foil Room Temperature
#----
# energy i0 itrans mutrans
  8779.0  149013.7  550643.089065  -1.3070486
  8789.0  144864.7  531876.119084  -1.3006104
  8799.0  132978.7  489591.10592   -1.3033816
  8809.0  125444.7  463051.072056  -1.3059724
"""


def test_read_xdi(tmp_path):
    path = tmp_path / "cu.xdi"
    path.write_text(XDI)
    sp = read_any(path)
    np.testing.assert_allclose(sp.energy, [8779, 8789, 8799, 8809])
    np.testing.assert_allclose(sp.intensity[0], -1.3070486)
    assert sp.header["xas"] == {"facility": "APS", "beamline": "13ID", "source_type": "APS Undulator A", "monochromator": "Si 111",
                                "element": "Cu", "edge": "K", "formula": "Cu", "intensity_column": "mutrans"}


def test_xdi_in_kev_and_checks(tmp_path):
    path = tmp_path / "k.xdi"
    path.write_text("# XDI/1.0\n# Column.1: energy keV\n# Column.2: mu\n#----\n8.779 1.0\n8.789 1.1\n8.799 1.3\n8.809 1.2\n")
    sp = read_any(path)
    np.testing.assert_allclose(sp.energy, [8779, 8789, 8799, 8809])
    assert sp.header["xas"]["intensity_column"] == "mu"
    assert [f.code for f in checks.check_axis(sp.energy, sp.intensity)] == ["too_short"]
