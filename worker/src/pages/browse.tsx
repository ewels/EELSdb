import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { KNOWN_ARGS, buildSpectraQuery, parseParams, sortAndPage, type Params } from "../api/query";
import { Formula, Layout, TYPE_NAMES, TypeBadge, fmt } from "./layout";

const PER_PAGE = 50;

// 18-column layout; "." is an empty cell. The last two rows are the lanthanides and actinides.
const PERIODIC_ROWS = [
  "H . . . . . . . . . . . . . . . . He",
  "Li Be . . . . . . . . . . B C N O F Ne",
  "Na Mg . . . . . . . . . . Al Si P S Cl Ar",
  "K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr",
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe",
  "Cs Ba La Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn",
  "Fr Ra Ac Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og",
  ". . . Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu .",
  ". . . Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr .",
].map((r) => r.split(" "));

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
  ["Edges", null, "hide-sm"],
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

export async function browsePage(c: Context<AppEnv>) {
  const params = parseParams(new URL(c.req.url).search);
  for (const key of [...params.keys()]) if (!KNOWN_ARGS.includes(key)) params.delete(key);
  params.set("per_page", String(PER_PAGE));

  const q = buildSpectraQuery(params, { exact: true });
  const [{ results: rows }, { results: elementRows }, { results: edgeRows }] = await c.env.DB.batch<any>([
    c.env.DB.prepare(q.sql).bind(...q.binds),
    c.env.DB.prepare(
      "SELECT DISTINCT e.element FROM spectrum_elements e JOIN spectra s ON s.id = e.spectrum_id WHERE s.status = 'published'",
    ),
    c.env.DB.prepare(
      `SELECT g.spectrum_id, group_concat(g.element || ' ' || g.edge, ', ') AS edges
       FROM spectrum_edges g JOIN spectra s ON s.id = g.spectrum_id WHERE s.status = 'published' GROUP BY g.spectrum_id`,
    ),
  ]);
  const total = rows.length;
  const page = sortAndPage(rows, q);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const present = new Set(elementRows.map((r: any) => r.element));
  const edgesById = new Map(edgeRows.map((r: any) => [r.spectrum_id, r.edges]));
  const selected = new Set([params.get("element") ?? []].flat());
  const orderKey = val(params, "order") || "spectrumFormula";
  const desc = val(params, "order_direction") === "DESC";
  params.delete("per_page");

  const activeChips: [string, string][] = [];
  for (const [k, v] of params) {
    if (["page", "order", "order_direction"].includes(k) || k.endsWith("_compare")) continue;
    for (const one of [v].flat()) if (one) activeChips.push([k, one]);
  }

  return c.html(
    <Layout user={c.get("user")} title="Browse spectra" path="/spectra/">
      <h1>Browse spectra</h1>
      <div class="browse">
        <form class="filters" method="get" action="/spectra/" id="filters">
          <div>
            <label for="f-title">Title or description</label>
            <input type="search" id="f-title" name="title" value={val(params, "title")} placeholder="e.g. graphite" />
          </div>
          <div>
            <label for="f-type">Type</label>
            <select id="f-type" name="type">
              <option value="">Any type</option>
              {Object.entries(TYPE_NAMES).map(([code, name]) => (
                <option value={code} selected={val(params, "type") === code}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="f-formula">Formula contains</label>
            <input type="text" id="f-formula" name="formula" value={val(params, "formula")} placeholder="e.g. TiO2" />
          </div>
          <details class="periodic" open={selected.size > 0}>
            <summary>Elements{selected.size ? ` (${[...selected].join(", ")})` : ""}</summary>
            <div class="ptable" role="group" aria-label="Elements: spectra must contain all selected">
              {PERIODIC_ROWS.flatMap((row) =>
                row.map((el) =>
                  el === "." ? (
                    <span class="gap" aria-hidden="true" />
                  ) : (
                    <label class={present.has(el) ? "has" : undefined} title={present.has(el) ? el : `${el} (no spectra)`}>
                      <input type="checkbox" name="element[]" value={el} checked={selected.has(el)} />
                      <span>{el}</span>
                    </label>
                  ),
                ),
              )}
            </div>
          </details>
          <div>
            <label for="f-edge">Edge</label>
            <select id="f-edge" name="edge">
              <option value="">Any edge</option>
              {EDGES.map((e) => (
                <option value={e} selected={val(params, "edge") === e}>{e}</option>
              ))}
            </select>
          </div>
          {(
            [
              ["min_energy", "Start energy (eV)"],
              ["max_energy", "End energy (eV)"],
              ["resolution", "Resolution (eV)"],
            ] as const
          ).map(([key, label]) => (
            <fieldset>
              <legend>{label}</legend>
              <div class="range">
                <select name={`${key}_compare`} aria-label={`${label} comparison`}>
                  {COMPARES.map(([v, sym]) => (
                    <option value={v} selected={(val(params, `${key}_compare`) || (key === "min_energy" ? "gt" : "lt")) === v}>{sym}</option>
                  ))}
                </select>
                <input type="number" step="any" name={key} value={val(params, key)} aria-label={label} />
              </div>
            </fieldset>
          ))}
          <div>
            <label for="f-author">Author</label>
            <input type="text" id="f-author" name="author" value={val(params, "author")} />
          </div>
          <label class="check">
            <input type="checkbox" name="monochromated" value="1" checked={val(params, "monochromated") === "1"} /> Monochromated only
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
              <a class="jump-filters" href="#filters"> · Filters</a>
            </p>
            {activeChips.length > 0 && (
              <div class="chips">
                {activeChips.map(([k, v]) => (
                  <a class="chip" href={withoutFilter(params, k, v)} title="Remove filter">
                    {k === "element" ? v : `${k.replace("_", " ")}: ${TYPE_NAMES[v] ?? v}`} ×
                  </a>
                ))}
              </div>
            )}
          </div>
          {page.length === 0 ? (
            <p class="empty notice">
              No spectra match these filters. <a href="/spectra/">Clear all filters</a> or remove one above.
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
                      <td class="edges hide-sm">{(edgesById.get(s.id) ?? "").replaceAll(" ", "\u00a0").replaceAll(",\u00a0", ", ")}</td>
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
