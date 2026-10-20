// API v2: numbers as numbers with units in the names, provenance for acquisition values, a structured
// reference, total counts and paging links. Documented in openapi-v2.json.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth";
import { ELEMENTS } from "../elements";
import { API_HOST, SITE, loadMany, type SpectrumBundle } from "./format";

export const v2 = new Hono<AppEnv>();
type C = Context<AppEnv>;
type Row = Record<string, any>;

const MAX_PER_PAGE = 500;
const SORTS: Record<string, string> = {
  formula: "s.formula COLLATE NOCASE",
  title: "s.title COLLATE NOCASE",
  published_at: "s.published_at",
  min_energy_ev: "s.min_energy_ev",
  max_energy_ev: "s.max_energy_ev",
  beam_energy_kv: "a.beam_energy_kv",
  resolution_ev: "a.resolution_ev",
  id: "s.id",
};
const PARAMS = new Set([
  "type", "technique", "phase", "element", "edge", "formula", "q", "author", "complete", "monochromated",
  "min_energy_ev", "max_energy_ev", "covers_ev", "beam_energy_kv", "sort", "order", "page", "per_page",
]);

const error = (c: C, status: 400 | 404, code: string, message: string) => c.json({ error: { code, message } }, status);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const bool = (v: unknown) => (v === null || v === undefined ? null : Boolean(Number(v)));
const like = (s: string) => "%" + s.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%";

function measured(value: unknown, source: unknown, uncertainty: unknown, unit: string) {
  if (source === "unknown" || value === null || value === undefined) return source ? { [`value_${unit}`]: null, source: "unknown" } : null;
  return { [`value_${unit}`]: num(value), source: source ?? null, [`uncertainty_${unit}`]: num(uncertainty) };
}

const fileUrl = (key: string) => `${SITE}/${key.split("/").map(encodeURIComponent).join("/")}`;

export function formatV2(b: SpectrumBundle) {
  const s = b.spectrum;
  const a = b.acquisition;
  const t = b.treatment;
  const r = b.reference;
  const deconvolutions = t
    ? [
        Number(t.deconv_fourier_log) && "fourier_log",
        Number(t.deconv_fourier_ratio) && "fourier_ratio",
        Number(t.deconv_stephens) && "stephens",
        Number(t.deconv_richardson_lucy) && "richardson_lucy",
        Number(t.deconv_maximum_entropy) && "maximum_entropy",
        t.deconv_other,
      ].filter(Boolean)
    : [];
  return {
    id: s.id,
    slug: s.slug,
    url: `${SITE}/spectra/${encodeURIComponent(s.slug)}/`,
    api_url: `${API_HOST}/v2/spectra/${s.id}`,
    title: s.title,
    type: s.type,
    technique: s.technique,
    phase: s.phase,
    intensity_units: s.intensity_units,
    formula: s.formula,
    elements: b.elements,
    edges: b.edges,
    keywords: b.keywords,
    description: s.description || null,
    source_purity: s.source_purity || null,
    licence: s.licence,
    completeness: s.completeness,
    published_at: s.published_at,
    updated_at: s.updated_at,
    author: { name: s.author_display, profile_url: `${SITE}/author/${s.author_slug}/` },
    energy: { min_ev: num(s.min_energy_ev), max_ev: num(s.max_energy_ev), step_ev: num(s.step_ev) },
    acquisition: a && {
      microscope: a.microscope,
      gun_type: a.gun_type,
      mode: a.acquisition_mode,
      detector: a.detector,
      beam_energy: measured(a.beam_energy_kv, a.beam_energy_source, a.beam_energy_uncertainty, "kv"),
      convergence_angle: measured(a.convergence_mrad, a.convergence_source, a.convergence_uncertainty, "mrad"),
      collection_angle: measured(a.collection_mrad, a.collection_source, a.collection_uncertainty, "mrad"),
      resolution_ev: num(a.resolution_ev),
      monochromated: bool(a.monochromated),
      dispersion_ev: num(a.dispersion_ev),
      probe_size_nm2: num(a.probe_size_nm2),
      beam_current: a.beam_current,
      integration_time_s: num(a.integration_time_s),
      readouts: num(a.readouts),
      instrument_profile: a.instrument_profile_id
        ? { id: a.instrument_profile_id, version: a.instrument_profile_version, url: `${SITE}/instruments/${a.instrument_profile_id}/?version=${a.instrument_profile_version}` }
        : null,
    },
    xas: b.xas && {
      facility: b.xas.facility,
      beamline: b.xas.beamline,
      source_type: b.xas.source_type,
      monochromator: b.xas.monochromator,
      resolving_power: num(b.xas.resolving_power),
      detection_mode: b.xas.detection_mode,
      polarisation: b.xas.polarisation,
      polarisation_angle_deg: num(b.xas.polarisation_angle_deg),
      calibration_reference: b.xas.calibration_reference,
      i0_normalisation: b.xas.i0_normalisation,
    },
    treatment: t && {
      dark_current_corrected: bool(t.dark_current),
      gain_variation_corrected: bool(t.gain_variation),
      calibration: t.calibration,
      thickness: t.thickness_t_lambda === null ? null : { value_t_lambda: num(t.thickness_t_lambda), source: t.thickness_source },
      deconvolutions,
    },
    reference: r && {
      doi: r.doi || null,
      doi_url: r.doi ? `https://doi.org/${r.doi}` : null,
      url: r.url || null,
      authors: r.authors || null,
      title: r.title || null,
      journal: r.journal || null,
      volume: r.volume || null,
      issue: r.issue || null,
      pages: r.page || null,
      year: r.year && /^\d{4}$/.test(r.year) ? Number(r.year) : null,
      freetext: r.freetext || null,
    },
    associated: b.links.map((l) => ({ id: l.id, title: l.title, type: l.type, api_url: `${API_HOST}/v2/spectra/${l.id}` })),
    links: b.otherUrls,
    files: b.files
      .filter((f) => f.role !== "companion")
      .map((f) => ({ role: f.role, url: fileUrl(f.r2_key), filename: f.filename, bytes: f.bytes, sha256: f.sha256, media_type: f.media_type })),
    download_url: b.legacyFile ? fileUrl(b.legacyFile) : null,
    processing: b.processing,
  };
}

v2.get("/spectra", async (c) => {
  const url = new URL(c.req.url);
  const p = url.searchParams;
  for (const key of p.keys()) {
    if (!PARAMS.has(key)) return error(c, 400, "unknown_parameter", `Unknown query parameter '${key}'. See ${SITE}/api/v2/.`);
  }
  const where = ["s.status = 'published'"];
  const binds: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    binds.push(...values);
  };
  const number = (key: string) => {
    const v = p.get(key);
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`'${key}' must be a number.`);
    return n;
  };

  try {
    // Gas-phase spectra are only listed when asked for, as in v1.
    if (p.get("phase")) add("s.phase = ?", p.get("phase"));
    for (const [key, col] of [["type", "s.type"], ["technique", "s.technique"]] as const) if (p.get(key)) add(`${col} = ?`, p.get(key));
    for (const el of p.getAll("element")) {
      if (!ELEMENTS.has(el)) throw new Error(`'${el}' is not an element symbol.`);
      add("EXISTS (SELECT 1 FROM spectrum_elements e WHERE e.spectrum_id = s.id AND e.element = ?)", el);
    }
    for (const edge of p.getAll("edge")) {
      const [element, name] = edge.includes("_") ? edge.split("_", 2) : [null, edge];
      add(
        `EXISTS (SELECT 1 FROM spectrum_edges g WHERE g.spectrum_id = s.id AND g.edge = ?${element ? " AND g.element = ?" : ""})`,
        ...(element ? [name, element] : [name]),
      );
    }
    if (p.get("formula")) add("s.formula LIKE ? ESCAPE '\\'", like(p.get("formula")!));
    if (p.get("q")) add("(s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')", like(p.get("q")!), like(p.get("q")!));
    if (p.get("author")) add("(s.author_display LIKE ? ESCAPE '\\' OR s.author_slug = ?)", like(p.get("author")!), p.get("author"));
    if (p.get("complete") === "true") add("s.completeness = 'full'");
    if (p.get("monochromated") !== null) add("a.monochromated = ?", p.get("monochromated") === "true" ? 1 : 0);
    const minE = number("min_energy_ev");
    if (minE !== null) add("s.min_energy_ev >= ?", minE);
    const maxE = number("max_energy_ev");
    if (maxE !== null) add("s.max_energy_ev <= ?", maxE);
    const covers = number("covers_ev");
    if (covers !== null) add("s.min_energy_ev <= ? AND s.max_energy_ev >= ?", covers, covers);
    const kv = number("beam_energy_kv");
    if (kv !== null) add("a.beam_energy_kv = ?", kv);
  } catch (e) {
    return error(c, 400, "invalid_parameter", (e as Error).message);
  }
  if (!p.get("phase")) where.push("s.phase != 'gas'");

  const sortKey = p.get("sort") ?? "formula";
  if (!SORTS[sortKey]) return error(c, 400, "invalid_parameter", `'sort' must be one of ${Object.keys(SORTS).join(", ")}.`);
  const dir = p.get("order") === "desc" ? "DESC" : "ASC";
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(Number(p.get("per_page") ?? 50)) || 50));
  const page = Math.max(1, Math.trunc(Number(p.get("page") ?? 1)) || 1);

  const from = "FROM spectra s LEFT JOIN eels_acquisition a ON a.spectrum_id = s.id WHERE " + where.join(" AND ");
  const [count, ids] = await c.env.DB.batch<Row>([
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds),
    c.env.DB.prepare(`SELECT s.id ${from} ORDER BY ${SORTS[sortKey]} IS NULL, ${SORTS[sortKey]} ${dir}, s.id LIMIT ? OFFSET ?`)
      .bind(...binds, perPage, (page - 1) * perPage),
  ]);
  const total = count.results[0].n as number;
  const link = (n: number) => {
    const next = new URL(`${API_HOST}/v2/spectra`);
    for (const [k, v] of p) if (k !== "page") next.searchParams.append(k, v);
    next.searchParams.set("page", String(n));
    return next.toString();
  };
  const bundles = await loadMany(c.env.DB, ids.results.map((r) => r.id));
  return c.json({
    total,
    page,
    per_page: perPage,
    next: page * perPage < total ? link(page + 1) : null,
    previous: page > 1 ? link(page - 1) : null,
    results: bundles.map(formatV2),
  });
});

v2.get("/spectra/:id", async (c) => {
  const key = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT id FROM spectra WHERE ${/^\d+$/.test(key) ? "id" : "slug"} = ? AND status = 'published'`)
    .bind(/^\d+$/.test(key) ? Number(key) : key)
    .first<number>("id");
  const [bundle] = row === null ? [] : await loadMany(c.env.DB, [row]);
  return bundle ? c.json(formatV2(bundle)) : error(c, 404, "not_found", "No published spectrum with this id or slug.");
});

v2.all("*", (c) => error(c, 404, "not_found", `Unknown path. See ${SITE}/api/v2/.`));
