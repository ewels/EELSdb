# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Record responses from the live v1 API into data/fixtures/api-v1/ (read-only, public data)."""

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.eelsdb.eu"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "fixtures" / "api-v1"

# Polite read-only HTTP for the live site: GET only, at most 1 request per second.
USER_AGENT = "EELSdb-rewrite/0.1 (+https://github.com/ewels/EELSdb)"
MIN_INTERVAL_S = 1.0

_last_request = 0.0


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_follow = urllib.request.build_opener()
_no_follow = urllib.request.build_opener(_NoRedirect)


def get(url, follow_redirects=True):
    """Return (status, headers, body_bytes, final_url). HTTP errors are returned, not raised."""
    global _last_request
    wait = _last_request + MIN_INTERVAL_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    opener = _follow if follow_redirects else _no_follow
    try:
        with opener.open(req, timeout=60) as res:
            return res.status, res.headers, res.read(), res.url
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read(), url


# What exSpy's eelsdb() sends with its defaults, in its key order (None values dropped by requests).
EXSPY_DEFAULTS = [
    ("resolution_compare", "lt"),
    ("min_energy_compare", "gt"),
    ("max_energy_compare", "lt"),
    ("per_page", "-1"),
    ("order_direction", "ASC"),
]


def exspy(**kw):
    """exSpy query shape: the given filters merged into its default parameters, in exSpy's order."""
    order = ["type", "title", "author", "edge", "min_energy", "max_energy", "resolution",
             "resolution_compare", "monochromated", "formula", "min_energy_compare",
             "max_energy_compare", "per_page", "order", "order_direction"]
    params = dict(EXSPY_DEFAULTS)
    elements = kw.pop("element", None)
    params.update(kw)
    pairs = [(k, params[k]) for k in order if k in params]
    if isinstance(elements, str):
        pairs.append(("element", elements))
    elif elements:
        pairs += [("element[]", e) for e in elements]
    return pairs


def filter_queries():
    """(name, params) for /spectra/ covering every parameter and exSpy query shape."""
    q = [
        ("default", []),
        ("all", [("per_page", "-1")]),
        ("unknown-param", [("foo", "bar")]),
        ("unknown-param-with-valid", [("type", "coreloss"), ("max_n", "5")]),
        ("empty-type", [("type", ""), ("per_page", "-1")]),
    ]
    for t in ["coreloss", "lowloss", "zeroloss", "xrayabs", "nonsense"]:
        q.append((f"type-{t}", [("type", t), ("per_page", "-1")]))
    for t in ["graphite", "oxide", "BN", "carbon nanotube"]:
        q.append((f"title-{t}", [("title", t), ("per_page", "-1")]))
    # An author search that matches no user made WordPress drop the filter and list every post,
    # including private spectra and spam, so only authors that exist are recorded.
    for a in ["Hettler", "simon", "ewels"]:
        q.append((f"author-{a}", [("author", a), ("per_page", "-1")]))
    for e in ["Fe", "C", "O", "Xx"]:
        q.append((f"element-{e}", [("element", e), ("per_page", "-1")]))
    q.append(("element-list-C-N", [("element[]", "C"), ("element[]", "N"), ("per_page", "-1")]))
    q.append(("element-list-Fe-O", [("element[]", "Fe"), ("element[]", "O"), ("per_page", "-1")]))
    q.append(("element-list-single-Ti", [("element[]", "Ti"), ("per_page", "-1")]))
    for f in ["O", "Fe2O3", "TiO2", "C"]:
        q.append((f"formula-{f}", [("formula", f), ("per_page", "-1")]))
    for e in ["K", "L1", "L2,3", "M2,3", "M4,5", "N4,5", "O2,3"]:
        q.append((f"edge-{e}", [("edge", e), ("per_page", "-1")]))
    for key, value in [("min_energy", "200"), ("max_energy", "1000"), ("resolution", "0.5")]:
        q.append((f"{key}-nocompare", [(key, value), ("per_page", "-1")]))
        for cmp in ["gt", "eq", "lt", "ge", "zz"]:
            q.append((f"{key}-{cmp}", [(key, value), (f"{key}_compare", cmp), ("per_page", "-1")]))
    q.append(("min_energy-eq-0", [("min_energy", "0"), ("min_energy_compare", "eq"), ("per_page", "-1")]))
    q.append(("resolution-gt-1", [("resolution", "1"), ("resolution_compare", "gt"), ("per_page", "-1")]))
    for m in ["1", "0", "yes"]:
        q.append((f"monochromated-{m}", [("monochromated", m), ("per_page", "-1")]))
    for pp, page in [("10", "1"), ("10", "2"), ("10", "29"), ("10", "30"), ("5", "60"), ("3", None), ("abc", None)]:
        params = [("per_page", pp)] + ([("page", page)] if page else [])
        q.append((f"page-{pp}-{page or 'none'}", params))
    q.append(("page-only-2", [("page", "2")]))
    for key in ["title", "author", "date", "spectrumMin", "spectrumMax", "beamenergy", "resolution",
                "spectrumType", "spectrumFormula", "ref_year", "monochromated", "microscope", "bogus"]:
        for d in ["ASC", "DESC"]:
            q.append((f"order-{key}-{d}", [("order", key), ("order_direction", d), ("per_page", "-1")]))
    q.append(("order-direction-only-DESC", [("order_direction", "DESC"), ("per_page", "-1")]))
    q.append(("order-direction-lower", [("order", "title"), ("order_direction", "desc"), ("per_page", "-1")]))
    q.append(("combined-coreloss-Fe", [("type", "coreloss"), ("element", "Fe"), ("per_page", "-1")]))
    q.append(("combined-lowloss-range", [("type", "lowloss"), ("min_energy", "0"), ("min_energy_compare", "gt"),
                                         ("max_energy", "100"), ("max_energy_compare", "lt"), ("per_page", "-1")]))

    exspy_queries = [
        ("exspy-default", exspy()),
        ("exspy-coreloss", exspy(type="coreloss")),
        ("exspy-lowloss", exspy(type="lowloss")),
        ("exspy-xrayabs", exspy(type="xrayabs")),
        ("exspy-element-Fe", exspy(element="Fe")),
        ("exspy-element-list-B-N", exspy(element=["B", "N"])),
        ("exspy-title-graphite", exspy(title="graphite")),
        ("exspy-author-Hettler", exspy(author="Hettler")),
        ("exspy-formula-TiO2", exspy(formula="TiO2")),
        ("exspy-edge-K", exspy(edge="K")),
        ("exspy-edge-L23", exspy(edge="L2,3")),
        ("exspy-min-max", exspy(min_energy="100", max_energy="800")),
        ("exspy-resolution", exspy(resolution="1")),
        ("exspy-resolution-eq", exspy(resolution="1", resolution_compare="eq")),
        ("exspy-monochromated-1", exspy(monochromated="1")),
        ("exspy-monochromated-0", exspy(monochromated="0")),
        ("exspy-order-title", exspy(order="title")),
        ("exspy-order-spectrumMin-DESC", exspy(order="spectrumMin", order_direction="DESC")),
        ("exspy-max_n-10", exspy(per_page="10")),
    ]
    for name, params in exspy_queries:
        q.append((f"{name}-slash", params))
        q.append((f"{name}-noslash", params))
    return q


def find_key(obj, key):
    if isinstance(obj, dict):
        return key in obj or any(find_key(v, key) for v in obj.values())
    if isinstance(obj, list):
        return any(find_key(v, key) for v in obj)
    return False


def unpublished(body, published_ids):
    items = body if isinstance(body, list) else [body]
    return any(isinstance(x, dict) and "download_link" in x and x.get("id") not in published_ids for x in items)


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9._,-]+", "_", s).strip("_") or "root"


def record(name, path, params=(), follow_redirects=True, published_ids=None):
    """Fetch API path with params and save the fixture. Returns the parsed body, or None if refused."""
    query = urllib.parse.urlencode(list(params))
    url = API + path + (f"?{query}" if query else "")
    status, headers, raw, final_url = get(url, follow_redirects=follow_redirects)
    text = raw.decode("utf-8", errors="replace")
    try:
        body = json.loads(text)
    except ValueError:
        body = None
    if find_key(body, "email") or '"email"' in text:
        print(f"REFUSED (email key): {name}", file=sys.stderr)
        return None
    if published_ids is not None and unpublished(body, published_ids):
        print(f"REFUSED (unpublished spectra): {name}", file=sys.stderr)
        return None
    fixture = {
        "request": {"path": path, "query": query, "params": [list(p) for p in params]},
        "status": status,
        "headers": {k: headers[k] for k in ("content-type", "location") if headers.get(k)},
        "final_url": final_url if final_url != url else None,
        "body": body if body is not None else text,
    }
    out = OUT / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n")
    print(f"{status} {name}")
    return body


def compact_fixtures():
    """Store list responses as `body_ids` when every item equals its object in spectra/all.json."""
    canonical = {s["id"]: s for s in json.loads((OUT / "spectra" / "all.json").read_text())["body"]}
    for path in sorted((OUT / "spectra").glob("*.json")):
        if path.name == "all.json":
            continue
        fixture = json.loads(path.read_text())
        body = fixture.get("body")
        if isinstance(body, list) and all(isinstance(x, dict) and canonical.get(x.get("id")) == x for x in body):
            del fixture["body"]
            fixture["body_ids"] = [x["id"] for x in body]
            path.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n")


def main():
    record("index", "/index.php")
    record("root-noredirect", "/", follow_redirects=False)
    record("unknown-path", "/this-path-does-not-exist/")
    record("unknown-spectrum", "/spectra/this-spectrum-does-not-exist/")

    all_spectra = record("spectra/all", "/spectra/", [("per_page", "-1")])
    published = {s["id"] for s in all_spectra}
    for name, params in filter_queries():
        path = "/spectra" if name.endswith("-noslash") else "/spectra/"
        record(f"spectra/{name}", path, params, published_ids=published)
    for s in all_spectra:
        slug = s["permalink"].rstrip("/").rsplit("/", 1)[1]
        record(f"spectrum/{safe_name(slug)}", f"/spectra/{slug}/", published_ids=published)
    record("spectrum-noslash", f"/spectra/{slug}", published_ids=published)

    page, news = 1, []
    while True:
        path = "/news/" if page == 1 else f"/news/page/{page}/"
        body = record(f"news/list-page-{page}", path)
        if not isinstance(body, list) or not body:
            break
        news += body
        page += 1
    for post in news:
        slug = post["permalink"].rstrip("/").rsplit("/", 1)[1]
        record(f"news/post-{safe_name(slug)}", f"/{slug}/")
    compact_fixtures()


if __name__ == "__main__":
    main()
