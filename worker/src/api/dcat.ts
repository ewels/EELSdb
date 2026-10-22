// DCAT-AP 3.0 catalogue of the published spectra as JSON-LD, paged the way ckanext-dcat pages its catalogue
// (hydra:PagedCollection), which is what DCAT harvesters such as CKAN's and piveau's follow.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth";
import { API_HOST } from "./format";
import { DCAT_CONTEXT, dcatCatalog, dcatDataset, loadRecords } from "./metadata";

export const DCAT_CATALOG = `${API_HOST}/dcat/catalog.jsonld`;
const PAGE = 100;

const jsonLd = (c: Context, body: unknown, status: 200 | 404 = 200) =>
  c.body(JSON.stringify(body, null, 2), status, { "Content-Type": "application/ld+json; charset=utf-8" });

export const dcat = new Hono<AppEnv>();

dcat.get("/catalog.jsonld", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const total = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE status = 'published'").first<number>("n")) ?? 0;
  const last = Math.max(1, Math.ceil(total / PAGE));
  if (!Number.isInteger(page) || page < 1 || page > last) return jsonLd(c, { error: { code: "not_found", message: `Pages run from 1 to ${last}.` } }, 404);
  const { results } = await c.env.DB.prepare("SELECT id FROM spectra WHERE status = 'published' ORDER BY id LIMIT ? OFFSET ?")
    .bind(PAGE, (page - 1) * PAGE)
    .all<{ id: number }>();
  const records = await loadRecords(c.env.DB, results.map((r) => r.id));
  const at = (n: number) => `${DCAT_CATALOG}?page=${n}`;
  return jsonLd(c, {
    "@context": DCAT_CONTEXT,
    "@graph": [
      dcatCatalog(records.map(dcatDataset)),
      {
        "@id": at(page),
        "@type": "hydra:PagedCollection",
        "hydra:totalItems": total,
        "hydra:itemsPerPage": PAGE,
        "hydra:firstPage": at(1),
        "hydra:lastPage": at(last),
        ...(page < last && { "hydra:nextPage": at(page + 1) }),
        ...(page > 1 && { "hydra:previousPage": at(page - 1) }),
      },
    ],
  });
});

dcat.get("/spectra/:file{\\d+\\.jsonld}", async (c) => {
  const [record] = await loadRecords(c.env.DB, [Number.parseInt(c.req.param("file"))]);
  if (!record) return jsonLd(c, { error: { code: "not_found", message: "No published spectrum with this id." } }, 404);
  return jsonLd(c, { "@context": DCAT_CONTEXT, ...dcatDataset(record) });
});
