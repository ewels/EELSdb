// Translates v1 `/spectra/` query parameters into SQL with the old WordPress semantics,
// except for the deliberate changes listed in data/fixtures/api-v1/EXPECTED_DIFFS.md.

export const KNOWN_ARGS = [
  "type", "title", "author", "element", "formula", "edge",
  "min_energy", "min_energy_compare", "max_energy", "max_energy_compare",
  "resolution", "resolution_compare", "monochromated", "per_page", "page", "order", "order_direction",
  "phase",
];

// Old `order` keys (WordPress meta keys) → SQL sort expression, and whether WordPress sorted it as a number.
const ORDER_KEYS: Record<string, [string, boolean]> = {
  spectrumType: ["s.type", false],
  spectrumMin: ["s.min_energy_ev", true],
  spectrumMax: ["s.max_energy_ev", true],
  stepSize: ["s.step_ev", true],
  spectrumFormula: ["s.formula", false],
  spectrumElement: ["(SELECT element FROM spectrum_elements WHERE spectrum_id = s.id ORDER BY position LIMIT 1)", false],
  spectrumUpload: ["(SELECT r2_key FROM files WHERE spectrum_id = s.id AND role = 'legacy')", false],
  source_purity: ["s.source_purity", false],
  spectrumEdges: ["(SELECT element || '_' || edge FROM spectrum_edges WHERE spectrum_id = s.id ORDER BY position LIMIT 1)", false],
  microscope: ["a.microscope", false],
  guntype: ["a.gun_type", false],
  beamenergy: ["a.beam_energy_kv", true],
  resolution: ["a.resolution_ev", true],
  monochromated: ["a.monochromated", false],
  acquisition_mode: ["a.acquisition_mode", false],
  convergence: ["a.convergence_mrad", true],
  collection: ["a.collection_mrad", true],
  probesize: ["a.probe_size_nm2", true],
  beamcurrent: ["CAST(a.beam_current AS REAL)", true],
  integratetime: ["a.integration_time_s", true],
  readouts: ["a.readouts", true],
  detector: ["a.detector", false],
  darkcurrent: ["t.dark_current", false],
  gainvariation: ["t.gain_variation", false],
  calibration: ["t.calibration", false],
  zeroloss_deconv: ["t.zeroloss_deconv", false],
  thickness: ["t.thickness_t_lambda", true],
  deconv_fourier_log: ["t.deconv_fourier_log", false],
  deconv_fourier_ratio: ["t.deconv_fourier_ratio", true],
  deconv_stephens_deconvolution: ["t.deconv_stephens", false],
  deconv_richardson_lucy: ["t.deconv_richardson_lucy", false],
  deconv_maximum_entropy: ["t.deconv_maximum_entropy", false],
  deconv_other: ["t.deconv_other", false],
  assoc_spectra: ["(SELECT related_id FROM spectrum_links WHERE spectrum_id = s.id ORDER BY position LIMIT 1)", false],
  ref_freetext: ["r.freetext", false],
  ref_doi: ["r.doi", false],
  ref_url: ["r.url", false],
  ref_authors: ["r.authors", false],
  ref_journal: ["r.journal", false],
  ref_volume: ["r.volume", false],
  ref_issue: ["r.issue", false],
  ref_page: ["r.page", false],
  ref_year: ["CAST(r.year AS INTEGER)", true],
  ref_title: ["r.title", false],
  otherURLs: ["(SELECT url FROM spectrum_other_urls WHERE spectrum_id = s.id ORDER BY position LIMIT 1)", false],
  title: ["s.title", false],
  author: ["s.author_display", false],
  date: ["s.published_at", false],
};

// WordPress left out posts without the meta row being sorted on. For these keys v1 shows "Yes"/"No"
// whenever the row exists, so the typed column is NULL exactly when the row was missing.
const ROW_PRESENCE_KEYS = new Set(["monochromated", "darkcurrent", "gainvariation"]);

export const ORDER_META_KEYS = Object.keys(ORDER_KEYS).filter((k) => !["title", "author", "date"].includes(k));

// Single letters and these words are dropped from title searches, as WordPress did.
const STOPWORDS = new Set(
  "about an are as at be by com for from how in is it of on or that the this to was what when where who will with www".split(" "),
);

export type Params = Map<string, string | string[]>;

/** Parse a query string the way PHP filled $_GET: `a[]=x&a[]=y` → array, otherwise last value wins. */
export function parseParams(search: string): Params {
  const out: Params = new Map();
  for (const [rawKey, value] of new URLSearchParams(search)) {
    if (rawKey.endsWith("[]")) {
      const key = rawKey.slice(0, -2);
      const prev = out.get(key);
      out.set(key, Array.isArray(prev) ? [...prev, value] : [value]);
    } else {
      out.set(rawKey, value);
    }
  }
  return out;
}

export function firstUnknownArg(params: Params): string | undefined {
  for (const key of params.keys()) if (!KNOWN_ARGS.includes(key)) return key;
}

function str(params: Params, key: string): string | undefined {
  const v = params.get(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const isNumeric = (v: string | undefined): v is string => v !== undefined && v.trim() !== "" && Number.isFinite(Number(v));

function likeEscape(s: string) {
  return "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

/** `gt` → ≥, `eq` → =, `ge` → ≥ (deliberate fix), anything else → ≤. */
export function compareOp(v: string | undefined) {
  if (v === "gt" || v === "ge") return ">=";
  if (v === "eq") return "=";
  return "<=";
}

export function searchTerms(q: string): string[] {
  const terms = q.match(/"[^"]*("|$)|[^\t ",+]+/g) ?? [];
  return terms
    .map((t) => t.replace(/^"|"$/g, "").trim())
    .filter((t) => t && !(t.length === 1 && /^[a-z-]$/i.test(t)) && !STOPWORDS.has(t.toLowerCase()));
}

export type SpectraQuery = {
  sql: string;
  binds: unknown[];
  sortKey: string;
  numeric: boolean;
  desc: boolean;
  perPage: number;
  page: number;
};

/** `exact` compares energies and resolution as stored (the website); v1 keeps WordPress's whole-eV casts. */
export function buildSpectraQuery(params: Params, opts: { exact?: boolean; complete?: boolean } = {}): SpectraQuery {
  const where = ["s.status = 'published'"];
  if (opts.complete) where.push("s.completeness = 'full'");
  const binds: unknown[] = [];

  // Spectra of new kinds (gas phase) are only listed when asked for, so old queries return what they did.
  const phase = str(params, "phase");
  if (phase) {
    where.push("s.phase = ?");
    binds.push(phase);
  } else {
    where.push("s.phase != 'gas'");
  }

  const type = str(params, "type");
  if (type) {
    where.push("s.type = ?");
    binds.push(type);
  }

  const title = str(params, "title");
  if (title) {
    for (const term of searchTerms(title)) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')");
      binds.push(likeEscape(term), likeEscape(term));
    }
  }

  const author = str(params, "author");
  if (author) {
    const terms = author.split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length) {
      where.push("(" + terms.map(() => "s.author_display LIKE ? ESCAPE '\\' OR s.author_slug LIKE ? ESCAPE '\\'").join(" OR ") + ")");
      for (const t of terms) binds.push(likeEscape(t), likeEscape(t));
    }
  }

  const element = params.get("element");
  const elements = (Array.isArray(element) ? element : element ? [element] : []).filter((e) => e.length > 0);
  for (const el of elements) {
    where.push("EXISTS (SELECT 1 FROM spectrum_elements e WHERE e.spectrum_id = s.id AND e.element = ? COLLATE NOCASE)");
    binds.push(el);
  }

  const formula = str(params, "formula");
  if (formula) {
    where.push("s.formula LIKE ? ESCAPE '\\'");
    binds.push(likeEscape(formula));
  }

  const edge = str(params, "edge");
  if (edge) {
    where.push("EXISTS (SELECT 1 FROM spectrum_edges g WHERE g.spectrum_id = s.id AND g.edge = ? COLLATE NOCASE)");
    binds.push(edge);
  }

  // WordPress compared the stored strings after CAST(... AS DECIMAL), which rounds energies to whole eV,
  // and CAST(... AS SIGNED), which truncates resolutions to whole eV.
  const ranges: [string, string][] = opts.exact
    ? [["min_energy", "s.min_energy_ev"], ["max_energy", "s.max_energy_ev"], ["resolution", "a.resolution_ev"]]
    : [
        ["min_energy", "ROUND(COALESCE(s.min_energy_ev, 0))"],
        ["max_energy", "ROUND(COALESCE(s.max_energy_ev, 0))"],
        ["resolution", "CAST(COALESCE(a.resolution_ev, 0) AS INTEGER)"],
      ];
  for (const [key, expr] of ranges) {
    const v = str(params, key);
    if (v === undefined) continue;
    where.push(`${expr} ${compareOp(str(params, `${key}_compare`))} ?`);
    binds.push(Number.isFinite(Number(v)) ? Number(v) : 0);
  }

  const mono = str(params, "monochromated");
  if (mono === "1" || mono === "0") {
    where.push("a.monochromated = ?");
    binds.push(Number(mono));
  }

  const orderKey = str(params, "order");
  const key = orderKey && ORDER_KEYS[orderKey] ? orderKey : "spectrumFormula";
  const [sortExpr, numeric] = ORDER_KEYS[key];
  if (ROW_PRESENCE_KEYS.has(key)) where.push(`${sortExpr} IS NOT NULL`);
  const sql =
    `SELECT s.id, s.legacy_v1, s.legacy_rank, ${sortExpr} AS sort_value, s.slug, s.title, s.type, s.formula, ` +
    "s.min_energy_ev, s.max_energy_ev, s.author_display, s.author_slug, s.published_at, " +
    "a.beam_energy_kv, a.resolution_ev, a.monochromated, a.microscope FROM spectra s " +
    "LEFT JOIN eels_acquisition a ON a.spectrum_id = s.id " +
    "LEFT JOIN treatment t ON t.spectrum_id = s.id " +
    "LEFT JOIN reference r ON r.spectrum_id = s.id " +
    `WHERE ${where.join(" AND ")}`;

  const perPageRaw = str(params, "per_page");
  const pageRaw = str(params, "page");
  return {
    sql,
    binds,
    sortKey: key,
    numeric,
    desc: params.get("order_direction") === "DESC",
    perPage: isNumeric(perPageRaw) ? Math.trunc(Number(perPageRaw)) : 50,
    page: isNumeric(pageRaw) ? Math.max(1, Math.trunc(Number(pageRaw))) : 1,
  };
}

export type SpectrumRow = {
  id: number;
  legacy_v1: string | null;
  legacy_rank: number | null;
  sort_value: unknown;
  slug: string;
  title: string;
  type: string;
  formula: string | null;
  min_energy_ev: number | null;
  max_energy_ev: number | null;
  author_display: string;
  author_slug: string;
  published_at: string | null;
  beam_energy_kv: number | null;
  resolution_ev: number | null;
  monochromated: number | null;
  microscope: string | null;
};

// Close to MySQL's utf8mb4_unicode_ci, which the live site sorted with (punctuation order, case-insensitive).
const collator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * Sort and paginate like WordPress: a missing value sorts as '' or 0; ties keep the live site's
 * default order for formula sorts and post ID order otherwise, in both directions.
 */
export function sortAndPage(rows: SpectrumRow[], q: SpectraQuery): SpectrumRow[] {
  const value = (r: SpectrumRow) => (q.numeric ? Number(r.sort_value ?? 0) || 0 : String(r.sort_value ?? ""));
  const tie = (a: SpectrumRow, b: SpectrumRow) =>
    q.sortKey === "spectrumFormula"
      ? (a.legacy_rank ?? Infinity) - (b.legacy_rank ?? Infinity) || a.id - b.id
      : a.id - b.id;
  const sorted = [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    const c = q.numeric ? (va as number) - (vb as number) : collator.compare(va as string, vb as string);
    return (q.desc ? -c : c) || tie(a, b);
  });
  return q.perPage > 0 ? sorted.slice((q.page - 1) * q.perPage, q.page * q.perPage) : sorted;
}
