import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { raw } from "hono/html";
import { loadUser, type AppEnv } from "../auth";
import openapiV1 from "../api/openapi-v1.json";
import { openapiV2 } from "../api/v2";
import { MODIFIED_SQL, isoTime } from "../api/dates";
import { SITE } from "../api/format";
import { xml } from "../api/metadata";
import { EXPORT_KEY, serveFile } from "../files";
import { browsePage } from "./browse";
import { Avatar, Formula, Layout, TYPE_NAMES, TypeBadge } from "./layout";
import { homePage } from "./home";
import { admin } from "../admin";
import { contact } from "../contact";
import { instruments } from "../instruments";
import { edit } from "../submit/edit";
import { submit } from "../submit/index";
import { account } from "./account";
import { spectrumPage } from "./spectrum";
import { downloadSpectrum } from "./download";
import { suggestSpectra } from "./suggest";
import { settings } from "./settings";
import { HAS_PAGE_SQL, LINK_FIELDS, STAFF_ROLES, linkText, linkUrl, parseLinks } from "./profile";
import { LinkIcon } from "./link-icons";
import { authorSlug } from "../submit/store";
import { decodeEntities } from "./entities";
import { authorMarkdown, markdownHeaders, newsMarkdown, spectrumMarkdown } from "./markdown";
import { avatarUrl } from "../auth";
import { drafts } from "../submit/drafts";

export const pages = new Hono<AppEnv>();
type C = Context<AppEnv>;

pages.use(csrf());
pages.use(loadUser);
pages.route("/", account);
pages.route("/", settings);
pages.route("/", submit);
pages.route("/", instruments);
pages.route("/", edit);
pages.route("/", drafts);
pages.route("/", admin);
pages.route("/", contact);

const markdown = (render: (db: D1Database, slug: string) => Promise<string | null>) => async (c: C) => {
  const body = await render(c.env.DB, c.req.param("file")!.slice(0, -3));
  return body ? c.body(body, 200, markdownHeaders) : c.notFound();
};
const mdLink = (path: string) => <link rel="alternate" type="text/markdown" href={path} />;

pages.get("/", homePage);
pages.get("/spectra/", browsePage);
pages.get("/spectra", (c) => c.redirect(`/spectra/${new URL(c.req.url).search}`, 301));
// Before the routes that add a missing trailing slash, which would catch "slug.md".
pages.get("/spectra/:file{.+\\.md}", markdown(spectrumMarkdown));
pages.get("/author/:file{.+\\.md}", markdown(authorMarkdown));
pages.get("/search/spectra.json", suggestSpectra);
pages.get("/spectra/:slug/", spectrumPage);
pages.get("/spectra/:slug/download/:format{msa|csv|json}", downloadSpectrum);
pages.get("/spectra/:slug", (c) => c.redirect(`/spectra/${encodeURIComponent(c.req.param("slug"))}/`, 301));
pages.get("/wp-content/uploads/*", serveFile);
pages.get("/files/*", serveFile);
pages.get("/submissions/*", serveFile);

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
          One zip file with every public spectrum: the data files, all metadata in the <a href="/docs/api/v2/">API v2</a> format (including where
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
          Most spectra are open data, under the <a href="https://opendatacommons.org/licenses/odbl/">Open Database License (ODbL)</a>. Please cite the contributors'
          papers and the EELS Data Base (<a href="/docs/about/citation/">how to cite</a>). To fetch selected spectra instead, use the{" "}
          <a href="/docs/use/api/">API</a>.
        </p>
      </div>
    </Layout>,
  );
});

// Old addresses of pages that the docs site (docs-site/) now serves. A fragment such as /about/#cite survives
// the redirect, and the docs About page forwards #cite and #logo to their own pages.
const MOVED: Record<string, string> = {
  "/about/": "/docs/about/",
  "/citation/": "/docs/about/citation/",
  "/logo/": "/docs/about/logo/",
  "/logo": "/docs/about/logo/",
  "/brand/": "/docs/about/logo/",
  "/brand": "/docs/about/logo/",
  "/api/": "/docs/api/v1/",
  "/api/v2/": "/docs/api/v2/",
};
for (const [from, to] of Object.entries(MOVED)) pages.get(from, (c) => c.redirect(to, 301));

pages.get("/api/openapi-v2.json", (c) => c.json(openapiV2()));
pages.get("/api/openapi-v1.json", (c) => c.json(openapiV1));

pages.get("/sitemap.xml", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.slug, ${MODIFIED_SQL} AS modified FROM spectra s WHERE s.status = 'published' ORDER BY s.id`,
  ).all<{ slug: string; modified: string }>();
  const url = (loc: string, modified?: string) => `<url><loc>${xml(loc)}</loc>${modified ? `<lastmod>${isoTime(modified)}</lastmod>` : ""}</url>`;
  const body = [`${SITE}/`, `${SITE}/spectra/`].map((u) => url(u)).concat(results.map((r) => url(`${SITE}/spectra/${encodeURIComponent(r.slug)}/`, r.modified)));
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body.join("\n")}\n</urlset>\n`, 200, {
    "Content-Type": "application/xml; charset=utf-8",
  });
});

const STAFF_GROUPS = [
  { role: "admin", title: "Administrators", about: "Administrators run the site: they manage accounts and roles, and they moderate too." },
  { role: "moderator", title: "Moderators", about: "Moderators check each submitted spectrum before it is published." },
];

pages.get("/moderators/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.slug, u.role, u.use_gravatar, u.avatar_key,
            CASE WHEN u.use_gravatar THEN (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) END AS email
     FROM users u WHERE u.role IN ('moderator', 'admin') ORDER BY u.display_name`,
  ).all<any>();
  // Staff made before every moderator and admin got a username get one here, once, so their names can link to a page.
  const people = await Promise.all(
    results.map(async (u) => ({
      ...u,
      slug: u.slug ?? (await authorSlug(c.env.DB, u)),
      avatar: await avatarUrl(u.avatar_key, u.email, u.use_gravatar),
    })),
  );
  return c.html(
    <Layout user={c.get("user")} title="Moderators" path="/moderators/">
      <div class="prose">
        <h1>Moderators</h1>
        <p class="lede">
          The people who look after the EELS Data Base. To reach them, see <a href="/contact/">Contact</a>.
        </p>
        {people.length ? (
          STAFF_GROUPS.map((g) => {
            const members = people.filter((u) => u.role === g.role);
            return (
              members.length > 0 && (
                <section aria-labelledby={`h-${g.role}`}>
                  <h2 id={`h-${g.role}`}>{g.title}</h2>
                  <p class="muted">{g.about}</p>
                  <ul class="mod-list">
                    {members.map((u) => {
                      const face = (
                        <>
                          <Avatar name={u.display_name} seed={u.slug ?? u.display_name} src={u.avatar} />
                          <span class="by-name">{u.display_name}</span>
                        </>
                      );
                      return <li><a class="by" href={`/author/${u.slug}/`}>{face}</a></li>;
                    })}
                  </ul>
                </section>
              )
            );
          })
        ) : (
          <p class="muted">No moderators yet.</p>
        )}
      </div>
    </Layout>,
  );
});


async function authorPage(c: C) {
  const slug = c.req.param("slug");
  const db = c.env.DB;
  const person = await db.prepare(
    `SELECT u.id, u.display_name, u.job_title, u.affiliation, (SELECT i.subject FROM identities i WHERE i.user_id = u.id AND i.provider = 'orcid') AS orcid, u.links_json, u.use_gravatar, u.show_details, u.show_links, u.avatar_key, u.role,
            CASE WHEN u.use_gravatar THEN (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) END AS email
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
  const showDetails = !!person?.show_details;
  const showLinks = !!person?.show_links;
  const role = STAFF_ROLES[person?.role];
  if (!results.length && !showDetails && !showLinks && !role) return c.notFound();
  const name = person?.display_name ?? results[0].author_display;
  const links = showLinks ? parseLinks(person.links_json) : {};
  const avatar = person ? await avatarUrl(person.avatar_key, person.email, person.use_gravatar) : null;
  const facts = (showDetails ? [person.job_title, person.affiliation] : []).filter(Boolean).join(" · ");
  return c.html(
    <Layout user={c.get("user")} title={name} path="/author/" head={mdLink(`/author/${slug}.md`)}>
      <div class="profile-head">
        <Avatar name={name} seed={slug!} src={avatar?.replace("s=64", "s=160")} class="av-large" />
        <div>
          <h1 class="profile-name">
            {name}
            {role && <span class="chip role-badge" title={`${role} of the EELS Data Base`}>{role}</span>}
          </h1>
          {facts && <p class="lede profile-facts">{facts}</p>}
          {showLinks && (person.orcid || Object.keys(links).length > 0) && (
            <ul class="profile-links">
              {person.orcid && <li><a href={`https://orcid.org/${person.orcid}`} rel="me"><LinkIcon name="orcid" />ORCID {person.orcid}</a></li>}
              {LINK_FIELDS.filter((f) => links[f.key]).map((f) => (
                <li><a href={linkUrl(f.key, links[f.key])} rel="me noopener"><LinkIcon name={f.key} />{linkText(f.key, links[f.key])}</a></li>
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

pages.get("/:file{.+\\.md}", markdown(newsMarkdown));
pages.get("/:slug/", async (c) => {
  const post = await c.env.DB.prepare("SELECT slug, title, published_at, body_html, legacy_v1 FROM news WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<any>();
  if (!post) return c.notFound();
  const author = JSON.parse(post.legacy_v1).author?.name;
  return c.html(
    <Layout user={c.get("user")} title={post.title} path="/news/" head={mdLink(`/${post.slug}.md`)}>
      <article class="prose">
        <p class="small back-link"><a href="/news/">← News</a></p>
        <h1>{post.title}</h1>
        <p class="muted">
          {String(post.published_at).slice(0, 10)}
          {author ? ` · ${author}` : ""}
        </p>
        {/* Recorded from the old site and reduced to simple tags by python/record_news.py. */}
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
