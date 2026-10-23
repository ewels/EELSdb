# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools[woff]==4.67.0"]
# ///
"""Build the TTF fonts the Worker's share-card renderer (worker/src/og/) loads into resvg.

resvg reads neither WOFF2 nor variable weights reliably, so the self-hosted Mona Sans
is cut into static TTF weights with its Latin and Latin Extended subsets merged. Mona
Sans has no Greek or maths signs (α-MoO3, ≤), so a subset of Noto Sans is merged into
each weight: resvg's fallback to a separate font ignores the weight asked for.
It also writes metrics.json, the advance widths the renderer wraps text with.
Regenerate after changing the weights or the self-hosted font:

    uv run python/og_fonts.py
"""

import json
import urllib.request
from io import BytesIO
from pathlib import Path

from fontTools.merge import Merger
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "worker/public/fonts"
OUT = ROOT / "worker/src/og/fonts"
WEIGHTS = [400, 500, 600, 700]
NOTO = {
    400: "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf",
    700: "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf",
}
# Greek, the general punctuation and letterlike signs, arrows and maths operators.
NOTO_RANGES = [(0x0370, 0x03FF), (0x2010, 0x205F), (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF)]


def mona(weight: int, symbols: TTFont) -> TTFont:
    parts = []
    for subset in ["latin", "latin-ext"]:
        font = instantiateVariableFont(TTFont(FONTS / f"mona-sans-{subset}-wght-normal.woff2"), {"wght": weight})
        font.flavor = None
        path = OUT / f".tmp-{subset}.ttf"
        font.save(path)
        parts.append(path)
    path = OUT / ".tmp-symbols.ttf"
    symbols.save(path)
    parts.append(path)
    merged = Merger().merge([str(p) for p in parts])
    for p in parts:
        p.unlink()
    return named(merged, weight)


def italic() -> TTFont:
    font = instantiateVariableFont(TTFont(FONTS / "mona-sans-latin-wght-italic.woff2"), {"wght": 400})
    font.flavor = None
    return named(font, 400, italic=True)


def named(font: TTFont, weight: int, italic: bool = False) -> TTFont:
    """The instancer keeps the variable font's names and weight class; resvg matches faces by them."""
    font["OS/2"].usWeightClass = weight
    name = font["name"]
    for record_id in (16, 17):
        name.removeNames(nameID=record_id)
    name.setName("Mona Sans", 1, 3, 1, 0x409)
    name.setName("Italic" if italic else "Regular", 2, 3, 1, 0x409)
    return font


def advances(font: TTFont) -> dict[str, float]:
    em = font["head"].unitsPerEm
    hmtx = font["hmtx"]
    return {chr(u): round(hmtx[g][0] / em, 4) for u, g in font.getBestCmap().items()}


def noto(weight: int) -> TTFont:
    request = urllib.request.Request(NOTO[weight], headers={"User-Agent": "EELSdb-rewrite/0.1 (+https://github.com/ewels/EELSdb)"})
    font = TTFont(BytesIO(urllib.request.urlopen(request).read()))
    options = Options()
    options.layout_features = []
    options.drop_tables += ["GSUB", "GPOS", "GDEF"]
    subsetter = Subsetter(options)
    # Mona Sans keeps its own versions of anything both fonts have.
    mona_cmap = TTFont(FONTS / "mona-sans-latin-wght-normal.woff2").getBestCmap()
    subsetter.populate(unicodes=[u for a, b in NOTO_RANGES for u in range(a, b + 1) if u not in mona_cmap])
    subsetter.subset(font)
    return font


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    metrics = {}
    symbols = {weight: noto(weight) for weight in NOTO}
    for weight in WEIGHTS:
        font = mona(weight, symbols[400 if weight < 600 else 700])
        font.save(OUT / f"mona-sans-{weight}.ttf")
        metrics[weight] = advances(font)
    italic().save(OUT / "mona-sans-italic-400.ttf")
    (OUT.parent / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, separators=(",", ":")) + "\n")
    for path in sorted(OUT.glob("*.ttf")):
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
