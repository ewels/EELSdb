import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { KNOWN_ARGS, buildSpectraQuery, parseParams, sortAndPage, type Params } from "../api/query";
import NAMES from "../element-names.json";
import { Formula, Layout, TYPE_NAMES, TypeBadge, fmt } from "./layout";

const PER_PAGE = 50;
const ELEMENT_NAMES: Record<string, string> = NAMES;

const EDGES = ["K", "L1", "L2,3", "M2,3", "M4,5", "N2,3", "N4,5", "O2,3", "O4,5"];
const COMPARES = [
  ["gt", "≥"],
  ["lt", "≤"],
  ["eq", "="],
] as const;

const COLUMNS: [label: string, order: string | null, cls?: string][] = [
  ["Type", "spectrumType"],
  ["Title", "title"],
  ["Formula", "spectrumFormula"],
  ["Edges", null, "hide-sm hide-md"],
  ["Energy range", "spectrumMin", "num"],
  ["Beam", "beamenergy", "num hide-sm"],
  ["Resolution", "resolution", "num hide-sm"],
  ["Author", "author", "hide-sm"],
  ["Added", "date", "num hide-sm hide-md"],
];

function urlWith(params: Params, changes: Record<string, string | null>) {
  const out = new URLSearchParams();
  for (const [k, v] of params) {
    if (k in changes) continue;
    for (const one of Array.isArray(v) ? v : [v]) if (one !== "") out.append(Array.isArray(v) ? `${k}[]` : k, one);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null) out.set(k, v);
  const q = out.toString();
  return `/spectra/${q ? `?${q}` : ""}`;
}

function withoutFilter(params: Params, key: string, value: string) {
  const copy: Params = new Map(params);
  const v = copy.get(key);
  if (Array.isArray(v) && v.length > 1) copy.set(key, v.filter((x) => x !== value));
  else copy.delete(key);
  return urlWith(copy, { [`${key}_compare`]: null, page: null });
}

const val = (params: Params, key: string) => {
  const v = params.get(key);
  return typeof v === "string" ? v : "";
};

/** A number filter with its comparator, drawn as one control with the unit inside. */
function Bound({ params, name, label, placeholder }: { params: Params; name: string; label: string; placeholder?: string }) {
  const compare = val(params, `${name}_compare`) || (name === "min_energy" ? "gt" : "lt");
  return (
    <div class="bound">
      <select name={`${name}_compare`} aria-label={`${label} comparison`}>
        {COMPARES.map(([v, sym]) => (
          <option value={v} selected={compare === v}>{sym}</option>
        ))}
      </select>
      <input type="number" step="any" inputmode="decimal" name={name} value={val(params, name)} aria-label={`${label} (eV)`} placeholder={placeholder} />
      <span class="unit" aria-hidden="true">eV</span>
    </div>
  );
}

export async function browsePage(c: Context<AppEnv>) {
  const params = parseParams(new URL(c.req.url).search);
  const complete = params.get("complete") === "1";
  for (const key of [...params.keys()]) if (!KNOWN_ARGS.includes(key)) params.delete(key);
  params.set("per_page", String(PER_PAGE));
  const types = new Set([params.get("type") ?? []].flat().filter(Boolean));

  // The shared query builder takes one `type` (API v1 contract), so repeated `type[]` is filtered here.
  const queryParams: Params = new Map(params);
  if (Array.isArray(params.get("type"))) queryParams.delete("type");
  const q = buildSpectraQuery(queryParams, { exact: true, complete });
  let [{ results: rows }, { results: elementRows }, { results: edgeRows }, { results: authorRows }] = await c.env.DB.batch<any>([
    c.env.DB.prepare(q.sql).bind(...q.binds),
    c.env.DB.prepare(
      "SELECT e.element, COUNT(*) AS n FROM spectrum_elements e JOIN spectra s ON s.id = e.spectrum_id WHERE s.status = 'published' GROUP BY e.element ORDER BY e.element",
    ),
    c.env.DB.prepare(
      `SELECT g.spectrum_id, group_concat(g.element || ' ' || g.edge, ', ') AS edges
       FROM spectrum_edges g JOIN spectra s ON s.id = g.spectrum_id WHERE s.status = 'published' GROUP BY g.spectrum_id`,
    ),
    c.env.DB.prepare(
      "SELECT MIN(author_display) AS name, COUNT(*) AS n FROM spectra WHERE status = 'published' GROUP BY author_slug ORDER BY n DESC, name",
    ),
  ]);
  if (Array.isArray(params.get("type"))) rows = rows.filter((r: any) => types.has(r.type));
  const total = rows.length;
  const page = sortAndPage(rows, q);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const edgesById = new Map(edgeRows.map((r: any) => [r.spectrum_id, r.edges]));
  const selected = new Set([params.get("element") ?? []].flat());
  const elementCounts = new Map<string, number>(elementRows.map((r: any) => [r.element, r.n]));
  for (const el of selected) if (!elementCounts.has(el)) elementCounts.set(el, 0);
  const orderKey = val(params, "order") || "spectrumFormula";
  const desc = val(params, "order_direction") === "DESC";
  params.delete("per_page");
  if (complete) params.set("complete", "1");

  const activeChips: [string, string][] = [];
  for (const [k, v] of params) {
    if (["page", "order", "order_direction"].includes(k) || k.endsWith("_compare")) continue;
    for (const one of [v].flat()) if (one) activeChips.push([k, one]);
  }

  return c.html(
    <Layout user={c.get("user")} title="Browse spectra" path="/spectra/" wide>
      <h1>Browse spectra</h1>
      <div class="browse">
        <form class="filters" method="get" action="/spectra/" id="filters">
          <div>
            <label for="f-title">Title or description</label>
            <input type="search" id="f-title" name="title" value={val(params, "title")} placeholder="e.g. graphite" />
          </div>
          <fieldset class="types">
            <legend>Type</legend>
            {Object.entries(TYPE_NAMES).map(([code, name]) => (
              <label class="check">
                <input type="checkbox" name="type[]" value={code} checked={types.has(code)} />
                <span class={`type type-${code}`}>{name}</span>
              </label>
            ))}
          </fieldset>
          <div>
            <label for="f-formula">Formula contains</label>
            <input type="text" id="f-formula" name="formula" value={val(params, "formula")} placeholder="e.g. TiO2" />
          </div>
          <div class="element-filter">
            <label for="f-element">Elements</label>
            <select id="f-element" name="element[]" multiple size={8} aria-describedby="f-element-hint">
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
                <option value={e} selected={val(params, "edge") === e}>{e}</option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend>Energy range</legend>
            <div class="energy-range">
              <Bound params={params} name="min_energy" label="Start energy" placeholder="from" />
              <Bound params={params} name="max_energy" label="End energy" placeholder="to" />
            </div>
          </fieldset>
          <fieldset>
            <legend>Resolution</legend>
            <Bound params={params} name="resolution" label="Resolution" />
          </fieldset>
          <div class="author-filter">
            <label for="f-author">Author</label>
            <input type="text" id="f-author" name="author" value={val(params, "author")} list="f-author-list" autocomplete="off" aria-describedby="f-author-hint" />
            <datalist id="f-author-list">
              {authorRows.map((a: any) => (
                <option value={a.name} data-count={a.n} label={a.n === 1 ? "1 spectrum" : `${a.n} spectra`} />
              ))}
            </datalist>
            <p class="hint" id="f-author-hint">Separate several names with commas.</p>
          </div>
          <label class="check">
            <input type="checkbox" name="monochromated" value="1" checked={val(params, "monochromated") === "1"} /> Monochromated only
          </label>
          <label class="check">
            <input type="checkbox" name="complete" value="1" checked={complete} /> Beam energy and angles known
          </label>
          {params.has("order") && <input type="hidden" name="order" value={orderKey} />}
          {desc && <input type="hidden" name="order_direction" value="DESC" />}
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
                  <a class="chip" href={withoutFilter(params, k, v)} title="Remove filter">
                    {k === "element" ? v : k === "complete" ? "angles known" : `${k.replace("_", " ")}: ${TYPE_NAMES[v] ?? v}`} ×
                  </a>
                ))}
              </div>
            )}
          </div>
          {page.length === 0 ? (
            <p class="empty notice">
              {total > 0 ? (
                <>
                  There is no page {q.page}. <a href={urlWith(params, { page: null })}>Go to the first page</a>.
                </>
              ) : (
                <>
                  No spectra match these filters. <a href="/spectra/">Clear all filters</a> or remove one above.
                </>
              )}
            </p>
          ) : (
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    {COLUMNS.map(([label, key, cls]) => {
                      if (!key) return <th class={cls}>{label}</th>;
                      const active = orderKey === key;
                      const next = active && !desc ? "DESC" : "ASC";
                      return (
                        <th class={cls} aria-sort={active ? (desc ? "descending" : "ascending") : undefined}>
                          <a href={urlWith(params, { order: key, order_direction: next, page: null })} aria-sort={active ? "true" : undefined}>
                            {label}
                            {active ? (desc ? " ↓" : " ↑") : ""}
                          </a>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {page.map((s) => (
                    <tr>
                      <td><TypeBadge type={s.type} /></td>
                      <td class="title"><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a></td>
                      <td class="formula-cell"><Formula formula={s.formula} /></td>
                      <td class="edges hide-sm hide-md">{(edgesById.get(s.id) ?? "").replaceAll(" ", "\u00a0").replaceAll(",\u00a0", ", ")}</td>
                      <td class="num">
                        {s.min_energy_ev !== null && s.max_energy_ev !== null
                          ? `${Number(s.min_energy_ev.toFixed(1))} – ${Number(s.max_energy_ev.toFixed(1))} eV`
                          : ""}
                      </td>
                      <td class="num hide-sm">{fmt(s.beam_energy_kv, "kV", 0)}</td>
                      <td class="num hide-sm">{fmt(s.resolution_ev, "eV")}</td>
                      <td class="hide-sm"><a href={`/author/${s.author_slug}/`}>{s.author_display}</a></td>
                      <td class="num hide-sm hide-md">{s.published_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav class="pager" aria-label="Pages">
              {q.page > 1 && <a href={urlWith(params, { page: String(q.page - 1) })} rel="prev">Previous</a>}
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
                n === q.page ? <span aria-current="page">{n}</span> : <a href={urlWith(params, { page: n === 1 ? null : String(n) })}>{n}</a>,
              )}
              {q.page < pages && <a href={urlWith(params, { page: String(q.page + 1) })} rel="next">Next</a>}
            </nav>
          )}
        </section>
      </div>
      <script src="/browse.js" defer></script>
    </Layout>,
  );
}
