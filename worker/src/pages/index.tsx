import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { raw } from "hono/html";
import { loadUser, type AppEnv } from "../auth";
import openapi from "../api/openapi-v1.json";
import openapiV2 from "../api/openapi-v2.json";
import { serveFile } from "../files";
import { apiDocs } from "./api-docs";
import { browsePage } from "./browse";
import { EELSDB_BIBTEX, EELSDB_CITATION } from "./citation";
import { Formula, Layout, TYPE_NAMES, TypeBadge } from "./layout";
import { HERO_LOGO_SVG } from "./logo";
import { admin } from "../admin";
import { instruments } from "../instruments";
import { edit } from "../submit/edit";
import { submit } from "../submit/index";
import { account } from "./account";
import { spectrumPage } from "./spectrum";

export const pages = new Hono<AppEnv>();
type C = Context<AppEnv>;

pages.use(csrf());
pages.use(loadUser);
pages.route("/", account);
pages.route("/", submit);
pages.route("/", instruments);
pages.route("/", edit);
pages.route("/", admin);

pages.get("/", async (c) => {
  const [{ results: byType }, counts, { results: latest }, { results: news }] = await c.env.DB.batch<any>([
    c.env.DB.prepare("SELECT type, COUNT(*) AS n FROM spectra WHERE status = 'published' GROUP BY type"),
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(DISTINCT e.element) FROM spectrum_elements e JOIN spectra s ON s.id = e.spectrum_id WHERE s.status = 'published') AS elements,
              (SELECT COUNT(DISTINCT author_slug) FROM spectra WHERE status = 'published') AS contributors`,
    ),
    c.env.DB.prepare(
      "SELECT slug, title, type, formula, author_display, author_slug, published_at FROM spectra WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 8",
    ),
    c.env.DB.prepare("SELECT slug, title, published_at FROM news ORDER BY published_at DESC LIMIT 3"),
  ]);
  const n = Object.fromEntries(byType.map((r: any) => [r.type, r.n]));
  const total = byType.reduce((sum: number, r: any) => sum + r.n, 0);
  const { elements, contributors } = counts.results[0];

  return c.html(
    <Layout user={c.get("user")} path="/">
      <div class="hero-logo">{raw(HERO_LOGO_SVG)}</div>
      <div class="home-intro">
        <div>
          <h1>Reference spectra for electron energy-loss and X-ray absorption spectroscopy</h1>
          <p class="lede">
            {total} spectra covering {elements} elements, shared by {contributors} contributors. Browse and plot them here, download the
            files, or load them straight into HyperSpy with <code>exspy.data.eelsdb()</code>.
          </p>
          <form class="quick-search" action="/spectra/" method="get" role="search">
            <input type="search" name="title" aria-label="Search spectra" placeholder="Search, e.g. graphite or BN" />
            <button class="button" type="submit">Search</button>
          </form>
        </div>
        <nav class="counts" aria-label="Spectra by type">
          {Object.entries(TYPE_NAMES).map(([code, name]) => (
            <a href={`/spectra/?type=${code}`}>
              <strong>{n[code] ?? 0}</strong>
              <span>{name}</span>
            </a>
          ))}
          <a class="all" href="/spectra/">
            <strong>{total}</strong>
            <span>All spectra →</span>
          </a>
        </nav>
      </div>
      <div class="home-cols">
        <section>
          <h2>Recently added</h2>
          <div class="table-scroll">
            <table>
              <tbody>
                {latest.map((s: any) => (
                  <tr>
                    <td><TypeBadge type={s.type} /></td>
                    <td><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a></td>
                    <td class="hide-sm"><Formula formula={s.formula} /></td>
                    <td class="num hide-sm">{String(s.published_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>Share your spectra</h2>
          <p>
            Published spectra are welcome. Others can reuse your data and cite your paper. <a href="/submit-data/">How to submit</a>.
          </p>
          <h2>News</h2>
          <ul>
            {news.map((p: any) => (
              <li>
                <a href={`/${p.slug}/`}>{p.title}</a> <span class="muted small">{String(p.published_at).slice(0, 10)}</span>
              </li>
            ))}
          </ul>
          <p><a href="/news/">All news</a></p>
        </section>
      </div>
    </Layout>,
  );
});

pages.get("/spectra/", browsePage);
pages.get("/spectra", (c) => c.redirect(`/spectra/${new URL(c.req.url).search}`, 301));
pages.get("/spectra/:slug/", spectrumPage);
pages.get("/spectra/:slug", (c) => c.redirect(`/spectra/${encodeURIComponent(c.req.param("slug"))}/`, 301));
pages.get("/wp-content/uploads/*", serveFile);
pages.get("/files/*", serveFile);
pages.get("/submissions/*", serveFile);

const EXPORT_KEY = "exports/eelsdb-spectra.zip";

pages.get(`/${EXPORT_KEY}`, async (c) => {
  const object = await c.env.FILES.get(EXPORT_KEY);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
});

pages.get("/downloads/", async (c) => {
  const head = await c.env.FILES.head(EXPORT_KEY);
  return c.html(
    <Layout user={c.get("user")} title="Download everything" path="/downloads/">
      <div class="prose">
        <h1>Download everything</h1>
        <p>
          One zip file with every public spectrum: the data files, all metadata in the <a href="/api/v2/">API v2</a> format (including where
          each acquisition value came from), and a README with the licence and how to cite.
        </p>
        {head ? (
          <p>
            <a class="button" href={`/${EXPORT_KEY}`}>Download eelsdb-spectra.zip</a>{" "}
            <span class="muted">
              {(head.size / 1e6).toFixed(1)} MB, made {head.uploaded.toISOString().slice(0, 10)}
            </span>
          </p>
        ) : (
          <p class="notice">The archive has not been made yet.</p>
        )}
        <p>
          The spectra are open data under the <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a>. Please cite the contributors'
          papers and the EELS Data Base (<a href="/citation/">how to cite</a>). To fetch selected spectra instead, use the{" "}
          <a href="/api/v2/">API</a>.
        </p>
      </div>
    </Layout>,
  );
});

pages.get("/about/", (c) =>
  c.html(
    <Layout user={c.get("user")} title="About" path="/about/">
      <div class="prose">
        <h1>About the EELS Data Base</h1>
        <p class="lede">
          An open-access repository of spectra from electron energy-loss spectroscopy (EELS) and X-ray absorption spectroscopy (XAS)
          experiments.
        </p>
        <p>
          The first version of the database was created in the late 1990s by Virginie Serin (Université Toulouse III, CEMES-CNRS) and
          Thierry Sikora. Thanks to the European microscopy network ESTEEM, they gathered a large number of spectra. Spectroscopists,
          theoreticians, students and companies use it as a reference catalogue for fine structures and for testing data treatment.
        </p>
        <p>
          In 2014 the management of the database passed to Luc Lajaunie (Université de Nantes, Institut des Matériaux Jean Rouxel), and
          Phil Ewels rebuilt the website and the database. The work is described in{" "}
          <a href="https://doi.org/10.1017/S1431927616000179">Ewels et al., Microscopy and Microanalysis 22 (2016)</a>.
        </p>
        <h2>Share your spectra</h2>
        <p>
          We encourage you to submit spectra from your published work. Others can then reuse your data, and cite your paper when they do.
          See <a href="/submit-data/">Submit data</a>.
        </p>
        <h2>Licence</h2>
        <p>
          The spectra are open data under the <a href="https://opendatacommons.org/licenses/odbl/">Open Data Commons Open Database
          Licence (ODbL)</a>. You may copy, share and adapt them if you credit the EELS Data Base and its contributors, and share any
          adapted database under the same licence. The rest of the website is under{" "}
          <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC BY-SA 2.0</a>.
        </p>
        <p>
          Please credit both the contributor's paper (if any) and the EELS Data Base. See <a href="/citation/">How to cite</a>.
        </p>
        <h2>Funding</h2>
        <p>
          The EELS Data Base has been funded by the CEMES and IMN laboratories, the European microscopy network ESTEEM 2, the French
          microscopy network METSA and the French microscopy society SFµ.
        </p>
        <h2>Contact</h2>
        <p>
          Questions, comments and ideas are welcome: see <a href="/contact/">Contact</a>.
        </p>
      </div>
    </Layout>,
  ),
);

pages.get("/citation/", (c) =>
  c.html(
    <Layout user={c.get("user")} title="How to cite" path="/citation/">
      <div class="prose">
        <h1>How to cite</h1>
        <p>
          When you use a spectrum, cite the contributor's original paper (shown on the spectrum's page, if there is one) and the EELS Data
          Base. Every spectrum page has a ready-made citation in its download dialog.
        </p>
        <h2>The EELS Data Base</h2>
        <div class="cite-block"><pre>{EELSDB_CITATION}</pre></div>
        <h3>BibTeX</h3>
        <div class="cite-block"><pre>{EELSDB_BIBTEX}</pre></div>
      </div>
    </Layout>,
  ),
);

pages.get("/contact/", (c) =>
  c.html(
    <Layout user={c.get("user")} title="Contact" path="/contact/">
      <div class="prose">
        <h1>Contact</h1>
        {/* TODO: contact address or form; the old site used a WordPress contact form. */}
        <p class="notice">A contact form will be added here.</p>
        <p>
          Until then, for questions about the database or a spectrum, or to report a problem with the website or the API, open an issue
          on <a href="https://github.com/ewels/EELSdb/issues">GitHub</a>.
        </p>
      </div>
    </Layout>,
  ),
);

pages.get("/api/", (c) =>
  apiDocs(c, openapi, {
    path: "/api/",
    file: "/api/openapi-v1.json",
    intro: (
      <>
        <p class="notice">
          New scripts should use <a href="/api/v2/">API v2</a>: typed values with units in the field names, where each acquisition value
          came from, total counts and paging links. v1 stays as it is for exSpy and older scripts.
        </p>
        <h2>From Python</h2>
        <pre>{`import exspy
spectra = exspy.data.eelsdb(spectrum_type="coreloss", element="Fe")`}</pre>
      </>
    ),
    examples: [
      ["All core-loss spectra", "https://api.eelsdb.eu/spectra/?type=coreloss&per_page=-1"],
      ["Spectra containing both Fe and O", "https://api.eelsdb.eu/spectra/?element[]=Fe&element[]=O"],
      ["One spectrum", "https://api.eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/"],
    ],
  }),
);

pages.get("/api/v2/", (c) =>
  apiDocs(c, openapiV2, {
    path: "/api/",
    file: "/api/openapi-v2.json",
    intro: (
      <>
        <h2>From Python</h2>
        <pre>{`import requests
page = requests.get("https://api.eelsdb.eu/v2/spectra", params={"element": "Fe", "covers_ev": 708}).json()
for s in page["results"]:
    print(s["title"], s["acquisition"]["beam_energy"], s["download_url"])`}</pre>
      </>
    ),
    examples: [
      ["Fe spectra that include 708 eV", "https://api.eelsdb.eu/v2/spectra?element=Fe&covers_ev=708"],
      ["Spectra with beam energy and angles known, newest first", "https://api.eelsdb.eu/v2/spectra?complete=true&sort=published_at&order=desc"],
      ["One spectrum", "https://api.eelsdb.eu/v2/spectra/21751"],
    ],
  }),
);
pages.get("/api/openapi-v2.json", (c) => c.json(openapiV2));
pages.get("/api/openapi-v1.json", (c) => c.json(openapi));

async function authorPage(c: C) {
  const slug = c.req.param("slug");
  const { results } = await c.env.DB.prepare(
    "SELECT slug, title, type, formula, author_display, published_at FROM spectra WHERE status = 'published' AND author_slug = ? ORDER BY published_at DESC, id DESC",
  ).bind(slug).all<any>();
  if (!results.length) return c.notFound();
  const name = results[0].author_display;
  return c.html(
    <Layout user={c.get("user")} title={name} path="/author/">
      <h1>{name}</h1>
      <p class="muted">
        {results.length === 1 ? "1 spectrum" : `${results.length} spectra`} · <a href={`/spectra/?author=${slug}`}>Filter in browse</a>
      </p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>Type</th><th>Title</th><th>Formula</th><th class="num">Added</th></tr>
          </thead>
          <tbody>
            {results.map((s) => (
              <tr>
                <td><TypeBadge type={s.type} /></td>
                <td><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a></td>
                <td><Formula formula={s.formula} /></td>
                <td class="num">{String(s.published_at).slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>,
  );
}
pages.get("/author/:slug/", authorPage);
pages.get("/author/:slug", (c) => c.redirect(`/author/${c.req.param("slug")}/`, 301));

pages.get("/news/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT slug, title, published_at, json_extract(legacy_v1, '$.description') AS summary FROM news ORDER BY published_at DESC",
  ).all<any>();
  const years = results.map((p) => String(p.published_at).slice(0, 4));
  return c.html(
    <Layout user={c.get("user")} title="News" path="/news/">
      <h1>News</h1>
      <p class="muted">
        Archived news from the EELS Data Base, {years.at(-1)} to {years[0]}. Each post shows its summary.
      </p>
      <div class="prose">
        {results.map((p) => (
          <article>
            <h2><a href={`/${p.slug}/`}>{p.title}</a></h2>
            <p class="muted small">{String(p.published_at).slice(0, 10)}</p>
            <p>{p.summary}</p>
          </article>
        ))}
      </div>
    </Layout>,
  );
});

const gone = (c: C) =>
  c.html(
    <Layout user={c.get("user")} title="Removed" path="">
      <div class="prose">
        <h1>This page has been removed</h1>
        <p>
          The forum, jobs board and list of registered users were closed when the EELS Data Base moved to its new website. The spectra
          are all still here: <a href="/spectra/">browse them</a>.
        </p>
      </div>
    </Layout>,
    410,
  );
for (const path of ["/forum", "/forum/*", "/jobs", "/jobs/*", "/registered-users", "/registered-users/"]) pages.get(path, gone);

pages.get("/:slug/", async (c) => {
  const post = await c.env.DB.prepare("SELECT slug, title, published_at, body_html, legacy_v1 FROM news WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<any>();
  if (!post) return c.notFound();
  const author = JSON.parse(post.legacy_v1).author?.name;
  return c.html(
    <Layout user={c.get("user")} title={post.title} path="/news/">
      <article class="prose">
        <p class="small" style="margin-top:1.25rem"><a href="/news/">← News</a></p>
        <h1>{post.title}</h1>
        <p class="muted">
          {String(post.published_at).slice(0, 10)}
          {author ? ` · ${author}` : ""}
        </p>
        {/* Recorded from the old site and reduced to simple tags by eelsdb.legacy.record_news. */}
        <div>{raw(post.body_html ?? "")}</div>
      </article>
    </Layout>,
  );
});

pages.notFound((c) =>
  c.html(
    <Layout user={c.get("user")} title="Not found" path="">
      <div class="prose">
        <h1>Page not found</h1>
        <p>
          There is nothing at this address. Try <a href="/spectra/">browsing the spectra</a> or the <a href="/">home page</a>.
        </p>
      </div>
    </Layout>,
    404,
  ),
);
