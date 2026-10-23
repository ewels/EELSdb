import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import m400 from "./fonts/mona-sans-400.ttf";
import m500 from "./fonts/mona-sans-500.ttf";
import m600 from "./fonts/mona-sans-600.ttf";
import m700 from "./fonts/mona-sans-700.ttf";
import italic from "./fonts/mona-sans-italic-400.ttf";

const FONTS = [m400, m500, m600, m700, italic].map((f) => new Uint8Array(f));
let ready: Promise<void> | undefined;

export async function svgToPng(svg: string) {
  await (ready ??= initWasm(wasm));
  const resvg = new Resvg(svg, { font: { fontBuffers: FONTS, loadSystemFonts: false, defaultFontFamily: "Mona Sans" } });
  const image = resvg.render();
  const png = image.asPng();
  image.free();
  resvg.free();
  return png;
}
