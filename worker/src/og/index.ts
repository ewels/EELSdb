import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth";
import { parseSpectrum } from "../preview";
import { authorCard, siteCard, spectrumCard, textCard, type Mini } from "./cards";
import { svgToPng } from "./render";

/** Share cards (og:image), drawn from the page's own data and cached at the edge for a day. */
export const og = new Hono<AppEnv>();
type C = Context<AppEnv>;

// Bump when the card design changes, so cached cards are not served after a deploy.
const VERSION = "2";
const PUBLISHED = "status = 'published'";
const SPECTRUM_FILE = `(SELECT r2_key FROM files WHERE spectrum_id = s.id AND role IN ('legacy', 'msa') AND lower(filename) GLOB '*.[mt][sx][at]' ORDER BY role = 'legacy' DESC LIMIT 1)`;

/** Fixed pages that are not in the docs: their card title and description. */
export const PAGE_CARDS: Record<string, { title: string; description: string; url: string }> = {
  browse: { title: "Browse spectra", description: "Filter by element, edge, type, energy range and resolution.", url: "eelsdb.eu/spectra/" },
  downloads: { title: "Bulk download", description: "Every published spectrum in one archive, with its metadata.", url: "eelsdb.eu/downloads/" },
  moderators: { title: "Moderators", description: "The people who check each submitted spectrum before it is published.", url: "eelsdb.eu/moderators/" },
  news: { title: "News", description: "Archived news from the EELS Data Base.", url: "eelsdb.eu/news/" },
  contact: { title: "Contact", description: "Questions about the EELS Data Base, a spectrum or your account.", url: "eelsdb.eu/contact/" },
};

async function cached(c: C, draw: () => Promise<string | null>) {
  const cache = caches.default;
  const key = new Request(new URL(`${c.req.path}?v=${VERSION}`, c.req.url));
  const hit = await cache.match(key);
  if (hit) return hit;
  const svg = await draw();
  if (!svg) return c.notFound();
  const res = new Response(await svgToPng(svg), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function readSpectrum(c: C, key: string | null) {
  if (!key) return null;
  const object = await c.env.FILES.get(key);
  if (!object) return null;
  const data = parseSpectrum(await object.text());
  return data[0].length > 1 ? data : null;
}

/** Real spectra for the waterfall on text cards: the same core-loss spectra every time, so cards stay stable. */
async function traces(c: C) {
  const { results } = await c.env.DB.prepare(
    `SELECT ${SPECTRUM_FILE} AS file FROM spectra s WHERE ${PUBLISHED} AND type = 'coreloss' ORDER BY id LIMIT 14`,
  ).all<{ file: string | null }>();
  const out = await Promise.all(results.map((r) => readSpectrum(c, r.file)));
  return out.filter((d) => d !== null);
}

og.get("/site.png", (c) => cached(c, async () => site(c)));

async function site(c: C, title?: string) {
  const db = c.env.DB;
  const [{ results: byElement }, stats] = await db.batch<any>([
    db.prepare(`SELECT e.element, COUNT(DISTINCT s.id) AS n FROM spectrum_elements e JOIN spectra s ON s.id = e.spectrum_id WHERE s.${PUBLISHED} GROUP BY e.element`),
    db.prepare(`SELECT COUNT(*) AS spectra, COUNT(DISTINCT author_slug) AS contributors, MIN(substr(published_at, 1, 4)) AS since FROM spectra WHERE ${PUBLISHED}`),
  ]);
  const { spectra, contributors, since } = stats.results[0];
  return siteCard({ spectra, contributors, since, title, elements: Object.fromEntries(byElement.map((r: any) => [r.element, r.n])) });
}

og.get("/page/:file{[a-z-]+\\.png}", (c) =>
  cached(c, async () => {
    const page = PAGE_CARDS[c.req.param("file").slice(0, -4)];
    return page ? textCard({ ...page, traces: await traces(c) }) : null;
  }),
);

og.get("/spectra/:file{.+\\.png}", (c) =>
  cached(c, async () => {
    const slug = c.req.param("file").slice(0, -4);
    const s = await c.env.DB.prepare(
      `SELECT s.slug, s.title, s.formula, s.type, s.author_display, substr(s.published_at, 1, 4) AS year, ${SPECTRUM_FILE} AS file,
              (SELECT json_group_array(e.element) FROM spectrum_elements e WHERE e.spectrum_id = s.id) AS elements
       FROM spectra s WHERE s.slug = ? AND s.${PUBLISHED}`,
    ).bind(slug).first<any>();
    if (!s) return null;
    return spectrumCard({
      title: s.title,
      formula: s.formula,
      type: s.type,
      author: s.author_display,
      year: s.year,
      slug: s.slug,
      elements: JSON.parse(s.elements ?? "[]"),
      data: await readSpectrum(c, s.file),
    });
  }),
);

og.get("/author/:file{.+\\.png}", (c) =>
  cached(c, async () => {
    const slug = c.req.param("file").slice(0, -4);
    const db = c.env.DB;
    const person = await db.prepare("SELECT id, display_name, job_title, affiliation, show_details FROM users WHERE slug = ?").bind(slug).first<any>();
    const { results } = await db.prepare(
      `SELECT s.title, s.formula, s.type, s.author_display, substr(s.published_at, 1, 4) AS year, ${SPECTRUM_FILE} AS file
       FROM spectra s WHERE s.${PUBLISHED} AND (s.author_slug = ? OR s.owner_id = ?) ORDER BY s.published_at DESC, s.id DESC`,
    ).bind(slug, person?.id ?? -1).all<any>();
    // The same test as the author page: no page, no card.
    if (!results.length && !person?.show_details) return null;
    const minis: Mini[] = [];
    for (const r of results.filter((r) => r.type !== "zeroloss")) {
      if (minis.length === 3) break;
      const data = await readSpectrum(c, r.file);
      if (data) minis.push({ title: r.title, formula: r.formula, type: r.type, data });
    }
    const years = results.map((r) => r.year).filter(Boolean).sort();
    return authorCard({
      name: person?.display_name ?? results[0].author_display,
      facts: person?.show_details ? [person.job_title, person.affiliation].filter(Boolean).join(" · ") : "",
      count: results.length,
      since: years[0] ?? null,
      slug,
      spectra: minis,
    });
  }),
);

og.get("/news/:file{.+\\.png}", (c) =>
  cached(c, async () => {
    const post = await c.env.DB.prepare("SELECT slug, title, published_at FROM news WHERE slug = ?").bind(c.req.param("file").slice(0, -4)).first<any>();
    if (!post) return null;
    const date = new Date(post.published_at.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    return textCard({ title: post.title, description: `News · ${date}`, url: `eelsdb.eu/${post.slug}/`, traces: await traces(c) });
  }),
);

const META = (html: string, name: string) =>
  html.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`))?.[1];
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Docs pages are static files; their title and description come from the built page itself.
og.get("/docs/*", (c) =>
  cached(c, async () => {
    const page = c.req.path.replace(/^\/og\/docs\//, "").replace(/(index)?\.png$/, "").replace(/\/+$/, "");
    const path = page && `${page}/`;
    if (path.includes("..")) return null;
    const res = await c.env.ASSETS.fetch(new URL(`/docs/${path}`, c.req.url));
    if (!res.ok) return null;
    const html = await res.text();
    const title = META(html, "og:title");
    if (!title) return null;
    const description = META(html, "og:description") ?? META(html, "description");
    return textCard({ title: decode(title), description: description && decode(description), url: `eelsdb.eu/docs/${path}`, traces: await traces(c) });
  }),
);
