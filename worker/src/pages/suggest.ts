import type { Context } from "hono";
import type { AppEnv } from "../auth";

const like = (s: string) => "%" + s.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%";

/**
 * Spectra for the "associated spectra" and "compare" type-aheads: published ones, and the signed-in user's own pending
 * ones (a core-loss and its low-loss are often submitted together). `q` searches title, formula and slug; `slug`
 * (repeatable) looks spectra up by address, to show the ones already chosen. `overlaps` (a slug) keeps only spectra
 * whose energy range overlaps that spectrum's, those sharing an edge (then an element) with it first, and suggests some without `q`.
 */
export async function suggestSpectra(c: Context<AppEnv>) {
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const slugs = (c.req.queries("slug") ?? []).slice(0, 20);
  const overlaps = c.req.query("overlaps");
  if (!q && !slugs.length && !overlaps) return c.json([]);
  const visible = "(s.status = 'published' OR (s.status = 'pending' AND s.owner_id = ?))";
  const where = [visible];
  const binds: unknown[] = [user?.id ?? -1];
  if (slugs.length) {
    where.push(`s.slug IN (${slugs.map(() => "?").join(",")})`);
    binds.push(...slugs);
  } else if (q) {
    where.push("(s.title LIKE ? ESCAPE '\\' OR s.formula LIKE ? ESCAPE '\\' OR s.slug LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q), like(q));
  }
  const order = [];
  const orderBinds: unknown[] = [];
  if (overlaps) {
    where.push("r.slug = ? AND s.id != r.id AND s.min_energy_ev < r.max_energy_ev AND s.max_energy_ev > r.min_energy_ev");
    binds.push(overlaps);
    order.push(
      "EXISTS (SELECT 1 FROM spectrum_edges a JOIN spectrum_edges b USING (element, edge) WHERE a.spectrum_id = s.id AND b.spectrum_id = r.id) DESC",
      "EXISTS (SELECT 1 FROM spectrum_elements a JOIN spectrum_elements b USING (element) WHERE a.spectrum_id = s.id AND b.spectrum_id = r.id) DESC",
    );
  }
  order.push("s.title LIKE ? ESCAPE '\\' DESC", "s.title COLLATE NOCASE");
  orderBinds.push(q ? q.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%" : "");
  const { results } = await c.env.DB.prepare(
    `SELECT s.slug, s.title, s.formula, s.type, s.status, s.author_display AS author, s.min_energy_ev, s.max_energy_ev
     FROM spectra s${overlaps ? ", spectra r" : ""} WHERE ${where.join(" AND ")} ORDER BY ${order.join(", ")} LIMIT 10`,
  )
    .bind(...binds, ...orderBinds)
    .all();
  return c.json(results, 200, { "Cache-Control": "private, no-store" });
}
