# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools[woff]==4.67.0", "uharfbuzz==0.56.3", "resvg-py==0.5.0"]
# ///
"""Build the downloadable logo files in worker/public/logo/ from worker/src/pages/logo.ts.

The lettering is converted to outlines from the self-hosted Mona Sans font, so the
files render without the font installed. Regenerate after changing the logo:

    uv run python/logo_files.py
"""

import re
from io import BytesIO
from pathlib import Path

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "worker/public/fonts/mona-sans-latin-wght-normal.woff2"
OUT = ROOT / "worker/public/logo"
PNG_WIDTH = 2000

COLOURS = {
    "light-bg": {"ink": "#1b1a19", "muted": "#5d5852", "red": "#a21e16", "ochre": "#b96716"},
    "dark-bg": {"ink": "#ece8e2", "muted": "#a9a29a", "red": "#e86f63", "ochre": "#e3a35d"},
    "black": dict.fromkeys(("ink", "muted", "red", "ochre"), "#000000"),
    "white": dict.fromkeys(("ink", "muted", "red", "ochre"), "#ffffff"),
}


def font_data() -> bytes:
    font = TTFont(FONT)
    font.flavor = None
    buf = BytesIO()
    font.save(buf)
    return buf.getvalue()


class Setter:
    """Shapes text with HarfBuzz (for kerning) and draws it with a static instance of the variable font."""

    def __init__(self, data: bytes, weight: int):
        self.hb_font = hb.Font(hb.Face(data))
        self.hb_font.set_variations({"wght": weight})
        self.upem = self.hb_font.face.upem
        self.static = instantiateVariableFont(TTFont(BytesIO(data)), {"wght": weight})
        self.glyphs = self.static.getGlyphSet()
        self.names = self.static.getGlyphOrder()

    def shape(self, text: str):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf)
        return [(self.names[i.codepoint], p.x_advance, p.x_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

    def path(self, glyphs, x: float, y: float, size: float, gap: float = 0.0) -> str:
        """Path data for shaped glyphs starting at (x, y) baseline; `gap` is extra space after each glyph in px."""
        scale = size / self.upem
        pen = SVGPathPen(self.glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        for name, advance, offset in glyphs:
            self.glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + offset * scale, y)))
            x += advance * scale + gap
        return pen.getCommands()

    def width(self, glyphs, size: float, gap: float = 0.0) -> float:
        return sum(a for _, a, _ in glyphs) * size / self.upem + gap * len(glyphs)


def lettering(bold: Setter, regular: Setter, end_x: float, y: float, size: float) -> str:
    """'EELS' 800 + 'db' 400, right-aligned at end_x, tracked -0.01em as in the live logo."""
    gap = -0.01 * size
    eels, db = bold.shape("EELS"), regular.shape("db")
    x = end_x - bold.width(eels, size, gap) - regular.width(db, size, gap)
    return bold.path(eels, x, y, size, gap) + regular.path(db, x + bold.width(eels, size, gap), y, size, gap)


def tagline(regular: Setter, x: float, y: float, size: float, length: float) -> str:
    glyphs = regular.shape("Inner & Outer Shell Excitation Spectrum Repository")
    gap = (length - regular.width(glyphs, size)) / (len(glyphs) - 1)
    return regular.path(glyphs, x, y, size, gap)


def traces_from_logo_ts() -> tuple[str, str]:
    src = (ROOT / "worker/src/pages/logo.ts").read_text()
    return re.search(r'const RED = "([^"]+)"', src)[1], re.search(r'const OCHRE = "([^"]+)"', src)[1]


def svg(view_box: str, parts: list[tuple[str, str, bool]], c: dict[str, str]) -> str:
    """parts are (colour key, path data, stroked)."""
    body = "".join(
        f'<path fill="none" stroke="{c[k]}" stroke-width="2" d="{d}"/>' if stroked else f'<path fill="{c[k]}" d="{d}"/>'
        for k, d, stroked in parts
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"><title>EELSdb</title>{body}</svg>\n'


def write(name: str, content: str, width: int = PNG_WIDTH) -> None:
    (OUT / f"{name}.svg").write_text(content)
    (OUT / f"{name}.png").write_bytes(bytes(resvg_py.svg_to_bytes(svg_string=content, width=width)))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    data = font_data()
    bold, regular = Setter(data, 800), Setter(data, 400)
    red, ochre = traces_from_logo_ts()
    squeeze = lambda d: re.sub(r"\s+", " ", d)
    red, ochre = squeeze(red), squeeze(ochre)

    # Geometry matches HERO_LOGO_SVG and LOGO_SVG in logo.ts.
    full = [
        ("ink", lettering(bold, regular, 447.24, 143, 63.28), False),
        ("muted", tagline(regular, 8.97, 175.56, 18.36, 438.26), False),
        ("red", red, True),
        ("ochre", ochre, True),
    ]
    compact = [
        ("ink", lettering(bold, regular, 524.91, 114.2, 90.53), False),
        ("red", red + "h77.67", True),
        ("ochre", ochre + "h77.67", True),
    ]
    for variant, c in COLOURS.items():
        write(f"eelsdb-logo-{variant}", svg("6.97 7.4 442.26 173.23", full, c))
        write(f"eelsdb-logo-compact-{variant}", svg("6.97 7.4 519.94 149.8", compact, c))
    write("eelsdb-mark", (ROOT / "worker/public/favicon.svg").read_text(), width=1024)


if __name__ == "__main__":
    main()
