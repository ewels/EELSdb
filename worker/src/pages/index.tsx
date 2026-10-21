import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { raw } from "hono/html";
import { loadUser, type AppEnv } from "../auth";
import openapi from "../api/openapi-v1.json";
import openapiV2 from "../api/openapi-v2.json";
import { serveFile } from "../files";
import { apiDocs } from "./api-docs";
import { brand } from "./brand";
import { browsePage } from "./browse";
import { EELSDB_BIBTEX, EELSDB_CITATION } from "./citation";
import { Avatar, COPY_SCRIPT, Formula, Layout, TYPE_NAMES, TypeBadge } from "./layout";
import { homePage } from "./home";
import { admin } from "../admin";
import { instruments } from "../instruments";
import { edit } from "../submit/edit";
import { submit } from "../submit/index";
import { account } from "./account";
import { spectrumPage } from "./spectrum";
import { settings } from "./settings";
import { LINK_FIELDS, linkUrl, parseLinks } from "./profile";
import { avatarUrl } from "../auth";

export const pages = new Hono<AppEnv>();
type C = Context<AppEnv>;

pages.use(csrf());
pages.use(loadUser);
pages.route("/", account);
pages.route("/", settings);
pages.route("/", submit);
pages.route("/", instruments);
pages.route("/", edit);
pages.route("/", admin);
pages.route("/", brand);

pages.get("/", homePage);
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
    <Layout user={c.get("user")} title="Bulk download" path="/downloads/">
      <div class="prose">
        <h1>Bulk download</h1>
        <p>
          One zip file with every public spectrum: the data files, all metadata in the <a href="/api/v2/">API v2</a> format (including where
          each acquisition value came from), and a README with the licence and how to cite.
        </p>
        {head ? (
          <p class="download-row">
            <a class="button" href={`/${EXPORT_KEY}`}>Download eelsdb-spectra.zip</a>
            <span class="muted small">
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

const PARTNERS = [
  ["CNRS", "https://www.cnrs.fr/", "cnrs.svg"],
  ["IMN, Institut des Matériaux Jean Rouxel", "http://www.cnrs-imn.fr/", "imn.gif"],
  ["CEMES", "https://www.cemes.fr/", "cemes.png"],
  ["ESTEEM 2", "https://cordis.europa.eu/project/id/312483", "esteem2.png"],
  ["METSA", "https://www.metsa.fr/", "metsa.png"],
  ["SFµ, Société Française des Microscopies", "https://sfmu.fr/", "sfmu.png"],
] as const;

const DOI = "10.1017/S1431927616000179";

// Old links to the sections these pages replaced.
const ABOUT_HASHES = `var t={"#cite":"/citation/","#logo":"/logo/"}[location.hash];if(t)location.replace(t)`;

pages.get("/about/", (c) =>
  c.html(
    <Layout user={c.get("user")} title="About EELSdb" path="/about/" head={<script>{raw(ABOUT_HASHES)}</script>}>
      <div class="about">
        <div class="prose">
          <h1>About EELSdb</h1>
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
        </div>
        <section class="prose" id="share">
          <h2>Share your spectra</h2>
          <p>
            We encourage you to submit spectra from your published work. Others can then reuse your data, and cite your paper when they do.
            See <a href="/submit-data/">Submit data</a>.
          </p>
        </section>
        <section class="prose" id="licence">
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
        </section>
        <section class="prose" id="support">
          <h2>Support</h2>
          <p>
            The IMN laboratory and the CNRS support the EELS Data Base. It was funded by the CEMES laboratory, the European microscopy
            network ESTEEM 2, the French microscopy network METSA and the French microscopy society SFµ.
          </p>
          <ul class="partners">
            {PARTNERS.map(([name, href, src]) => (
              <li><a href={href}><img src={`/partners/${src}`} alt={name} loading="lazy" /></a></li>
            ))}
          </ul>
        </section>
        <section class="prose" id="contact">
          <h2>Contact</h2>
          <p>
            Questions, comments and ideas are welcome: see <a href="/contact/">Contact</a>.
          </p>
        </section>
      </div>
    </Layout>,
  ),
);

pages.get("/citation/", (c) =>
  c.html(
    <Layout user={c.get("user")} title="How to cite" path="/citation/">
      <div class="prose cite-page">
        <h1>How to cite</h1>
        <p>
          Cite the contributor's paper, shown on each spectrum's page, and the EELS Data Base. Each spectrum's download dialog has a
          ready-made citation. For the EELS Data Base:
        </p>
        <p class="citation" id="cite-text">
          Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie. A complete overhaul of the electron energy-loss
          spectroscopy and X-ray absorption spectroscopy database: eelsdb.eu. <i>Microscopy and Microanalysis</i> 22, 717–724 (2016).
        </p>
        <div class="cite-actions">
          <button type="button" class="doi" data-copy={DOI} data-select="cite-doi" aria-label={`Copy DOI ${DOI}`}>
            <span class="doi-k">DOI</span><code id="cite-doi">{DOI}</code>
            <svg class="i-copy" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="6.5" y="6.5" width="10" height="11" rx="1.5" />
              <path d="M13.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h1.5" />
            </svg>
            <svg class="i-done" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 10.5l4 4 8-9" />
            </svg>
            <span class="doi-msg copy-label" role="status"></span>
          </button>
          <button type="button" class="button secondary" data-copy={EELSDB_CITATION} data-select="cite-text">
            <span class="copy-label" role="status">Copy citation</span>
          </button>
          <a class="button secondary" href={`https://doi.org/${DOI}`}>Read the paper</a>
        </div>
        <h2>BibTeX</h2>
        <pre id="cite-bib">{EELSDB_BIBTEX}</pre>
        <div class="cite-actions">
          <button type="button" class="button secondary" data-copy={EELSDB_BIBTEX} data-select="cite-bib">
            <span class="copy-label" role="status">Copy BibTeX</span>
          </button>
        </div>
      </div>
      <script>{raw(COPY_SCRIPT)}</script>
    </Layout>,
  ),
);

const ROLE_NAMES: Record<string, string> = { admin: "Administrator", moderator: "Moderator" };

pages.get("/moderators/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.slug, u.role, u.profile_public, u.avatar_key,
            CASE WHEN u.profile_public THEN (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) END AS email,
            u.slug IS NOT NULL AND (u.profile_public OR EXISTS (
              SELECT 1 FROM spectra s WHERE s.status = 'published' AND (s.author_slug = u.slug OR s.owner_id = u.id)
            )) AS has_page
     FROM users u WHERE u.role IN ('moderator', 'admin') ORDER BY u.display_name`,
  ).all<any>();
  const people = await Promise.all(
    results.map(async (u) => ({ ...u, avatar: u.profile_public ? await avatarUrl(u.avatar_key, u.email) : null })),
  );
  return c.html(
    <Layout user={c.get("user")} title="Moderators" path="/moderators/">
      <div class="prose">
        <h1>Moderators</h1>
        <p class="lede">
          Moderators check each submitted spectrum before it is published. To reach them, see <a href="/contact/">Contact</a>.
        </p>
        {people.length ? (
          <ul class="mod-list">
            {people.map((u) => {
              const face = (
                <>
                  <Avatar name={u.display_name} seed={u.slug ?? u.display_name} src={u.avatar} />
                  <span class="by-name">{u.display_name}</span>
                </>
              );
              return (
                <li>
                  {u.has_page ? <a class="by" href={`/author/${u.slug}/`}>{face}</a> : <span class="by">{face}</span>}
                  <span class="muted">{ROLE_NAMES[u.role]}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="muted">No moderators yet.</p>
        )}
      </div>
    </Layout>,
  );
});

pages.get("/contact/", (c) =>
  c.html(
    <Layout user={c.get("user")} title="Contact" path="/contact/">
      <div class="prose">
        <h1>Contact</h1>
        {/* TODO: contact address or form; the old site used a WordPress contact form. */}
        <p>
          For questions about the database or a spectrum, or to report a problem with the website or the API, open an issue on GitHub.
        </p>
        <p><a class="button secondary" href="https://github.com/ewels/EELSdb/issues">Open an issue</a></p>
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
  const db = c.env.DB;
  const person = await db.prepare(
    `SELECT u.id, u.display_name, u.job_title, u.affiliation, u.orcid, u.links_json, u.profile_public, u.avatar_key,
            (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email
     FROM users u WHERE u.slug = ?`,
  ).bind(slug).first<any>();
  if (!person) {
    const renamed = await db.prepare("SELECT u.slug FROM user_slug_history h JOIN users u ON u.id = h.user_id WHERE h.slug = ?").bind(slug).first<string>("slug");
    if (renamed) return c.redirect(`/author/${renamed}/`, 301);
  }
  const { results } = await db.prepare(
    `SELECT slug, title, type, formula, author_display, published_at FROM spectra
     WHERE status = 'published' AND (author_slug = ? OR owner_id = ?) ORDER BY published_at DESC, id DESC`,
  ).bind(slug, person?.id ?? -1).all<any>();
  const showProfile = !!person?.profile_public;
  if (!results.length && !showProfile) return c.notFound();
  const name = person?.display_name ?? results[0].author_display;
  const links = showProfile ? parseLinks(person.links_json) : {};
  const avatar = showProfile ? await avatarUrl(person.avatar_key, person.email) : null;
  const facts = showProfile ? [person.job_title, person.affiliation].filter(Boolean).join(" · ") : "";
  return c.html(
    <Layout user={c.get("user")} title={name} path="/author/">
      <div class="profile-head">
        <Avatar name={name} seed={slug!} src={avatar?.replace("s=64", "s=160")} class="av-large" />
        <div>
          <h1>{name}</h1>
          {facts && <p class="lede profile-facts">{facts}</p>}
          {showProfile && (person.orcid || Object.keys(links).length > 0) && (
            <ul class="profile-links">
              {person.orcid && <li><a href={`https://orcid.org/${person.orcid}`} rel="me">ORCID {person.orcid}</a></li>}
              {LINK_FIELDS.filter((f) => links[f.key]).map((f) => (
                <li><a href={linkUrl(f.key, links[f.key])} rel="me noopener">{f.label}</a></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {results.length ? (
        <>
          <h2>Contributed spectra</h2>
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
                    <td class="title"><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a></td>
                    <td class="formula-cell"><Formula formula={s.formula} /></td>
                    <td class="num">{String(s.published_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p class="muted">No published spectra yet.</p>
      )}
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
      <div class="prose">
        <h1>News</h1>
        <p class="lede">
          Archived news from the EELS Data Base, {years.at(-1)} to {years[0]}.
        </p>
        <div class="news-list">
          {results.map((p) => (
            <article>
              <h2><a href={`/${p.slug}/`}>{p.title}</a></h2>
              <p class="muted small">{String(p.published_at).slice(0, 10)}</p>
              <p>{decodeEntities(p.summary ?? "")}</p>
            </article>
          ))}
        </div>
      </div>
    </Layout>,
  );
});

/** Legacy WordPress excerpts hold HTML entities such as &#8217; and a trailing "[&hellip;]". */
export function decodeEntities(s: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0", hellip: "…" };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, k) => named[k.toLowerCase()] ?? m)
    .replace(/\s*\[…\]$/, "…");
}

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
        <p class="small back-link"><a href="/news/">← News</a></p>
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
