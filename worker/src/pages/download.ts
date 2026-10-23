// A spectrum's data in other formats, converted on request from its stored MSA or two-column text file.
import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { loadBundle, type SpectrumBundle } from "../api/format";
import { licenceOf } from "../api/metadata";
import { formatV2 } from "../api/v2";
import { attachment } from "../files";
import { parseSpectrum } from "../preview";
import { visibleSpectrumId } from "./spectrum";

export const FORMATS = ["msa", "csv", "json"] as const;
const TYPES = { msa: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", json: "application/json" };

const UNITS: Record<string, string> = { counts: "counts", oscillator_strength: "oscillator strength", mu: "mu", optical_density: "optical density", normalised: "normalised" };

/** EMSA/MAS 1.0 as XY, so non-uniform energy axes stay exact, with the EELS header fields that are known. */
export function toMsa(b: SpectrumBundle, x: number[], y: number[]) {
  const s = b.spectrum;
  const a = b.acquisition ?? {};
  const step = x.length > 1 ? (x.at(-1)! - x[0]) / (x.length - 1) : 1;
  const lines = [
    "#FORMAT      : EMSA/MAS Spectral Data File",
    "#VERSION     : 1.0",
    `#TITLE       : ${String(s.title).slice(0, 64)}`,
    "#OWNER       : EELS Data Base",
    `#NPOINTS     : ${x.length}`,
    "#NCOLUMNS    : 1",
    "#XUNITS      : eV",
    `#YUNITS      : ${UNITS[s.intensity_units] ?? s.intensity_units}`,
    "#DATATYPE    : XY",
    `#XPERCHAN    : ${+step.toPrecision(8)}`,
    `#OFFSET      : ${x[0]}`,
    ...(s.technique === "eels" ? ["#SIGNALTYPE  : ELS"] : []),
    ...([
      ["BEAMKV   -kV", a.beam_energy_kv],
      ["CONVANGLE-mR", a.convergence_mrad],
      ["COLLANGLE-mR", a.collection_mrad],
    ] as const).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `#${k}: ${v}`),
    `#COMMENT     : https://eelsdb.eu/spectra/${s.slug}/ (${licenceOf(s.licence).short})`,
    "#SPECTRUM    : Spectral Data Starts Here",
    ...x.map((e, i) => `${e}, ${y[i]}`),
    "#ENDOFDATA   :",
  ];
  return lines.join("\r\n") + "\r\n";
}

export const toCsv = (b: SpectrumBundle, x: number[], y: number[]) =>
  [`energy_ev,${b.spectrum.intensity_units}`, ...x.map((e, i) => `${e},${y[i]}`)].join("\n") + "\n";

export const toJson = (b: SpectrumBundle, x: number[], y: number[]) => JSON.stringify({ ...formatV2(b), data: { energy_ev: x, intensity: y } });

export async function downloadSpectrum(c: Context<AppEnv>) {
  const format = c.req.param("format") as (typeof FORMATS)[number];
  const id = await visibleSpectrumId(c, c.req.param("slug")!);
  const b = id === null ? null : await loadBundle(c.env.DB, id);
  const object = b?.legacyFile ? await c.env.FILES.get(b.legacyFile) : null;
  if (!b || !object) return c.notFound();
  const [x, y] = parseSpectrum(await object.text());
  if (x.length < 2) return c.notFound();
  const body = { msa: toMsa, csv: toCsv, json: toJson }[format](b, x, y);
  const name = `${b.spectrum.slug}.${format}`;
  return new Response(body, {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": attachment(name),
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": b.spectrum.status === "published" ? "public, max-age=3600" : "private, no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
