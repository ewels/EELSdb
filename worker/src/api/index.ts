import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth";
import { API_HOST, SITE, formatV1, loadBundle } from "./format";
import { cli } from "./moderation";
import { ORDER_META_KEYS, buildSpectraQuery, firstUnknownArg, parseParams, sortAndPage, type SpectrumRow } from "./query";

export const api = new Hono<AppEnv>();

const DOCS = `${SITE}/api/`;
const NEWS_PER_PAGE = 10;

const json = (c: Context, body: unknown, status: 200 | 400 | 404 = 200) =>
  c.body(JSON.stringify(body, null, 4), status, { "Content-Type": "application/json; charset=utf-8" });
const notFound = (c: Context) => json(c, { message: "API path not recognised", documentation_url: DOCS }, 404);

api.use(async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", "*");
});

const INDEX = {
  api_home: { url: API_HOST },
  api_documentation: { url: DOCS },
  browse_news: { url: `${API_HOST}/news/` },
  news: { url: `${API_HOST}/{post_slug}/` },
  list_users: { url: `${API_HOST}/registered-users/` },
  user: { url: `${API_HOST}/author/{user}/` },
  browse_spectra: {
    url: `${API_HOST}/spectra/`,
    arguments: {
      type: "[ coreloss | lowloss | zeroloss | xrayabs ]",
      title: "string",
      author: "string",
      element: "string",
      formula: "string",
      edge: ["K", "L1", "L2,3", "M2,3", "M4,5", "N2,3", "N4,5", "O2,3", "O4,5"],
      min_energy: "float",
      min_energy_compare: ["lt", "eq", "ge"],
      max_energy: "float",
      max_energy_compare: ["lt", "eq", "ge"],
      resolution: "float",
      resolution_compare: ["lt", "eq", "ge"],
      monochromated: "flag",
      per_page: "int",
      page: "int",
      order: ORDER_META_KEYS,
      order_direction: ["ASC", "DESC"],
    },
  },
  spectrum: { url: `${API_HOST}/spectra/{spectrum}` },
};

api.route("/cli", cli);

api.get("/", (c) => json(c, INDEX));
api.get("/index.php", (c) => json(c, INDEX));

async function spectrumObject(db: D1Database, row: { id: number; legacy_v1: string | null }) {
  if (row.legacy_v1) return JSON.parse(row.legacy_v1);
  const bundle = await loadBundle(db, row.id);
  return bundle && formatV1(bundle);
}

async function listSpectra(c: Context<AppEnv>) {
  const params = parseParams(new URL(c.req.url).search);
  const unknown = firstUnknownArg(params);
  if (unknown !== undefined) {
    return json(c, { message: `Query argument '${unknown}' not recognised`, documentation_url: DOCS }, 400);
  }
  const q = buildSpectraQuery(params);
  const { results: all } = await c.env.DB.prepare(q.sql).bind(...q.binds).all<SpectrumRow>();
  const results = sortAndPage(all, q);
  // WordPress answered an empty page after the first with its 404.
  if (!results.length && q.page > 1) return notFound(c);
  return json(c, await Promise.all(results.map((r) => spectrumObject(c.env.DB, r))));
}

async function oneSpectrum(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare("SELECT id, legacy_v1 FROM spectra WHERE slug = ? AND status = 'published'")
    .bind(c.req.param("slug"))
    .first<{ id: number; legacy_v1: string | null }>();
  return row ? json(c, await spectrumObject(c.env.DB, row)) : notFound(c);
}

api.get("/spectra", listSpectra);
api.get("/spectra/", listSpectra);
api.get("/spectra/:slug", oneSpectrum);
api.get("/spectra/:slug/", oneSpectrum);

async function listNews(c: Context<AppEnv>) {
  const page = Math.max(1, Number(c.req.param("page") ?? 1) || 1);
  const { results } = await c.env.DB.prepare("SELECT legacy_v1 FROM news ORDER BY legacy_rank LIMIT ? OFFSET ?")
    .bind(NEWS_PER_PAGE, (page - 1) * NEWS_PER_PAGE)
    .all<{ legacy_v1: string }>();
  return results.length ? json(c, results.map((r) => JSON.parse(r.legacy_v1))) : notFound(c);
}
api.get("/news/", listNews);
api.get("/news/page/:page/", listNews);

type Contributor = { slug: string; name: string; num_spectra: number; orcid: string | null };

/** Contributors only, and no personal fields: unlike the old API, no email, address or social IDs. */
function contributorObject(u: Contributor) {
  const profile = `${SITE}/author/${u.slug}/`;
  const out: Record<string, unknown> = {
    name: u.name,
    profile_url: profile,
    profile_api_url: profile.replace("://", "://api."),
    spectra_api_url: `${API_HOST}/spectra/?author=${u.slug}`,
    spectra_url: profile,
    num_spectra: u.num_spectra,
  };
  if (u.orcid) out.orcid = `https://orcid.org/${u.orcid}`;
  return out;
}

export const CONTRIBUTORS_SQL = `
  SELECT s.author_slug AS slug, MAX(COALESCE(u.display_name, s.author_display)) AS name,
         COUNT(*) AS num_spectra, MAX(u.orcid) AS orcid
  FROM spectra s LEFT JOIN users u ON u.id = s.owner_id
  WHERE s.status = 'published' AND s.author_slug IS NOT NULL`;

api.get("/registered-users/", async (c) => {
  const { results } = await c.env.DB.prepare(`${CONTRIBUTORS_SQL} GROUP BY s.author_slug ORDER BY name COLLATE NOCASE`).all<Contributor>();
  return json(c, results.map(contributorObject));
});

async function oneContributor(c: Context<AppEnv>) {
  const u = await c.env.DB.prepare(`${CONTRIBUTORS_SQL} AND s.author_slug = ? GROUP BY s.author_slug`)
    .bind(c.req.param("slug"))
    .first<Contributor>();
  return u ? json(c, contributorObject(u)) : notFound(c);
}
api.get("/author/:slug/", oneContributor);
api.get("/author/:slug", oneContributor);

async function oneNews(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare("SELECT legacy_v1 FROM news WHERE slug = ?").bind(c.req.param("slug")).first<{ legacy_v1: string }>();
  return row ? json(c, JSON.parse(row.legacy_v1)) : notFound(c);
}
api.get("/:slug/", oneNews);

api.notFound(notFound);
