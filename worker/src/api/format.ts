// Formats a spectrum from its typed rows into a v1 API object, following the old api_spectra.php.
// Migrated spectra are served from `legacy_v1` instead; this is for spectra added after migration.

import { API_HOST, SITE } from "../site";

export { API_HOST, SITE };

export const TYPE_LABELS: Record<string, string> = {
  coreloss: "Core Loss",
  lowloss: "Low Loss",
  zeroloss: "Zero Loss",
  xrayabs: "X Ray Abs",
};

type Row = Record<string, any>;

export type SpectrumBundle = {
  spectrum: Row;
  acquisition: Row | null;
  xas: Row | null;
  treatment: Row | null;
  reference: Row | null;
  elements: string[];
  edges: { element: string; edge: string }[];
  keywords: string[];
  links: { id: number; title: string; slug: string; type: string }[];
  otherUrls: { url: string; title: string | null }[];
  /** The public download: the legacy file, else the reviewed MSA (exSpy reads only .msa), else the upload. */
  legacyFile: string | null;
  files: Row[];
  processing: Row[];
};

const DOWNLOAD_ORDER = ["legacy", "msa", "original"];

const D1_MAX_PARAMS = 100;

/** Every row for several spectra in a fixed number of queries per 100 spectra, in the order of `ids`. */
export async function loadMany(db: D1Database, ids: number[]): Promise<SpectrumBundle[]> {
  if (ids.length > D1_MAX_PARAMS) {
    const out: SpectrumBundle[] = [];
    for (let i = 0; i < ids.length; i += D1_MAX_PARAMS) out.push(...(await loadMany(db, ids.slice(i, i + D1_MAX_PARAMS))));
    return out;
  }
  if (!ids.length) return [];
  const list = ids.map(() => "?").join(",");
  const q = (sql: string) => db.prepare(sql.replace("(?)", `(${list})`)).bind(...ids);
  const [s, a, x, t, r, el, ed, kw, ln, ou, f, p] = await db.batch<Row>([
    q("SELECT * FROM spectra WHERE id IN (?)"),
    q("SELECT * FROM eels_acquisition WHERE spectrum_id IN (?)"),
    q("SELECT * FROM xas_acquisition WHERE spectrum_id IN (?)"),
    q("SELECT * FROM treatment WHERE spectrum_id IN (?)"),
    q("SELECT * FROM reference WHERE spectrum_id IN (?)"),
    q("SELECT spectrum_id, element FROM spectrum_elements WHERE spectrum_id IN (?) ORDER BY position"),
    q("SELECT spectrum_id, element, edge FROM spectrum_edges WHERE spectrum_id IN (?) ORDER BY position"),
    q("SELECT spectrum_id, keyword FROM spectrum_keywords WHERE spectrum_id IN (?) ORDER BY position"),
    q(`SELECT l.spectrum_id, r.id, r.title, r.slug, r.type FROM spectrum_links l JOIN spectra r ON r.id = l.related_id
       WHERE l.spectrum_id IN (?) AND r.status = 'published' ORDER BY l.position`),
    q("SELECT spectrum_id, url, title FROM spectrum_other_urls WHERE spectrum_id IN (?) ORDER BY position"),
    q("SELECT * FROM files WHERE spectrum_id IN (?) ORDER BY id"),
    q("SELECT spectrum_id, tool, version, run_at FROM processing WHERE spectrum_id IN (?) ORDER BY rowid"),
  ]);
  const one = (res: D1Result<Row>) => new Map(res.results.map((row) => [row.spectrum_id ?? row.id, row]));
  const many = (res: D1Result<Row>) => {
    const out = new Map<number, Row[]>();
    for (const row of res.results) out.set(row.spectrum_id, [...(out.get(row.spectrum_id) ?? []), row]);
    return out;
  };
  const [spectra, acq, xas, treat, ref] = [s, a, x, t, r].map(one);
  const [els, eds, kws, lns, ous, fs, ps] = [el, ed, kw, ln, ou, f, p].map(many);
  const strip = ({ spectrum_id, ...rest }: Row) => rest;
  return ids
    .filter((id) => spectra.has(id))
    .map((id) => {
      const files = fs.get(id) ?? [];
      const download = DOWNLOAD_ORDER.map((role) => files.find((file) => file.role === role)).find(Boolean);
      return {
        spectrum: spectra.get(id)!,
        acquisition: acq.get(id) ?? null,
        xas: xas.get(id) ?? null,
        treatment: treat.get(id) ?? null,
        reference: ref.get(id) ?? null,
        elements: (els.get(id) ?? []).map((e) => e.element),
        edges: (eds.get(id) ?? []).map((e) => ({ element: e.element, edge: e.edge })),
        keywords: (kws.get(id) ?? []).map((k) => k.keyword),
        links: (lns.get(id) ?? []).map(strip) as SpectrumBundle["links"],
        otherUrls: (ous.get(id) ?? []).map(strip) as SpectrumBundle["otherUrls"],
        legacyFile: download?.r2_key ?? null,
        files,
        processing: (ps.get(id) ?? []).map(strip),
      };
    });
}

export async function loadBundle(db: D1Database, id: number): Promise<SpectrumBundle | null> {
  return (await loadMany(db, [id]))[0] ?? null;
}

/** Slug as WordPress printed it in URLs: percent-encoded, lower-case hex. */
export const urlSlug = (slug: string) => encodeURIComponent(slug).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

/** WordPress printed " - " in titles as an en dash entity (wptexturize). */
const texturize = (title: string) => title.replaceAll(" - ", " &#8211; ");

/** PHP's st_isset: set and non-empty. */
const present = (v: unknown): boolean => v !== null && v !== undefined && String(v).length > 0;
/** PHP's nm_isset: numeric and non-zero. */
const nonZero = (v: unknown): v is number | string => present(v) && Number.isFinite(Number(v)) && Number(v) !== 0;
const yesNo = (v: unknown) => (Number(v) ? "Yes" : "No");
const round2 = (x: number) => String(Math.round(x * 100) / 100);

export function formatV1(b: SpectrumBundle): Row {
  const s = b.spectrum;
  const a = b.acquisition ?? {};
  const t = b.treatment ?? {};
  const authorUrl = `${SITE}/author/${s.author_slug}/`;
  const out: Row = {
    id: s.id,
    title: texturize(s.title),
    permalink: `${SITE}/spectra/${urlSlug(s.slug)}/`,
    author: {
      name: s.author_display,
      profile_url: authorUrl,
      profile_api_url: authorUrl.replace("://", "://api."),
    },
    published: s.published_at,
    description: s.description ?? "",
    comment_count: 0,
    api_permalink: `${API_HOST}/spectra/${urlSlug(s.slug)}/`,
  };
  if (b.keywords.length) out.keywords = b.keywords;
  if (b.legacyFile) out.download_link = `${SITE}/${b.legacyFile}`;
  if (present(s.type)) out.type = TYPE_LABELS[s.type];
  if (present(s.formula)) out.formula = s.formula;
  if (b.elements.length) out.elements = b.elements;
  if (present(a.microscope)) out.microscope = a.microscope;
  if (nonZero(s.max_energy_ev)) out.max_energy = `${round2(Number(s.max_energy_ev))} eV`;
  if (nonZero(s.min_energy_ev)) out.min_energy = `${round2(Number(s.min_energy_ev))} eV`;
  if (present(s.source_purity)) out.source_purity = s.source_purity;
  if (b.edges.length) out.edges = b.edges.map((e) => `${e.element}_${e.edge}`);
  if (present(a.gun_type)) out.guntype = a.gun_type;
  if (nonZero(a.beam_energy_kv)) out.beamenergy = `${a.beam_energy_kv} kV`;
  if (nonZero(a.resolution_ev)) out.resolution = `${a.resolution_ev} eV`;
  if (present(a.monochromated)) out.monochromated = yesNo(a.monochromated);
  if (nonZero(s.step_ev)) out.stepSize = `${s.step_ev} eV/pixel`;
  if (present(a.acquisition_mode)) out.acquisition_mode = a.acquisition_mode;
  if (nonZero(a.convergence_mrad)) out.convergence = `${a.convergence_mrad} mrad`;
  if (nonZero(a.collection_mrad)) out.collection = `${a.collection_mrad} mrad`;
  if (nonZero(a.probe_size_nm2)) out.probesize = `${a.probe_size_nm2} nm^2`;
  if (nonZero(a.beam_current)) out.beamcurrent = a.beam_current;
  if (nonZero(a.integration_time_s)) out.integratetime = `${a.integration_time_s} secs`;
  if (nonZero(a.readouts)) out.readouts = String(a.readouts);
  if (present(a.detector)) out.detector = a.detector;
  if (present(t.dark_current)) out.darkcurrent = yesNo(t.dark_current);
  if (present(t.gain_variation)) out.gainvariation = yesNo(t.gain_variation);
  if (present(t.calibration)) out.calibration = t.calibration;
  if (nonZero(t.thickness_t_lambda)) out.thickness = `${t.thickness_t_lambda} t/&lambda;`;

  const deconv: string[] = [];
  if (Number(t.deconv_fourier_log)) deconv.push("Fourier-log");
  if (Number(t.deconv_fourier_ratio)) deconv.push("Fourier-ratio");
  if (Number(t.deconv_stephens)) deconv.push("Stephen's deconvolution");
  if (Number(t.deconv_richardson_lucy)) deconv.push("Richardson-Lucy");
  if (Number(t.deconv_maximum_entropy)) deconv.push("Maximum-Entropy");
  if (present(t.deconv_other)) deconv.push(...String(t.deconv_other).split("\n"));
  if (deconv.length) out.deconvolutions = deconv;

  if (b.reference) {
    const ref: Row = {};
    for (const k of ["freetext", "authors", "year", "journal", "title", "volume", "issue", "page", "doi", "url"]) {
      if (present(b.reference[k])) ref[k] = b.reference[k];
    }
    if (Object.keys(ref).length) out.reference = ref;
  }
  if (b.links.length) {
    out.associated_spectra = b.links.map((l) => ({
      name: texturize(l.title),
      link: `${SITE}/spectra/${urlSlug(l.slug)}/`,
      type: TYPE_LABELS[l.type],
    }));
  }
  if (b.otherUrls.length) {
    out.other_links = b.otherUrls.map((u) => (u.title ? { url: u.url, title: u.title } : { url: u.url }));
  }
  return out;
}
