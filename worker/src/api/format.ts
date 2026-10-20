// Formats a spectrum from its typed rows into a v1 API object, following the old api_spectra.php.
// Migrated spectra are served from `legacy_v1` instead; this is for spectra added after migration.

export const SITE = "https://eelsdb.eu";
export const API_HOST = "https://api.eelsdb.eu";

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
  treatment: Row | null;
  reference: Row | null;
  elements: string[];
  edges: { element: string; edge: string }[];
  keywords: string[];
  links: { title: string; slug: string; type: string }[];
  otherUrls: { url: string; title: string | null }[];
  legacyFile: string | null;
};

export async function loadBundle(db: D1Database, id: number): Promise<SpectrumBundle | null> {
  const q = (sql: string) => db.prepare(sql).bind(id);
  const [s, a, t, r, el, ed, kw, ln, ou, f] = await db.batch<Row>([
    q("SELECT * FROM spectra WHERE id = ?"),
    q("SELECT * FROM eels_acquisition WHERE spectrum_id = ?"),
    q("SELECT * FROM treatment WHERE spectrum_id = ?"),
    q("SELECT * FROM reference WHERE spectrum_id = ?"),
    q("SELECT element FROM spectrum_elements WHERE spectrum_id = ? ORDER BY position"),
    q("SELECT element, edge FROM spectrum_edges WHERE spectrum_id = ? ORDER BY position"),
    q("SELECT keyword FROM spectrum_keywords WHERE spectrum_id = ? ORDER BY position"),
    q(`SELECT r.title, r.slug, r.type FROM spectrum_links l JOIN spectra r ON r.id = l.related_id
       WHERE l.spectrum_id = ? AND r.status = 'published' ORDER BY l.position`),
    q("SELECT url, title FROM spectrum_other_urls WHERE spectrum_id = ? ORDER BY position"),
    // The download is the legacy file, else the reviewed MSA (exSpy reads only .msa), else the upload.
    q(`SELECT r2_key FROM files WHERE spectrum_id = ? AND role IN ('legacy', 'msa', 'original')
       ORDER BY CASE role WHEN 'legacy' THEN 0 WHEN 'msa' THEN 1 ELSE 2 END LIMIT 1`),
  ]);
  const spectrum = s.results[0] as Row | undefined;
  if (!spectrum) return null;
  return {
    spectrum,
    acquisition: (a.results[0] as Row) ?? null,
    treatment: (t.results[0] as Row) ?? null,
    reference: (r.results[0] as Row) ?? null,
    elements: el.results.map((x) => x.element),
    edges: ed.results as SpectrumBundle["edges"],
    keywords: kw.results.map((x) => x.keyword),
    links: ln.results as SpectrumBundle["links"],
    otherUrls: ou.results as SpectrumBundle["otherUrls"],
    legacyFile: ((f.results[0] as Row) ?? null)?.r2_key ?? null,
  };
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
