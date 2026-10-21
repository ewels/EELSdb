import type { Context } from "hono";
import type { AppEnv } from "../auth";

const like = (s: string) => "%" + s.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%";

/**
 * Spectra for the "associated spectra" type-ahead: published ones, and the signed-in user's own pending ones (a
 * core-loss and its low-loss are often submitted together). `q` searches title, formula and slug; `slug` (repeatable)
 * looks spectra up by address, to show the ones already chosen.
 */
export async function suggestSpectra(c: Context<AppEnv>) {
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const slugs = (c.req.queries("slug") ?? []).slice(0, 20);
  if (!q && !slugs.length) return c.json([]);
  const visible = "(s.status = 'published' OR (s.status = 'pending' AND s.owner_id = ?))";
  const match = slugs.length
    ? `s.slug IN (${slugs.map(() => "?").join(",")})`
    : "(s.title LIKE ? ESCAPE '\\' OR s.formula LIKE ? ESCAPE '\\' OR s.slug LIKE ? ESCAPE '\\')";
  const { results } = await c.env.DB.prepare(
    `SELECT s.slug, s.title, s.formula, s.type, s.status, s.author_display AS author FROM spectra s WHERE ${visible} AND ${match}
     ORDER BY s.title LIKE ? ESCAPE '\\' DESC, s.title COLLATE NOCASE LIMIT 10`,
  )
    .bind(user?.id ?? -1, ...(slugs.length ? slugs : [like(q), like(q), like(q)]), q ? q.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%" : "")
    .all();
  return c.json(results, 200, { "Cache-Control": "private, no-store" });
}
