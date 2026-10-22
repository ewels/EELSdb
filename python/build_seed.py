# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Build the D1 seed (SQL) and the R2 upload list from the recorded API, file manifest and file analysis.

Migrated spectra keep their WordPress IDs, slugs and file paths. `legacy_v1` holds the recorded v1
object, with the energy range replaced for files whose recorded range was wrong.
"""

import json
import urllib.parse

from record_api import OUT as API_FIXTURES, ROOT

# The old site tagged every spectrum it migrated from the first database, and linked each to its page there, which
# is gone. Both are left out of the typed rows; the recorded v1 objects keep them, so API v1 replays unchanged.
DROPPED_KEYWORDS = {"imported from old site"}
DEAD_HOSTS = {"pc-web.cemes.fr"}

FIXTURES = ROOT / "data" / "fixtures"
COREX = FIXTURES / "corex.json"
HSPY = FIXTURES / "hspy.json"
SEED_DIR = ROOT / "data" / "seed"
TYPE_CODES = {"Core Loss": "coreloss", "Low Loss": "lowloss", "Zero Loss": "zeroloss", "X Ray Abs": "xrayabs"}
DECONV_COLUMNS = {
    "Fourier-log": "deconv_fourier_log",
    "Fourier-ratio": "deconv_fourier_ratio",
    "Stephen's deconvolution": "deconv_stephens",
    "Richardson-Lucy": "deconv_richardson_lucy",
    "Maximum-Entropy": "deconv_maximum_entropy",
}
MEDIA_TYPES = {".msa": "text/plain", ".txt": "text/plain"}
# Only these files had a wrong range in the live API; for bad_xperchan files the API range was
# already right (the old parser read the X column), and the file itself is fixed at reprocessing.
FIXED_FLAGS = {"datatype_y_range_mismatch"}


def sql(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    # One statement per line: newlines become char() so the seed can be split on lines.
    quoted = "'" + str(v).replace("'", "''") + "'"
    return quoted.replace("\r", "' || char(13) || '").replace("\n", "' || char(10) || '")


def insert(table, row):
    cols = ", ".join(row)
    vals = ", ".join(sql(v) for v in row.values())
    return f"INSERT INTO {table} ({cols}) VALUES ({vals});"


def num(s, unit=""):
    """'300 kV' -> 300.0; None stays None."""
    if s is None:
        return None
    return float(s.removesuffix(unit).strip())


def slug_of(url):
    """Last path segment, decoded: WordPress stored non-ASCII slugs percent-encoded."""
    return urllib.parse.unquote(url.rstrip("/").rsplit("/", 1)[1])


def yes_no(v):
    return None if v is None else v == "Yes"


def energy_v1(x):
    """Format an energy the way PHP did: round(x, 2) . ' eV'."""
    r = round(x, 2)
    return f"{int(r)} eV" if r == int(r) else f"{r} eV"


def load(path):
    return json.loads(path.read_text())


def spectrum_rows(s, rank, ids_by_slug, manifest, analysis):
    """Statements for one recorded v1 spectrum object."""
    sid = s["id"]
    legacy = dict(s)
    min_e, max_e = num(s.get("min_energy"), "eV"), num(s.get("max_energy"), "eV")
    # Links to private spectra exposed their titles and led to a login page.
    public_links = [x for x in s.get("associated_spectra", []) if "?post_type=" not in x["link"]]
    if len(public_links) != len(s.get("associated_spectra", [])):
        if public_links:
            legacy["associated_spectra"] = public_links
        else:
            del legacy["associated_spectra"]
    a = analysis.get(sid)
    if a and FIXED_FLAGS & set(a["flags"]):
        min_e, max_e = a["energy_min"], a["energy_max"]
        legacy["max_energy"] = energy_v1(max_e)
        if round(min_e, 2) != 0:
            legacy["min_energy"] = energy_v1(min_e)
        else:
            legacy.pop("min_energy", None)

    out = [insert("spectra", {
        "id": sid,
        "slug": slug_of(s["permalink"]),
        "status": "published",
        # WordPress stored " - " and printed it as " &#8211; " (wptexturize).
        "title": s["title"].replace(" &#8211; ", " - "),
        "type": TYPE_CODES[s["type"]],
        "technique": "xas" if s["type"] == "X Ray Abs" else "eels",
        "intensity_units": "counts",
        "formula": s.get("formula"),
        "source_purity": s.get("source_purity"),
        "description": s.get("description"),
        "min_energy_ev": min_e,
        "max_energy_ev": max_e,
        "step_ev": num(s.get("stepSize"), "eV/pixel"),
        "author_display": s["author"]["name"],
        "author_slug": slug_of(s["author"]["profile_url"]),
        "published_at": s["published"],
        "created_at": s["published"],
        "completeness": None if s["type"] == "X Ray Abs" else
        "full" if all(k in s for k in ("beamenergy", "convergence", "collection")) else "partial",
        "legacy_rank": rank,
        "legacy_v1": json.dumps(legacy, ensure_ascii=False, separators=(",", ":")),
    })]

    for i, el in enumerate(dict.fromkeys(s.get("elements", []))):
        out.append(insert("spectrum_elements", {"spectrum_id": sid, "element": el, "position": i}))
    for i, edge in enumerate(dict.fromkeys(s.get("edges", []))):
        el, _, name = edge.partition("_")
        out.append(insert("spectrum_edges", {"spectrum_id": sid, "element": el, "edge": name, "position": i}))
    keywords = [kw for kw in dict.fromkeys(s.get("keywords", [])) if kw.strip().lower() not in DROPPED_KEYWORDS]
    for i, kw in enumerate(keywords):
        out.append(insert("spectrum_keywords", {"spectrum_id": sid, "keyword": kw, "position": i}))
    for i, link in enumerate(s.get("associated_spectra", [])):
        related = ids_by_slug.get(slug_of(link["link"]))
        if related is not None:
            out.append(insert("spectrum_links", {"spectrum_id": sid, "related_id": related, "position": i}))
    for i, link in enumerate(link for link in s.get("other_links", []) if urllib.parse.urlparse(link["url"]).hostname not in DEAD_HOSTS):
        out.append(insert("spectrum_other_urls",
                          {"spectrum_id": sid, "url": link["url"], "title": link.get("title"), "position": i}))

    if "download_link" in s:
        f = manifest.get(sid)
        path = urllib.parse.unquote(urllib.parse.urlparse(s["download_link"]).path).lstrip("/")
        ext = "." + path.rsplit(".", 1)[-1].lower()
        out.append(insert("files", {
            "spectrum_id": sid,
            "role": "legacy",
            "r2_key": path,
            "filename": path.rsplit("/", 1)[-1],
            "media_type": MEDIA_TYPES.get(ext, "application/octet-stream"),
            "bytes": f["bytes"] if f else None,
            "sha256": f["sha256"] if f else None,
            "created_at": s["published"],
        }))

    def source(v):
        return None if v is None else "user"

    beam, conv, coll = num(s.get("beamenergy"), "kV"), num(s.get("convergence"), "mrad"), num(s.get("collection"), "mrad")
    out.append(insert("eels_acquisition", {
        "spectrum_id": sid,
        "microscope": s.get("microscope"),
        "gun_type": s.get("guntype"),
        "acquisition_mode": s.get("acquisition_mode"),
        "detector": s.get("detector"),
        "beam_energy_kv": beam, "beam_energy_source": source(beam),
        "convergence_mrad": conv, "convergence_source": source(conv),
        "collection_mrad": coll, "collection_source": source(coll),
        "resolution_ev": num(s.get("resolution"), "eV"),
        "monochromated": yes_no(s.get("monochromated")),
        "probe_size_nm2": num(s.get("probesize"), "nm^2"),
        "beam_current": s.get("beamcurrent"),
        "integration_time_s": num(s.get("integratetime"), "secs"),
        "readouts": int(s["readouts"]) if "readouts" in s else None,
    }))
    if s["type"] == "X Ray Abs":
        out.append(insert("xas_acquisition", {"spectrum_id": sid, "beamline": s.get("microscope")}))

    treatment = {
        "spectrum_id": sid,
        "dark_current": yes_no(s.get("darkcurrent")),
        "gain_variation": yes_no(s.get("gainvariation")),
        "calibration": s.get("calibration"),
        "thickness_t_lambda": num(s.get("thickness"), "t/&lambda;"),
        "thickness_source": "user" if "thickness" in s else None,
    }
    other = []
    for d in s.get("deconvolutions", []):
        if d in DECONV_COLUMNS:
            treatment[DECONV_COLUMNS[d]] = 1
        else:
            other.append(d)
    treatment["deconv_other"] = "\n".join(other) or None
    out.append(insert("treatment", treatment))

    if "reference" in s:
        out.append(insert("reference", {"spectrum_id": sid, **s["reference"]}))
    return out


COREX_IMPORTED = "2026-10-23 12:00:00"
COREX_DESCRIPTION = "From Corex, the gas-phase core excitation database of A.P. Hitchcock and D.C. Mancini, McMaster University."
COREX_LINKS = [
    ("https://doi.org/10.5683/SP3/WUMVKY", "Corex on Borealis Dataverse"),
    ("https://doi.org/10.1016/S0368-2048(00)00200-0", "Hitchcock (2000): Inner shell excitation spectroscopy of molecules using inelastic electron scattering"),
]


def corex_rows(r):
    """Statements for one Corex record (see corex.py)."""
    sid = r["id"]
    notes = [COREX_DESCRIPTION,
             f"Structural formula: {r['structural_formula']}." if r["structural_formula"] not in (None, r["formula"]) else None,
             f"Corex file {r['source']}" + (f", reference code {r['ref_code']}." if r["ref_code"] else ".")]
    out = [insert("spectra", {
        "id": sid,
        "slug": r["slug"],
        "status": "published",
        "title": r["title"],
        "type": "coreloss",
        "technique": "eels",
        "phase": "gas",
        "intensity_units": "counts",
        "formula": r["formula"],
        "source_purity": r["source_purity"],
        "description": " ".join(n for n in notes if n),
        "min_energy_ev": r["min_energy_ev"],
        "max_energy_ev": r["max_energy_ev"],
        "author_display": "Adam Hitchcock",
        "author_slug": "adam-hitchcock",
        "licence": "CC0-1.0",
        "published_at": COREX_IMPORTED,
        "created_at": COREX_IMPORTED,
        "completeness": "partial",
    })]
    for i, el in enumerate(r["elements"]):
        out.append(insert("spectrum_elements", {"spectrum_id": sid, "element": el, "position": i}))
    for i, (el, edge) in enumerate(r["edges"]):
        out.append(insert("spectrum_edges", {"spectrum_id": sid, "element": el, "edge": edge, "position": i}))
    out.append(insert("spectrum_keywords", {"spectrum_id": sid, "keyword": "Corex", "position": 0}))
    for i, (url, title) in enumerate(COREX_LINKS):
        out.append(insert("spectrum_other_urls", {"spectrum_id": sid, "url": url, "title": title, "position": i}))
    for f in r["files"]:
        out.append(insert("files", {
            "spectrum_id": sid,
            "role": f["role"],
            "r2_key": f["key"],
            "filename": f["filename"],
            "media_type": "text/plain",
            "bytes": f["bytes"],
            "sha256": f["sha256"],
            "created_at": COREX_IMPORTED,
            "variant": f["variant"],
        }))
    out.append(insert("eels_acquisition", {
        "spectrum_id": sid,
        "microscope": "ISEELS spectrometer, McMaster University",
        "acquisition_mode": r["acquisition_mode"],
        "beam_energy_source": "unknown",
        "convergence_source": "unknown",
        "collection_source": "unknown",
        "resolution_ev": r["resolution_ev"],
    }))
    if r["reference"]:
        out.append(insert("reference", {"spectrum_id": sid, "freetext": r["reference"]}))
    return out


def news_rows(post, list_order):
    full = FIXTURES / "news" / f"{slug_of(post['permalink'])}.html"
    body_html = full.read_text().strip() if full.exists() else post.get("description")
    return [insert("news", {
        "id": post["id"],
        "slug": slug_of(post["permalink"]),
        "title": post["title"],
        "published_at": post["published"],
        "body_html": body_html,
        "legacy_rank": list_order,
        "legacy_v1": json.dumps(post, ensure_ascii=False, separators=(",", ":")),
    })]


def build():
    spectra = load(API_FIXTURES / "spectra" / "all.json")["body"]
    manifest = {f["spectrum_id"]: f for f in load(FIXTURES / "files.json")} if (FIXTURES / "files.json").exists() else {}
    analysis_path = FIXTURES / "file-analysis.json"
    analysis = {a["spectrum_id"]: a for a in load(analysis_path)} if analysis_path.exists() else {}
    ids_by_slug = {slug_of(s["permalink"]): s["id"] for s in spectra}

    lines = []
    for rank, s in enumerate(spectra):
        lines += spectrum_rows(s, rank, ids_by_slug, manifest, analysis)
    corex = load(COREX) if COREX.exists() else []
    for r in corex:
        lines += corex_rows(r)
    hspy = load(HSPY) if HSPY.exists() else []
    lines += [insert("files", {"spectrum_id": f["spectrum_id"], "role": "hspy", "r2_key": f["key"], "filename": f["filename"],
                               "media_type": "application/x-hdf5", "bytes": f["bytes"], "sha256": f["sha256"]}) for f in hspy]
    # Spectra first, so rows that reference them (including links between spectra) insert in order.
    lines.sort(key=lambda line: not line.startswith("INSERT INTO spectra "))

    news = []
    for page in sorted((API_FIXTURES / "news").glob("list-page-*.json"), key=lambda p: int(p.stem.rsplit("-", 1)[1])):
        body = load(page)["body"]
        if isinstance(body, list):
            news += body
    for i, post in enumerate(news):
        lines += news_rows(post, i)

    uploads = [{"key": f["path"], "file": f"data/cache/files/{f['path']}", "sha256": f["sha256"]}
               for f in sorted(manifest.values(), key=lambda f: f["path"])]
    uploads += [{"key": f["key"], "file": f"data/cache/files/{f['key']}", "sha256": f["sha256"]} for r in corex for f in r["files"]]
    uploads += [{"key": f["key"], "file": f"data/cache/files/{f['key']}", "sha256": f["sha256"]} for f in hspy]
    return "\n".join(lines) + "\n", uploads


def main():
    seed, uploads = build()
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    (SEED_DIR / "seed.sql").write_text(seed)
    (SEED_DIR / "r2-uploads.json").write_text(json.dumps(uploads, indent=1) + "\n")
    print(f"{seed.count('INSERT INTO spectra ')} spectra, {seed.count('INSERT INTO news ')} news, {len(uploads)} files")


if __name__ == "__main__":
    main()
