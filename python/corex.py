# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Import Corex, the gas-phase ISEELS database of A.P. Hitchcock and D.C. Mancini (McMaster University, CC0).

Reads the zip of `.os` files Adam Hitchcock sent in October 2026 (newer than the Borealis copy) and writes
data/fixtures/corex.json, one record per spectrum, plus each original file and MSA copies of its curves under
data/cache/files/ for R2. build_seed.py turns the records into rows.

    uv run python/corex.py path/to/corex_gas_phase_ISEELS.zip
"""

import hashlib
import json
import re
import sys
import unicodedata
import zipfile

from eelsdb._elements import SYMBOLS
from record_api import ROOT

FIXTURE = ROOT / "data" / "fixtures" / "corex.json"
CACHE = ROOT / "data" / "cache" / "files"
FIRST_ID = 30001
SHELLS = {"1s": "K", "2s": "L1", "2p": "L2,3", "3s": "M1", "3p": "M2,3", "3d": "M4,5"}
UNITS = {"main": "counts", "impurity_removed": "counts", "os": "oscillator strength", "os_smoothed": "oscillator strength"}
KEY_ALIASES = {"alpha form la": "alpha formula"}
# Headers whose Edge disagrees with the file name and the energy range.
EDGE_FIXES = {
    "a1-0sill.os": "Si 2p 2s",
    "ds-0aakk.os": "S 2p 2s C 1s O 1s",
    "ds-0ookk.os": "O 1s",
    "ds-0ssl1.os": "S 2s",
    "ds-0ssl3.os": "S 2p",
    "ta-0ssl3.os": "S 2p 2s",
}


def parse(text, name=""):
    """Header fields (lower-case keys), the column-label line and the numeric rows of one .os file."""
    header, labels, rows = {}, "", []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("*"):
            m = re.match(r"\*\s*([A-Za-z][A-Za-z. ]*?)\s*:\s*(.*)", s)
            if m:
                key = m[1].lower()
                header[KEY_ALIASES.get(key, key)] = m[2].strip()
            if "E (e" in s:
                labels = s
            continue
        try:
            rows.append([float(v) for v in s.replace(",", " ").split()])
        except ValueError:
            # Some files have a column-tag row ("x  3y  1y") before the data.
            continue
    if name in EDGE_FIXES:
        header["edge"] = EDGE_FIXES[name]
    return header, labels, rows


def curves(labels, ncols):
    """(name, x column, y column) for each curve. Column labels are unreliable; the column count decides."""
    lab = labels.lower()
    if ncols == 2:
        return [("main", 0, 1)]
    if ncols == 3:
        return [("main", 0, 1)] + ([("os", 0, 2)] if "osc" in lab else [])
    if lab.count("e (e") == 2:
        return [("main", 0, 1), ("os", 2, 3)]
    if "smoothed" in lab:
        return [("main", 0, 1), ("os", 0, 2), ("os_smoothed", 0, 3)]
    # Three spectra: raw, raw with an impurity (N2, O2) subtracted, and oscillator strength from the latter.
    return [("main", 0, 1), ("impurity_removed", 0, 2), ("os", 0, 3)]


def edges(text):
    """'Si2p 2s' -> [('Si', 'L2,3'), ('Si', 'L1')]; '01s' is O 1s."""
    out, element = [], None
    for sym, shell in re.findall(r"([A-Z][a-z]?|0)?\s*([123][spd])", text):
        element = ("O" if sym == "0" else sym) or element
        if element in SYMBOLS and (element, SHELLS[shell]) not in out:
            out.append((element, SHELLS[shell]))
    return out


def slugify(text):
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def msa(title, unit, xs, ys, source):
    lines = [
        "#FORMAT      : EMSA/MAS Spectral Data File",
        "#VERSION     : 1.0",
        f"#TITLE       : {title[:64]}",
        "#OWNER       : A.P. Hitchcock, Corex (CC0)",
        f"#NPOINTS     : {len(xs)}",
        "#NCOLUMNS    : 1",
        "#XUNITS      : eV",
        f"#YUNITS      : {unit}",
        "#DATATYPE    : XY",
        f"#XPERCHAN    : {(xs[-1] - xs[0]) / max(len(xs) - 1, 1):.8g}",
        f"#OFFSET      : {xs[0]:.8g}",
        "#SIGNALTYPE  : ELS",
        f"#COMMENT     : From {source} in Corex, https://doi.org/10.5683/SP3/WUMVKY",
        "#SPECTRUM    : Spectral Data Starts Here",
        *(f"{x:.8g}, {y:.8g}" for x, y in zip(xs, ys)),
        "#ENDOFDATA   :",
    ]
    return ("\r\n".join(lines) + "\r\n").encode()


def record(name, text, sid, slug):
    """The fixture record for one file, and the files to write as {key: bytes}."""
    h, labels, rows = parse(text, name)
    rows = [r for r in rows if len(r) == len(rows[0])]
    title = h.get("name") or name
    title = title[0].upper() + title[1:]
    formula = h.get("alpha formula") or h.get("formula")
    edge_list = edges(h.get("edge", ""))
    elements = list(dict.fromkeys([e for e in re.findall(r"[A-Z][a-z]?", formula or "") if e in SYMBOLS] + [e for e, _ in edge_list]))
    reference = h.get("reference", "").strip()
    purity = h.get("source and purity", "").strip()
    mode = h.get("acquisition mode", "").strip()
    resolution = re.search(r"([\d.]+)\s*eV\s*fwhm", mode)

    files = {f"files/{sid}/{name}": text.encode()}
    file_rows = [{"role": "original", "variant": None, "key": f"files/{sid}/{name}"}]
    stem = name.rsplit(".", 1)[0].lower()
    main_x = None
    for curve, xc, yc in curves(labels, len(rows[0])):
        xs, ys = [r[xc] for r in rows], [r[yc] for r in rows]
        key = f"files/{sid}/{stem}{'' if curve == 'main' else '-' + curve.replace('_', '-')}.msa"
        files[key] = msa(title, UNITS[curve], xs, ys, name)
        file_rows.append({"role": "msa" if curve == "main" else "variant", "variant": None if curve == "main" else curve, "key": key})
        if curve == "main":
            main_x = xs
    for f in file_rows:
        f["filename"] = f["key"].rsplit("/", 1)[1]
        f["bytes"] = len(files[f["key"]])
        f["sha256"] = hashlib.sha256(files[f["key"]]).hexdigest()

    return {
        "id": sid,
        "source": name,
        "slug": slug,
        "title": title,
        "formula": formula,
        "structural_formula": h.get("formula"),
        "elements": elements,
        "edges": edge_list,
        "ref_code": h.get("ref. code") or None,
        "reference": None if not reference or "unpub" in reference.lower() else reference,
        "source_purity": None if purity.strip("?").upper() in ("", "N/A") else purity,
        "acquisition_mode": mode or None,
        "resolution_ev": float(resolution[1]) if resolution else None,
        "min_energy_ev": min(main_x),
        "max_energy_ev": max(main_x),
        "files": file_rows,
    }, files


def is_measurement(text):
    """Corex also holds calculated atomic photoabsorption curves (the aaa-* files), which are not spectra."""
    return "atomic photoabsorption" not in text.lower()


def build(zip_path, previous=()):
    """Records and files for every measured spectrum in the zip. IDs and slugs already given in `previous` are kept."""
    kept = {r["source"]: (r["id"], r["slug"]) for r in previous}
    next_id = max([FIRST_ID - 1, *(i for i, _ in kept.values())]) + 1
    used = {s for _, s in kept.values()}
    records, files = [], {}
    with zipfile.ZipFile(zip_path) as z:
        names = sorted(n for n in z.namelist() if n.lower().endswith(".os"))
        texts = {n: z.read(n).decode("utf-8") for n in names}
    for name in names:
        if not is_measurement(texts[name]):
            continue
        if name in kept:
            sid, slug = kept[name]
        else:
            h, _, _ = parse(texts[name], name)
            base = slugify(f"{h.get('name') or name} {' '.join(f'{e} {x}' for e, x in edges(h.get('edge', '')))} gas")
            slug, n = base, 2
            while slug in used:
                slug, n = f"{base}-{n}", n + 1
            sid, next_id = next_id, next_id + 1
        used.add(slug)
        rec, fs = record(name, texts[name], sid, slug)
        records.append(rec)
        files.update(fs)
    return records, files


def main():
    previous = json.loads(FIXTURE.read_text()) if FIXTURE.exists() else []
    records, files = build(sys.argv[1], previous)
    for key, data in files.items():
        dest = CACHE / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    FIXTURE.write_text(json.dumps(records, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(records)} spectra, {len(files)} files")


if __name__ == "__main__":
    main()
