import type { Context } from "hono";
import { raw } from "hono/html";
import { avatarUrl, type AppEnv } from "../auth";
import NAMES from "../element-names.json";
import { Avatar as SharedAvatar, EdgeName, Formula, Layout, TYPE_NAMES, plainName } from "./layout";
import { HERO_LOGO_SVG } from "./logo";
import { HyperSpySnippet } from "./snippet";
import { jsonLdScript, schemaOrgCatalog } from "../api/metadata";
import { SITE } from "../site";
import { majorEdges, parseSpectrum } from "../preview";

const ELEMENT_NAMES: Record<string, string> = NAMES;
const TYPE_ORDER = ["coreloss", "lowloss", "xrayabs", "zeroloss"];
const DOI = "10.1017/S1431927616000179";

const EXAMPLE_COUNT = 6;

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

const W = 1000;
const H = 300;
const PAD = 8;

type MiniPlot = { d: string; edges: { x: number; label: string }[] };
// Per-isolate memo of example plots, at most one per published spectrum (a few hundred small paths).
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

const MiniPlotFigure = (props: { plot: MiniPlot }) => (
  <div class="fig">
    {props.plot.edges.map((e) => (
      <span class="edge-lab" style={`left:${((e.x / W) * 100).toFixed(2)}%`}><EdgeName label={e.label} /></span>
    ))}
    <svg class="mini-plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {props.plot.edges.map((e) => <line class="edge" x1={e.x.toFixed(1)} x2={e.x.toFixed(1)} y1="0" y2={H} />)}
      <path class="area" d={`${props.plot.d}L${W},${H}L0,${H}Z`} />
      <path class="line" d={props.plot.d} />
    </svg>
  </div>
);

type Person = { slug: string; name: string; avatar: string | null };

const Avatar = (props: { person: Person }) => <SharedAvatar name={props.person.name} seed={props.person.slug} src={props.person.avatar} />;

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

/** A contributor's picture shows only when they chose to use their Gravatar; an uploaded picture always shows. */
async function person(row: any): Promise<Person> {
  return { slug: row.slug, name: plainName(row.name), avatar: await avatarUrl(row.avatar_key, row.email, row.use_gravatar) };
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
              u.use_gravatar, u.avatar_key,
              (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email
       FROM spectra s LEFT JOIN users u ON u.slug = s.author_slug
       WHERE s.${published} GROUP BY s.author_slug ORDER BY n DESC, name LIMIT 24`,
    ),
    db.prepare(
      `SELECT s.id, s.slug, s.title, s.formula, s.type, s.author_slug AS slug_author, s.author_display,
              u.use_gravatar, u.avatar_key,
              (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email,
              f.r2_key AS file,
              (SELECT json_group_array(e.element) FROM spectrum_elements e WHERE e.spectrum_id = s.id) AS elements
       FROM spectra s LEFT JOIN users u ON u.slug = s.author_slug
       JOIN files f ON f.id = (SELECT id FROM files WHERE spectrum_id = s.id AND role IN ('legacy', 'msa') AND lower(filename) GLOB '*.[mt][sx][at]' ORDER BY role = 'legacy' DESC LIMIT 1)
       WHERE s.${published} AND s.type != 'zeroloss'
       ORDER BY random() LIMIT ${EXAMPLE_COUNT}`,
    ),
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

  const tiles = await Promise.all(
    examples.map(async (r: any) => {
      return {
        r,
        label: r.title,
        plot: r.file ? await miniPlot(c, r.file, JSON.parse(r.elements ?? "[]")) : null,
        author: await person({ slug: r.slug_author, name: r.author_display, use_gravatar: r.use_gravatar, avatar_key: r.avatar_key, email: r.email }),
      };
    }),
  );
  const faces = await Promise.all(people.map(async (p: any) => ({ ...(await person(p)), n: p.n, since: p.since })));

  return c.html(
    <Layout
      user={c.get("user")}
      path="/"
      home
      head={
        <>
          <script src="/home.js" defer></script>
          <script type="application/ld+json">{raw(jsonLdScript(schemaOrgCatalog()))}</script>
        </>
      }
    >
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
                <input id="q" name="q" type="search" placeholder="For example rutile, TiO2 or graphite" autocomplete="off" />
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
                <a class={`el el-${shade(n, maxCount)}`} style={pos} href={`/spectra/?element=${sym}`} aria-label={`${ELEMENT_NAMES[sym] ?? sym}: ${plural(n)}`}>
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
          <p>Every spectrum downloads as an MSA file that HyperSpy reads with its beam energy and angles. The API has the rest.</p>
          <HyperSpySnippet url={`${SITE}/spectra/iron-iii-oxide-hematite/download/msa`} file="hematite.msa" />
          <div class="cite-actions">
            <a class="button secondary" href="/docs/use/python/">Python guide {ARROW}</a>
            <a class="button secondary" href="/docs/use/api/">API {ARROW}</a>
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
