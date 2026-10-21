import type { Context } from "hono";
import { raw } from "hono/html";
import { avatarUrl, type AppEnv } from "../auth";
import NAMES from "../element-names.json";
import BINDING from "../../public/eels_binding_energies.json";
import { Formula, Layout, TYPE_NAMES } from "./layout";
import { HERO_LOGO_SVG } from "./logo";

const ELEMENT_NAMES: Record<string, string> = NAMES;
const ONSETS = BINDING.elements as Record<string, Record<string, { "onset_energy (eV)": number; relevance: string }>>;
const TYPE_ORDER = ["coreloss", "lowloss", "xrayabs", "zeroloss"];
const DOI = "10.1017/S1431927616000179";

/** Spectra shown as examples, with the short name used on their tile. */
const EXAMPLES: [slug: string, label: string][] = [
  ["titanium-dioxide-rutile-structure-4", "Rutile"],
  ["graphite", "Graphite"],
  ["diamond", "Diamond"],
  ["boron-nitride-single-wall-nanotube", "BN nanotube"],
  ["srtio3-111-4", "SrTiO3"],
  ["nickel-monoxide", "NiO"],
];

// The table with the lanthanides and actinides moved out of rows 6 and 7; "*" marks where they belong.
const TABLE = [
  "H . . . . . . . . . . . . . . . . He",
  "Li Be . . . . . . . . . . B C N O F Ne",
  "Na Mg . . . . . . . . . . Al Si P S Cl Ar",
  "K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr",
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe",
  "Cs Ba *57–71 Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn",
  "Fr Ra *89–103 Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og",
  "",
  ". . La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu",
  ". . Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr",
].map((row) => row.split(" "));

/** 0 for none, else 1–6 on a log scale up to the largest count. Keep in step with shade() in public/home.js. */
const shade = (n: number, max: number) => (n ? Math.min(6, 1 + Math.floor((Math.log(n) / Math.log(max)) * 5.999)) : 0);

const plural = (n: number) => `${n} spectr${n === 1 ? "um" : "a"}`;

/** Spectrum file text to [energy, counts]. Keep in step with parseSpectrum() in public/spectrum.js. */
function parseSpectrum(text: string): [number[], number[]] {
  const header: Record<string, string> = {};
  const x: number[] = [];
  const y: number[] = [];
  let inData = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(/^#([A-Z0-9 -]+?)\s*:\s*(.*)$/i);
      if (m) header[m[1].trim().toUpperCase()] = m[2].trim();
      if (/^#SPECTRUM/i.test(line)) inData = true;
      if (/^#ENDOFDATA/i.test(line)) break;
      continue;
    }
    if (!/^[-+.\d]/.test(line)) continue;
    const nums = line.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.some(Number.isNaN)) continue;
    if (inData && (header.DATATYPE || "").toUpperCase() === "Y") y.push(...nums);
    else if (nums.length >= 2) {
      x.push(nums[0]);
      y.push(nums[1]);
    }
  }
  if (!x.length) {
    const offset = parseFloat(header.OFFSET) || 0;
    const step = parseFloat(header.XPERCHAN) || 1;
    for (let i = 0; i < y.length; i++) x.push(offset + step * i);
  }
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return [order.map((i) => x[i]), order.map((i) => y[i])];
}

/**
 * Major edges of the elements inside [e0, e1]. Subshells of one shell within 10 eV share a marker at the lowest onset
 * (Ti L3 and L2 become "Ti L2,3"); further apart they get their own (Ni L3, Ni L2). The spectrum page marks the same exSpy edges.
 */
function majorEdges(elements: string[], e0: number, e1: number) {
  const out: { energy: number; label: string }[] = [];
  for (const element of elements) {
    const shells = new Map<string, { energy: number; sub: string }[]>();
    for (const [name, info] of Object.entries(ONSETS[element] ?? {})) {
      const energy = info["onset_energy (eV)"];
      if (info.relevance !== "Major" || !(energy > e0 && energy < e1)) continue;
      shells.set(name[0], [...(shells.get(name[0]) ?? []), { energy, sub: name.slice(1) }]);
    }
    for (const [letter, subs] of shells) {
      subs.sort((a, b) => a.energy - b.energy);
      let group = [subs[0]];
      const flush = () => out.push({ energy: group[0].energy, label: `${element} ${letter}${group.map((g) => g.sub).sort().join(",")}` });
      for (const s of subs.slice(1)) {
        if (s.energy - group[0].energy <= 10) group.push(s);
        else {
          flush();
          group = [s];
        }
      }
      flush();
    }
  }
  return out;
}

const W = 1000;
const H = 300;
const PAD = 8;

type MiniPlot = { d: string; edges: { x: number; label: string }[] };
// ponytail: per-isolate memo of the six example plots; move to the Cache API if the examples become dynamic.
const plotMemo = new Map<string, MiniPlot | null>();

async function miniPlot(c: Context<AppEnv>, key: string, elements: string[]): Promise<MiniPlot | null> {
  if (plotMemo.has(key)) return plotMemo.get(key)!;
  const object = await c.env.FILES.get(key);
  let plot: MiniPlot | null = null;
  if (object) {
    const [x, y] = parseSpectrum(await object.text());
    if (x.length > 1) {
      const stride = Math.ceil(x.length / 400);
      const xs = x.filter((_, i) => i % stride === 0);
      const ys = y.filter((_, i) => i % stride === 0);
      const [e0, e1] = [xs[0], xs[xs.length - 1]];
      const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
      const X = (e: number) => ((e - e0) / (e1 - e0)) * W;
      const Y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - 2 * PAD);
      plot = {
        d: "M" + xs.map((e, i) => `${X(e).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join("L"),
        edges: majorEdges(elements, e0, e1).map((e) => ({ x: X(e.energy), label: e.label })),
      };
    }
  }
  plotMemo.set(key, plot);
  return plot;
}

const EdgeLabel = (props: { label: string }) => {
  const [element, edge] = props.label.split(" ");
  const [, shell, sub] = edge.match(/^([A-Z])(.*)$/) ?? [];
  return <>{element} {shell}{sub && <sub>{sub}</sub>}</>;
};

const MiniPlotFigure = (props: { plot: MiniPlot }) => (
  <div class="fig">
    {props.plot.edges.map((e) => (
      <span class="edge-lab" style={`left:${((e.x / W) * 100).toFixed(2)}%`}><EdgeLabel label={e.label} /></span>
    ))}
    <svg class="mini-plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {props.plot.edges.map((e) => <line class="edge" x1={e.x.toFixed(1)} x2={e.x.toFixed(1)} y1="0" y2={H} />)}
      <path class="area" d={`${props.plot.d}L${W},${H}L0,${H}Z`} />
      <path class="line" d={props.plot.d} />
    </svg>
  </div>
);

const AV_HUES = ["av-a", "av-b", "av-c", "av-d", "av-e"];

const initials = (name: string) => {
  const parts = name.replace(/\([^)]*\)/g, "").split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0].slice(1, 2))).toUpperCase();
};

type Person = { slug: string; name: string; avatar: string | null };

const Avatar = (props: { person: Person }) => (
  <span class={`av ${AV_HUES[[...props.person.slug].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AV_HUES.length]}`} aria-hidden="true">
    {initials(props.person.name)}
    {props.person.avatar && <img src={props.person.avatar} alt="" loading="lazy" referrerpolicy="no-referrer" />}
  </span>
);

const ARROW = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);
const GO = (
  <svg class="go" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);

/** "(Dr) Marie Cheynet" or "Dr. Gilles Hug" to the name alone. */
const plainName = (name: string) => name.replace(/^\(?Dr\.?\)?\s+/i, "").trim();

/** A contributor's picture shows only when they chose a public profile. */
async function person(row: any): Promise<Person> {
  return { slug: row.slug, name: plainName(row.name), avatar: row.profile_public ? await avatarUrl(row.avatar_key, row.email) : null };
}

export async function homePage(c: Context<AppEnv>) {
  const db = c.env.DB;
  const published = "status = 'published'";
  const [{ results: byType }, { results: byElement }, { results: people }, { results: examples }, stats] = await db.batch<any>([
    db.prepare(`SELECT type, COUNT(*) AS n FROM spectra WHERE ${published} GROUP BY type`),
    db.prepare(
      `SELECT e.element, s.type, COUNT(DISTINCT s.id) AS n FROM spectrum_elements e JOIN spectra s ON s.id = e.spectrum_id
       WHERE s.${published} GROUP BY e.element, s.type`,
    ),
    db.prepare(
      `SELECT s.author_slug AS slug, MIN(s.author_display) AS name, COUNT(*) AS n, MIN(substr(s.published_at, 1, 4)) AS since,
              u.profile_public, u.avatar_key,
              (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email
       FROM spectra s LEFT JOIN users u ON u.slug = s.author_slug
       WHERE s.${published} GROUP BY s.author_slug ORDER BY n DESC, name LIMIT 24`,
    ),
    db.prepare(
      `SELECT s.id, s.slug, s.title, s.formula, s.type, s.author_slug AS slug_author, s.author_display,
              u.profile_public, u.avatar_key,
              (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email,
              (SELECT f.r2_key FROM files f WHERE f.spectrum_id = s.id ORDER BY f.role = 'legacy' DESC, f.created_at LIMIT 1) AS file,
              (SELECT json_group_array(e.element) FROM spectrum_elements e WHERE e.spectrum_id = s.id) AS elements
       FROM spectra s LEFT JOIN users u ON u.slug = s.author_slug
       WHERE s.${published} AND s.slug IN (${EXAMPLES.map(() => "?").join(",")})`,
    ).bind(...EXAMPLES.map(([slug]) => slug)),
    db.prepare(
      `SELECT COUNT(*) AS spectra, COUNT(DISTINCT author_slug) AS contributors, MIN(substr(published_at, 1, 4)) AS since
       FROM spectra WHERE ${published}`,
    ),
  ]);
  const typeCount = Object.fromEntries(byType.map((r: any) => [r.type, r.n]));
  const { spectra: total, contributors, since } = stats.results[0];

  const elTypes: Record<string, Record<string, number>> = {};
  for (const r of byElement) (elTypes[r.element] ??= {})[r.type] = r.n;
  const elTotal = (sym: string) => Object.values(elTypes[sym] ?? {}).reduce((a, b) => a + b, 0);
  const maxCount = Math.max(1, ...Object.keys(elTypes).map(elTotal));

  const bySlug = new Map(examples.map((r: any) => [r.slug, r]));
  const tiles = await Promise.all(
    EXAMPLES.filter(([slug]) => bySlug.has(slug)).map(async ([slug, label]) => {
      const r: any = bySlug.get(slug);
      return {
        r,
        label,
        plot: r.file ? await miniPlot(c, r.file, JSON.parse(r.elements ?? "[]")) : null,
        author: await person({ slug: r.slug_author, name: r.author_display, profile_public: r.profile_public, avatar_key: r.avatar_key, email: r.email }),
      };
    }),
  );
  const faces = await Promise.all(people.map(async (p: any) => ({ ...(await person(p)), n: p.n, since: p.since })));

  return c.html(
    <Layout user={c.get("user")} path="/" home head={<script src="/home.js" defer></script>}>
      <section class="intro">
        <h1 class="hero-logo">{raw(HERO_LOGO_SVG)}</h1>
        <p class="lede">Reference spectra for electron energy-loss and X-ray absorption spectroscopy, shared by microscopists.</p>
        <div class="intro-links">
          <a class="button" href="/spectra/">Browse all spectra {ARROW}</a>
          <a class="button secondary" href="/submit-data/">Share your spectra {ARROW}</a>
        </div>
      </section>

      <section class="hero">
        <div>
          <ul class="ways">
            <li class="way-search">
              <h2><label for="q">Search by name or formula</label></h2>
              <form class="search" action="/spectra/" method="get" role="search">
                <input id="q" name="title" type="search" placeholder="For example rutile, TiO2 or graphite" autocomplete="off" />
                <button class="button" type="submit">Search</button>
              </form>
            </li>
            <li>
              <a class="way" href="#elements"><h2>Browse by element</h2><p>Pick an element on the periodic table to see every spectrum that contains it.</p>{GO}</a>
            </li>
            <li class="way-types">
              <a class="way" href="/spectra/"><h2>Browse by type of spectrum</h2><p>All spectra, or one kind at a time:</p>{GO}</a>
              <ul class="types">
                {TYPE_ORDER.map((t) => (
                  <li>
                    <a href={`/spectra/?type=${t}`}><span class={`dot t-${t}`}></span><span class="tl">{TYPE_NAMES[t]}</span><span class="tn">{typeCount[t] ?? 0}</span></a>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <a class="way" href="/submit-data/"><h2>Share your own spectra</h2><p>Upload a file in your browser. Your name stays on every spectrum you share.</p>{GO}</a>
            </li>
          </ul>
        </div>
        <div>
          <div class="ex-head"><h2>Examples from the collection</h2><a href="/spectra/">All spectra</a></div>
          <div class="tiles">
            {tiles.map(({ r, label, plot, author }) => (
              <article class="tile">
                <a class="tile-main" href={`/spectra/${encodeURIComponent(r.slug)}/`} title={r.title}>
                  <h3>{/^[A-Z][A-Za-z0-9]*\d/.test(label) ? <Formula formula={label} /> : label}</h3>
                  <p class="meta"><span><Formula formula={r.formula} /></span> · <span class={`dot t-${r.type}`}></span>{TYPE_NAMES[r.type]}</p>
                  <div class="tile-plot">{plot && <MiniPlotFigure plot={plot} />}</div>
                </a>
                <footer>
                  <a class="by" href={`/author/${author.slug}/`}><Avatar person={author} /><span class="by-name">{author.name}</span></a>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="elements" id="elements">
        <div class="sec-head">
          <div><h2>Browse by element</h2></div>
          <div class="pt-legend">
            <span>1</span>
            <span class="ramp">{[1, 2, 3, 4, 5, 6].map((i) => <span class={`el-${i}`}></span>)}</span>
            <span>{maxCount} spectra</span>
          </div>
        </div>
        <div class="pt" role="group" aria-label="Spectra per element" data-max={maxCount}>
          {TABLE.flatMap((row, r) =>
            row.map((sym, col) => {
              const pos = `grid-row:${r + 1};grid-column:${col + 1}`;
              if (sym === "." || sym === "") return null;
              if (sym.startsWith("*")) return <span class="el el-gap" style={pos} aria-hidden="true">{sym.slice(1)}</span>;
              const n = elTotal(sym);
              if (!n) return <span class="el el-0" style={pos} aria-hidden="true"><b>{sym}</b></span>;
              return (
                <a class={`el el-${shade(n, maxCount)}`} style={pos} href={`/spectra/?element[]=${sym}`} aria-label={`${ELEMENT_NAMES[sym] ?? sym}: ${plural(n)}`}>
                  <b>{sym}</b><s>{n}</s>
                </a>
              );
            }),
          )}
          <div class="pt-gap" style="grid-row:1/4;grid-column:3/13">
            <div class="type-filter" role="group" aria-label="Show spectrum types">
              {TYPE_ORDER.map((t) => (
                <button type="button" class="tf" data-type={t} aria-pressed="true"><span class={`dot t-${t}`}></span>{TYPE_NAMES[t]}</button>
              ))}
            </div>
          </div>
        </div>
        <script type="application/json" id="el-types">{raw(JSON.stringify(elTypes))}</script>
      </section>

      <section class="people">
        <div>
          <h2>Shared by microscopists</h2>
          <p>{total} spectra from {contributors} microscopists, shared since {since}.</p>
          <a class="button" href="/submit-data/">Share a spectrum</a>
        </div>
        <div>
          <div class="faces">
            {faces.map((p) => (
              <a href={`/author/${p.slug}/`} aria-label={`${p.name}: ${plural(p.n)} since ${p.since}`} data-n={p.n} data-since={p.since}>
                <Avatar person={p} />
              </a>
            ))}
          </div>
        </div>
      </section>

      <section class="extras">
        <div>
          <h2>Load spectra in Python</h2>
          <p>HyperSpy and exSpy read the database directly. Each spectrum loads with its acquisition metadata.</p>
          <pre><code><span class="k">import</span> exspy{"\n"}s = exspy.data.eelsdb(element=<span class="s">"Ti"</span>, spectrum_type=<span class="s">"coreloss"</span>)</code></pre>
          <div class="cite-actions">
            <a class="button secondary" href="https://hyperspy.org/">HyperSpy {ARROW}</a>
            <a class="button secondary" href="https://hyperspy.org/exspy/">exSpy {ARROW}</a>
          </div>
        </div>
        <div>
          <h2>How to cite</h2>
          <p>Cite the reference given on each spectrum's page, and the database itself:</p>
          <p class="citation">
            Ewels, P. et al. A complete overhaul of the electron energy-loss spectroscopy and X-ray absorption spectroscopy database: eelsdb.eu.{" "}
            <i>Microscopy and Microanalysis</i> 22, 717–724 (2016).
          </p>
          <div class="cite-actions">
            <button type="button" class="doi" data-copy={DOI} aria-label={`Copy DOI ${DOI}`}>
              <span class="doi-k">DOI</span><code>{DOI}</code>
              <svg class="i-copy" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="6.5" y="6.5" width="10" height="11" rx="1.5" />
                <path d="M13.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h1.5" />
              </svg>
              <svg class="i-done" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 10.5l4 4 8-9" />
              </svg>
              <span class="doi-msg" role="status"></span>
            </button>
            <a class="button secondary" href={`https://doi.org/${DOI}`}>Read the paper {ARROW}</a>
          </div>
        </div>
      </section>
    </Layout>,
  );
}
