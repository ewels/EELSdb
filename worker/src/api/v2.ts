// API v2: numbers as numbers with units in the names, provenance for acquisition values, a structured
// reference, total counts and paging links. The schemas in v2-schema.ts validate requests and generate the OpenAPI file.
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { variantUnits } from "../submit/form";
import { API_HOST, SITE, loadMany, type SpectrumBundle } from "./format";
import { DOCUMENT, ListQuery, listRoute, oneRoute, type Spectrum } from "./v2-schema";
import type { z } from "@hono/zod-openapi";

type C = Context<AppEnv>;
type Row = Record<string, any>;

export const API_REFERENCE = `${SITE}/docs/api/v2/`;

const error = <S extends 400 | 404>(c: C, status: S, code: string, message: string) => c.json({ error: { code, message } }, status);

export const v2 = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (result.success) return;
    const issue = result.error.issues[0];
    if (issue.code === "unrecognized_keys") {
      return error(c, 400, "unknown_parameter", `Unknown query parameter '${issue.keys[0]}'. See ${API_REFERENCE}.`);
    }
    const name = issue.path.length ? `'${String(issue.path[0])}' ` : "";
    return error(c, 400, "invalid_parameter", `${name}${issue.message}`.trim());
  },
});

export const openapiV2 = () => v2.getOpenAPI31Document(DOCUMENT);

const SORT_SQL: Record<string, string> = {
  formula: "s.formula COLLATE NOCASE",
  title: "s.title COLLATE NOCASE",
  published_at: "s.published_at",
  min_energy_ev: "s.min_energy_ev",
  max_energy_ev: "s.max_energy_ev",
  beam_energy_kv: "a.beam_energy_kv",
  resolution_ev: "a.resolution_ev",
  author: "s.author_display COLLATE NOCASE",
  id: "s.id",
};

/** The FROM/WHERE clause and ORDER BY for a list query; the browse page shares it, so it filters as the API does. */
export function spectraFilter(q: z.infer<typeof ListQuery>) {
  const where = ["s.status = 'published'"];
  const binds: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    binds.push(...values);
  };

  // Gas-phase spectra are only listed when asked for, as in v1.
  add(q.phase ? "s.phase = ?" : "s.phase != 'gas'", ...(q.phase ? [q.phase] : []));
  if (q.type?.length) add(`s.type IN (${q.type.map(() => "?").join(",")})`, ...q.type);
  if (q.technique) add("s.technique = ?", q.technique);
  for (const el of q.element ?? []) add("EXISTS (SELECT 1 FROM spectrum_elements e WHERE e.spectrum_id = s.id AND e.element = ?)", el);
  for (const edge of q.edge ?? []) {
    const [element, name] = edge.includes("_") ? edge.split("_", 2) : [null, edge];
    add(
      `EXISTS (SELECT 1 FROM spectrum_edges g WHERE g.spectrum_id = s.id AND g.edge = ?${element ? " AND g.element = ?" : ""})`,
      ...(element ? [name, element] : [name]),
    );
  }
  for (const k of q.keyword ?? []) add("EXISTS (SELECT 1 FROM spectrum_keywords k WHERE k.spectrum_id = s.id AND k.keyword = ? COLLATE NOCASE)", k.trim());
  if (q.formula) add("s.formula LIKE ? ESCAPE '\\'", like(q.formula));
  if (q.q) add("(s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')", like(q.q), like(q.q));
  if (q.author?.length) {
    add(`(${q.author.map(() => "s.author_display LIKE ? ESCAPE '\\' OR s.author_slug = ?").join(" OR ")})`, ...q.author.flatMap((a) => [like(a.trim()), a.trim()]));
  }
  if (q.complete) add("s.completeness = 'full'");
  if (q.monochromated) add("a.monochromated = ?", q.monochromated === "true" ? 1 : 0);
  if (q.min_energy_ev !== undefined) add("s.min_energy_ev >= ?", q.min_energy_ev);
  if (q.max_energy_ev !== undefined) add("s.max_energy_ev <= ?", q.max_energy_ev);
  if (q.covers_ev !== undefined) add("s.min_energy_ev <= ? AND s.max_energy_ev >= ?", q.covers_ev, q.covers_ev);
  if (q.beam_energy_kv !== undefined) add("a.beam_energy_kv = ?", q.beam_energy_kv);
  if (q.max_resolution_ev !== undefined) add("a.resolution_ev <= ?", q.max_resolution_ev);

  const sort = SORT_SQL[q.sort];
  return {
    from: "FROM spectra s LEFT JOIN eels_acquisition a ON a.spectrum_id = s.id WHERE " + where.join(" AND "),
    binds,
    orderBy: `${sort} IS NULL, ${sort} ${q.order === "desc" ? "DESC" : "ASC"}, s.id`,
  };
}

/** The total and one page of ids for a list query. */
export async function listSpectra(db: D1Database, q: z.infer<typeof ListQuery>) {
  const { from, binds, orderBy } = spectraFilter(q);
  const [count, ids] = await db.batch<Row>([
    db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds),
    db.prepare(`SELECT s.id ${from} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...binds, q.per_page, (q.page - 1) * q.per_page),
  ]);
  return { total: count.results[0].n as number, ids: ids.results.map((r) => r.id as number) };
}
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const bool = (v: unknown) => (v === null || v === undefined ? null : Boolean(Number(v)));
const like = (s: string) => "%" + s.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%";

// Typed loosely: its keys depend on `unit`. The API v2 tests check the output against the schema.
function measured(value: unknown, source: unknown, uncertainty: unknown, unit: string): any {
  if (source === "unknown" || value === null || value === undefined) return source ? { [`value_${unit}`]: null, source: "unknown" } : null;
  return { [`value_${unit}`]: num(value), source: source ?? null, [`uncertainty_${unit}`]: num(uncertainty) };
}

const fileUrl = (key: string) => `${SITE}/${key.split("/").map(encodeURIComponent).join("/")}`;

export function formatV2(b: SpectrumBundle): z.infer<typeof Spectrum> {
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
      .map((f) => ({
        role: f.role,
        variant: f.variant,
        intensity_units: f.variant ? variantUnits(f.variant) : null,
        url: fileUrl(f.r2_key),
        filename: f.filename,
        bytes: f.bytes,
        sha256: f.sha256,
        media_type: f.media_type,
      })),
    download_url: b.legacyFile ? fileUrl(b.legacyFile) : null,
    processing: b.processing as z.infer<typeof Spectrum>["processing"],
  };
}

v2.openapi(listRoute, async (c) => {
  const q = c.req.valid("query");
  const { page, per_page: perPage } = q;
  const { total, ids } = await listSpectra(c.env.DB, q);
  const link = (n: number) => {
    const next = new URL(`${API_HOST}/v2/spectra`);
    for (const [k, v] of new URL(c.req.url).searchParams) if (k !== "page") next.searchParams.append(k, v);
    next.searchParams.set("page", String(n));
    return next.toString();
  };
  const bundles = await loadMany(c.env.DB, ids);
  return c.json(
    {
      total,
      page,
      per_page: perPage,
      next: page * perPage < total ? link(page + 1) : null,
      previous: page > 1 ? link(page - 1) : null,
      results: bundles.map(formatV2),
    },
    200,
  );
});

v2.openapi(oneRoute, async (c) => {
  const key = c.req.valid("param").id;
  const row = await c.env.DB.prepare(`SELECT id FROM spectra WHERE ${/^\d+$/.test(key) ? "id" : "slug"} = ? AND status = 'published'`)
    .bind(/^\d+$/.test(key) ? Number(key) : key)
    .first<number>("id");
  const [bundle] = row === null ? [] : await loadMany(c.env.DB, [row]);
  return bundle ? c.json(formatV2(bundle), 200) : error(c, 404, "not_found", "No published spectrum with this id or slug.");
});

v2.all("*", (c) => error(c, 404, "not_found", `Unknown path. See ${API_REFERENCE}.`));
