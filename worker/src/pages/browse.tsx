import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { listSpectra } from "../api/v2";
import { ListQuery } from "../api/v2-schema";
import { majorEdges, previews, type Preview } from "../preview";
import NAMES from "../element-names.json";
import { EdgeName, Formula, Layout, TYPE_NAMES, TypeBadge, fmt } from "./layout";

const PER_PAGE = 50;
const ELEMENT_NAMES: Record<string, string> = NAMES;
const EDGES = ["K", "L1", "L2,3", "M2,3", "M4,5", "N2,3", "N4,5", "O2,3", "O4,5"];
// Filters that may be given more than once; the others take one value.
const REPEATED = new Set(["type", "element", "edge", "author", "keyword"]);

/** Browse filters as API v2 query parameters, one list of values per name. */
type Filters = Map<string, string[]>;

type Shown = {
  id: number;
  slug: string;
  title: string;
  type: string;
  phase: string;
  formula: string | null;
  min_energy_ev: number | null;
  max_energy_ev: number | null;
  author_display: string;
  author_slug: string;
  published_at: string | null;
  beam_energy_kv: number | null;
  resolution_ev: number | null;
  monochromated: number | null;
  edges: string[];
  elements: string[];
  preview?: Preview;
  journal: string | null;
  year: string | null;
};

/**
 * The query string as filters: "element[]" and "title" (older links) are read as "element" and "q", empty values are dropped, and
 * "Sigle, Colliex" in the author box becomes two authors. complete=1 and monochromated=1 (older links) mean true.
 */
function readFilters(search: string): Filters {
  const out: Filters = new Map();
  for (const [rawKey, rawValue] of new URLSearchParams(search)) {
    const key = rawKey === "title" ? "q" : rawKey.replace(/\[\]$/, "");
    const values = key === "author" ? rawValue.split(",") : [(key === "complete" || key === "monochromated") && rawValue === "1" ? "true" : rawValue];
    for (const v of values.map((x) => x.trim()).filter(Boolean)) out.set(key, [...(out.get(key) ?? []), v]);
  }
  return out;
}

const queryInput = (f: Filters) => Object.fromEntries([...f].map(([k, v]) => [k, REPEATED.has(k) ? v : v[0]]));

function urlWith(f: Filters, changes: Record<string, string | null>) {
  const out = new URLSearchParams();
  for (const [k, values] of f) if (!(k in changes)) for (const v of values) out.append(k, v);
  for (const [k, v] of Object.entries(changes)) if (v !== null) out.set(k, v);
  const q = out.toString();
  return `/spectra/${q ? `?${q}` : ""}`;
}

function withoutFilter(f: Filters, key: string, value: string) {
  const copy: Filters = new Map(f);
  const rest = (copy.get(key) ?? []).filter((x) => x !== value);
  if (rest.length) copy.set(key, rest);
  else copy.delete(key);
  return urlWith(copy, { page: null });
}

const one = (f: Filters, key: string) => f.get(key)?.[0] ?? "";

function chipLabel(key: string, v: string) {
  const labels: Record<string, string> = {
    q: `text: ${v}`,
    formula: `formula: ${v}`,
    edge: `edge: ${v}`,
    keyword: `keyword: ${v}`,
    author: `author: ${v}`,
    phase: `phase: ${v}`,
    min_energy_ev: `starts ≥ ${v} eV`,
    max_energy_ev: `ends ≤ ${v} eV`,
    covers_ev: `includes ${v} eV`,
    max_resolution_ev: `resolution ≤ ${v} eV`,
    beam_energy_kv: `${v} kV`,
    monochromated: v === "true" ? "monochromated" : "not monochromated",
    complete: "angles known",
    updated_since: `updated since ${v}`,
    type: TYPE_NAMES[v] ?? v,
  };
  return labels[key] ?? v;
}

/** A number filter with its unit drawn inside the field. */
function EnergyInput(props: { f: Filters; name: string; label: string }) {
  return (
    <div class="bound">
      <label for={`f-${props.name}`}>{props.label}</label>
      <span class="bound-field">
        <input type="number" step="any" inputmode="decimal" id={`f-${props.name}`} name={props.name} value={one(props.f, props.name)} />
        <span class="unit" aria-hidden="true">eV</span>
      </span>
    </div>
  );
}

function Sort({ f, by, label, sort, desc }: { f: Filters; by: string; label: string; sort: string; desc: boolean }) {
  const active = sort === by;
  return (
    <a href={urlWith(f, { sort: by, order: active && !desc ? "desc" : null, page: null })} aria-sort={active ? (desc ? "descending" : "ascending") : undefined}>
      {label}
      {active ? (desc ? " ↓" : " ↑") : ""}
    </a>
  );
}

/** Position on the shared 1 eV – 10 keV log scale, in percent. */
const logPos = (ev: number) => Math.min(100, Math.max(0, (Math.log10(Math.max(ev, 1)) / 4) * 100));

const SPARK_W = 150;
const SPARK_H = 36;

function Spark({ p, elements }: { p: Preview; elements: string[] }) {
  const n = p.y.length;
  const X = (i: number) => ((i / (n - 1)) * SPARK_W).toFixed(1);
  const Y = (v: number) => (SPARK_H - 2 - (v / 100) * (SPARK_H - 4)).toFixed(1);
  const d = "M" + p.y.map((v, i) => `${X(i)},${Y(v)}`).join("L");
  const [e0, e1] = p.e;
  return (
    <svg class="spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true">
      {majorEdges(elements, e0, e1).map((e) => {
        const x = (((e.energy - e0) / (e1 - e0)) * SPARK_W).toFixed(1);
        return <line class="edge" x1={x} x2={x} y1="0" y2={String(SPARK_H)} />;
      })}
      <path class="area" d={`${d}L${SPARK_W},${SPARK_H}L0,${SPARK_H}Z`} />
      <path class="line" d={d} />
    </svg>
  );
}

function Row({ s, picked }: { s: Shown; picked: Set<string> }) {
  const href = `/spectra/${encodeURIComponent(s.slug)}/`;
  const hasRange = s.min_energy_ev !== null && s.max_energy_ev !== null;
  const [a, b] = hasRange ? [logPos(s.min_energy_ev!), logPos(s.max_energy_ev!)] : [0, 0];
  return (
    <tr>
      <td class="thumb">
        {s.preview && (
          <a href={href} tabindex={-1} aria-hidden="true">
            <Spark p={s.preview} elements={s.elements} />
          </a>
        )}
      </td>
      <td class="material">
        <a href={href}>{s.title}</a>
        <span class="sub">
          <Formula formula={s.formula} />
          <TypeBadge type={s.type} />
          {s.phase === "gas" && <span>Gas phase</span>}
        </span>
      </td>
      <td class="hide-sm">
        <span class="edge-chips">
          {s.edges.length ? s.edges.map((e) => <span class={picked.has(e.split(" ")[0]) ? "edge-chip picked" : "edge-chip"}><EdgeName label={e} /></span>) : <span class="muted">–</span>}
        </span>
      </td>
      <td class="hide-sm">
        {hasRange && (
          <span class="coverage">
            <span class="bar"><span style={`left:${a.toFixed(1)}%;width:${(b - a).toFixed(1)}%`}></span></span>
            {Number(s.min_energy_ev!.toFixed(1))} – {Number(s.max_energy_ev!.toFixed(1))} eV
          </span>
        )}
      </td>
      <td class="num res hide-sm">
        {fmt(s.resolution_ev, "eV")}
        <span class="conditions">{[fmt(s.beam_energy_kv, "kV", 0), s.monochromated ? "monochromated" : ""].filter(Boolean).join(" · ")}</span>
      </td>
      <td class="hide-sm source">
        <a href={`/author/${s.author_slug}/`}>{s.author_display}</a>
        <span class="muted">{[s.journal, s.year].filter(Boolean).join(" ") || s.published_at?.slice(0, 4)}</span>
      </td>
    </tr>
  );
}


export async function browsePage(c: Context<AppEnv>) {
  const db = c.env.DB;
  const f = readFilters(new URL(c.req.url).search);
  for (const key of [...f.keys()]) if (!(key in ListQuery.shape) || key === "per_page") f.delete(key);
  // A filter the API would reject (an unknown element, a word for a number) is dropped and named, not an error page.
  let parsed = ListQuery.safeParse({ ...queryInput(f), per_page: PER_PAGE });
  const ignored: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && f.delete(key)) ignored.push(key);
    }
    parsed = ListQuery.safeParse({ ...queryInput(f), per_page: PER_PAGE });
  }
  const q = parsed.success ? parsed.data : ListQuery.parse({ per_page: PER_PAGE });
  const { total, ids } = await listSpectra(db, q);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const [{ results: rows }, { results: elementRows }, { results: authorRows }, { results: keywordRows }] = await db.batch<any>([
    db.prepare(
      `SELECT s.id, s.slug, s.title, s.type, s.phase, s.formula, s.min_energy_ev, s.max_energy_ev, s.author_display, s.author_slug, s.published_at,
              s.preview, s.preview_key, a.beam_energy_kv, a.resolution_ev, a.monochromated, r.journal, r.year,
              (SELECT f.r2_key FROM files f WHERE f.spectrum_id = s.id AND f.role IN ('legacy', 'msa', 'original')
               ORDER BY f.role = 'legacy' DESC, f.role = 'msa' DESC, f.created_at LIMIT 1) AS file,
              (SELECT json_group_array(e.element) FROM spectrum_elements e WHERE e.spectrum_id = s.id) AS elements,
              (SELECT group_concat(g.element || ' ' || g.edge, ', ') FROM spectrum_edges g WHERE g.spectrum_id = s.id) AS edges
       FROM spectra s LEFT JOIN eels_acquisition a ON a.spectrum_id = s.id LEFT JOIN reference r ON r.spectrum_id = s.id
       WHERE s.id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(ids)),
    db.prepare(
      "SELECT e.element, COUNT(*) AS n FROM spectrum_elements e JOIN spectra s ON s.id = e.spectrum_id WHERE s.status = 'published' GROUP BY e.element ORDER BY e.element",
    ),
    db.prepare("SELECT MIN(author_display) AS name, COUNT(*) AS n FROM spectra WHERE status = 'published' GROUP BY author_slug ORDER BY n DESC, name"),
    db.prepare(
      `SELECT MIN(k.keyword) AS keyword, COUNT(*) AS n FROM spectrum_keywords k JOIN spectra s ON s.id = k.spectrum_id
       WHERE s.status = 'published' GROUP BY k.keyword COLLATE NOCASE ORDER BY n DESC, keyword`,
    ),
  ]);
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const thumbs = await previews(c.env, c.executionCtx, rows);
  const shown: Shown[] = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r: any) => ({ ...r, edges: r.edges?.split(", ") ?? [], elements: JSON.parse(r.elements ?? "[]"), preview: thumbs.get(r.id) }));

  const selected = new Set(f.get("element") ?? []);
  const elementCounts = new Map<string, number>(elementRows.map((r: any) => [r.element, r.n]));
  for (const el of selected) if (!elementCounts.has(el)) elementCounts.set(el, 0);
  const pickedKeywords = new Set((f.get("keyword") ?? []).map((k) => k.toLowerCase()));
  const keywordCounts: [string, number][] = keywordRows.map((r: any) => [r.keyword, r.n]);
  for (const k of f.get("keyword") ?? []) if (!keywordCounts.some(([x]) => x.toLowerCase() === k.toLowerCase())) keywordCounts.push([k, 0]);
  const types = new Set(f.get("type") ?? []);
  const sort = q.sort;
  const desc = q.order === "desc";
  const activeChips: [string, string][] = [...f]
    .filter(([k]) => !["page", "sort", "order"].includes(k))
    .flatMap(([k, values]) => values.map((v) => [k, v] as [string, string]));

  return c.html(
    <Layout user={c.get("user")} title="Browse spectra" path="/spectra/" wide>
      <div class="page-head">
        <h1>Browse spectra</h1>
        <a class="button secondary" href="/downloads/">Bulk download</a>
      </div>
      <div class="browse">
        <form class="filters" method="get" action="/spectra/" id="filters">
          <div>
            <label for="f-q">Title or description</label>
            <input type="search" id="f-q" name="q" value={one(f, "q")} placeholder="e.g. graphite" />
          </div>
          <fieldset class="types">
            <legend>Type</legend>
            {Object.entries(TYPE_NAMES).map(([code, name]) => (
              <label class="check">
                <input type="checkbox" name="type" value={code} checked={types.has(code)} />
                <span class={`type type-${code}`}>{name}</span>
              </label>
            ))}
          </fieldset>
          <div>
            <label for="f-phase">Phase</label>
            <select id="f-phase" name="phase">
              <option value="">All</option>
              {["solid", "liquid", "gas"].map((ph) => <option value={ph} selected={one(f, "phase") === ph}>{ph[0].toUpperCase() + ph.slice(1)} only</option>)}
            </select>
          </div>
          <div>
            <label for="f-formula">Formula contains</label>
            <input type="text" id="f-formula" name="formula" value={one(f, "formula")} placeholder="e.g. TiO2" />
          </div>
          <div class="element-filter">
            <label for="f-element">Elements</label>
            <select id="f-element" name="element" multiple size={8} aria-describedby="f-element-hint">
              {[...elementCounts].map(([el, n]) => (
                <option value={el} selected={selected.has(el)} data-name={ELEMENT_NAMES[el] ?? el} data-count={n}>
                  {el} · {ELEMENT_NAMES[el] ?? el} ({n})
                </option>
              ))}
            </select>
            <p class="hint" id="f-element-hint">Spectra must contain all selected elements.</p>
          </div>
          <div>
            <label for="f-edge">Edge</label>
            <select id="f-edge" name="edge">
              <option value="">Any edge</option>
              {EDGES.map((e) => (
                <option value={e} selected={one(f, "edge") === e}>{e}</option>
              ))}
            </select>
          </div>
          {keywordCounts.length > 0 && (
            <div class="keyword-filter">
              <label for="f-keyword">Keywords</label>
              <select id="f-keyword" name="keyword" multiple size={6} aria-describedby="f-keyword-hint">
                {keywordCounts.map(([k, n]) => (
                  <option value={k} selected={pickedKeywords.has(k.toLowerCase())} data-count={n}>{k} ({n})</option>
                ))}
              </select>
              <p class="hint" id="f-keyword-hint">Spectra must have all selected keywords.</p>
            </div>
          )}
          <fieldset>
            <legend>Energy range</legend>
            <div class="energy-range">
              <EnergyInput f={f} name="min_energy_ev" label="Starts at or above" />
              <EnergyInput f={f} name="max_energy_ev" label="Ends at or below" />
              <EnergyInput f={f} name="covers_ev" label="Includes" />
            </div>
          </fieldset>
          <EnergyInput f={f} name="max_resolution_ev" label="Resolution at or better than" />
          <div class="author-filter">
            <label for="f-author">Author</label>
            <input type="text" id="f-author" name="author" value={(f.get("author") ?? []).join(", ")} list="f-author-list" autocomplete="off" aria-describedby="f-author-hint" />
            <datalist id="f-author-list">
              {authorRows.map((a: any) => (
                <option value={a.name} data-count={a.n} label={a.n === 1 ? "1 spectrum" : `${a.n} spectra`} />
              ))}
            </datalist>
            <p class="hint" id="f-author-hint">Separate several names with commas.</p>
          </div>
          <label class="check">
            <input type="checkbox" name="monochromated" value="true" checked={one(f, "monochromated") === "true"} /> Monochromated only
          </label>
          <label class="check">
            <input type="checkbox" name="complete" value="true" checked={one(f, "complete") === "true"} /> Beam energy and angles known
          </label>
          <div>
            <label for="f-updated">Published or updated since</label>
            <input type="date" id="f-updated" name="updated_since" value={one(f, "updated_since")} />
          </div>
          {f.has("sort") && <input type="hidden" name="sort" value={sort} />}
          {desc && <input type="hidden" name="order" value="desc" />}
          <div class="filter-actions">
            <button class="button" type="submit">Apply filters</button>
            <a class="button secondary" href="/spectra/">Clear</a>
          </div>
        </form>

        <section aria-label="Results">
          <div class="result-bar">
            <p class="muted" role="status">
              {total === 1 ? "1 spectrum" : `${total} spectra`}
              {pages > 1 && ` · page ${q.page} of ${pages}`}
              <span class="jump-filters"> · <a href="#filters">Filters</a></span>
            </p>
            {activeChips.length > 0 && (
              <div class="chips">
                {activeChips.map(([k, v]) => (
                  <a class="chip" href={withoutFilter(f, k, v)} title="Remove filter">{chipLabel(k, v)} ×</a>
                ))}
              </div>
            )}
          </div>
          {ignored.length > 0 && (
            <p class="notice" role="status">Some filters could not be read and were left out: {ignored.join(", ")}.</p>
          )}
          {shown.length === 0 ? (
            <p class="empty notice">
              {total > 0 ? (
                <>
                  There is no page {q.page}. <a href={urlWith(f, { page: null })}>Go to the first page</a>.
                </>
              ) : (
                <>
                  No spectra match these filters. <a href="/spectra/">Clear all filters</a> or remove one above.
                </>
              )}
            </p>
          ) : (
            <div class="table-scroll">
              <table class="results">
                <thead>
                  <tr>
                    <th class="thumb">Spectrum</th>
                    <th>
                      <Sort f={f} by="title" label="Title" sort={sort} desc={desc} />
                      {" · "}
                      <Sort f={f} by="formula" label="formula" sort={sort} desc={desc} />
                    </th>
                    <th class="hide-sm">Edges</th>
                    <th class="hide-sm">
                      <Sort f={f} by="min_energy_ev" label="Energy range" sort={sort} desc={desc} />
                      <span class="scale" aria-hidden="true"><span>1 eV</span><span>100 eV</span><span>10 keV</span></span>
                    </th>
                    <th class="num hide-sm">
                      <Sort f={f} by="resolution_ev" label="Resolution" sort={sort} desc={desc} />
                      {" · "}
                      <Sort f={f} by="beam_energy_kv" label="beam" sort={sort} desc={desc} />
                    </th>
                    <th class="hide-sm"><Sort f={f} by="author" label="Source" sort={sort} desc={desc} /></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <Row s={s} picked={selected} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav class="pager" aria-label="Pages">
              {q.page > 1 && <a href={urlWith(f, { page: String(q.page - 1) })} rel="prev">Previous</a>}
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
                n === q.page ? <span aria-current="page">{n}</span> : <a href={urlWith(f, { page: n === 1 ? null : String(n) })}>{n}</a>,
              )}
              {q.page < pages && <a href={urlWith(f, { page: String(q.page + 1) })} rel="next">Next</a>}
            </nav>
          )}
        </section>
      </div>
      <script src="/browse.js" defer></script>
    </Layout>,
  );
}
