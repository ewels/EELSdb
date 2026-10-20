import type { ParsedForm } from "./form";
import { completeness, slugify } from "./form";

/** A slug not used by any spectrum: "bn", then "bn-2", "bn-3"… */
export async function uniqueSlug(db: D1Database, title: string, table = "spectra", column = "slug") {
  const base = slugify(title);
  const { results } = await db.prepare(`SELECT ${column} AS s FROM ${table} WHERE ${column} = ? OR ${column} LIKE ?`).bind(base, `${base}-%`).all<{ s: string }>();
  const taken = new Set(results.map((r) => r.s));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The contributor's public profile slug, created on their first submission. */
export async function authorSlug(db: D1Database, user: { id: number; display_name: string; slug: string | null }) {
  if (user.slug) return user.slug;
  let slug = slugify(user.display_name);
  const taken = async (s: string) =>
    (await db.prepare("SELECT 1 FROM users WHERE slug = ? UNION SELECT 1 FROM spectra WHERE author_slug = ?").bind(s, s).first()) !== null;
  for (let n = 2; await taken(slug); n++) slug = `${slugify(user.display_name)}-${n}`;
  await db.prepare("UPDATE users SET slug = ? WHERE id = ?").bind(slug, user.id).run();
  return slug;
}

const insertRow = (db: D1Database, table: string, row: Record<string, unknown>) => {
  const keys = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((k) => row[k] ?? null));
};

/** Statements that rewrite the rows a text-only edit may change: keywords, links and the reference. */
export async function textStatements(db: D1Database, id: number, form: ParsedForm) {
  const related = form.associated.length
    ? (
        await db
          .prepare(`SELECT id, slug FROM spectra WHERE slug IN (${form.associated.map(() => "?").join(",")})`)
          .bind(...form.associated.map((s) => decodeURIComponent(s)))
          .all<{ id: number; slug: string }>()
      ).results
    : [];
  const out = [
    ...["spectrum_keywords", "spectrum_other_urls", "reference"].map((t) => db.prepare(`DELETE FROM ${t} WHERE spectrum_id = ?`).bind(id)),
    db.prepare("DELETE FROM spectrum_links WHERE spectrum_id = ? OR related_id = ?").bind(id, id),
    ...form.keywords.map((keyword, position) => insertRow(db, "spectrum_keywords", { spectrum_id: id, keyword, position })),
    ...form.otherUrls.map((u, position) => insertRow(db, "spectrum_other_urls", { spectrum_id: id, ...u, position })),
    // Associated spectra are kept reciprocal.
    ...related.flatMap((r, position) => [
      db.prepare("INSERT OR IGNORE INTO spectrum_links (spectrum_id, related_id, position) VALUES (?, ?, ?)").bind(id, r.id, position),
      db.prepare(
        "INSERT OR IGNORE INTO spectrum_links (spectrum_id, related_id, position) VALUES (?, ?, (SELECT COUNT(*) FROM spectrum_links WHERE spectrum_id = ?))",
      ).bind(r.id, id, r.id),
    ]),
  ];
  if (Object.values(form.reference).some((v) => v)) out.push(insertRow(db, "reference", { spectrum_id: id, ...form.reference }));
  return out;
}

/** Statements that rewrite every typed row of a spectrum except the spectra row itself. */
export async function detailStatements(db: D1Database, id: number, form: ParsedForm) {
  const out = [
    ...["spectrum_elements", "spectrum_edges", "eels_acquisition", "xas_acquisition", "treatment"].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE spectrum_id = ?`).bind(id),
    ),
    ...form.elements.map((element, position) => insertRow(db, "spectrum_elements", { spectrum_id: id, element, position })),
    ...form.edges.map((e, position) => insertRow(db, "spectrum_edges", { spectrum_id: id, ...e, position })),
    insertRow(db, "eels_acquisition", { spectrum_id: id, ...form.acquisition }),
    insertRow(db, "treatment", { spectrum_id: id, ...form.treatment }),
    ...(await textStatements(db, id, form)),
  ];
  if (form.spectrum.type === "xrayabs") out.push(insertRow(db, "xas_acquisition", { spectrum_id: id, beamline: form.acquisition.microscope }));
  return out;
}

export async function createSpectrum(
  db: D1Database,
  form: ParsedForm,
  owner: { id: number; display_name: string; slug: string | null },
): Promise<{ id: number; slug: string }> {
  const slug = await uniqueSlug(db, form.spectrum.title);
  const authorSlugValue = await authorSlug(db, owner);
  const id = (await insertRow(db, "spectra", {
    slug,
    status: "pending",
    ...form.spectrum,
    technique: form.spectrum.type === "xrayabs" ? "xas" : "eels",
    intensity_units: "counts",
    owner_id: owner.id,
    author_display: owner.display_name,
    author_slug: authorSlugValue,
    licence: "ODbL-1.0",
    completeness: completeness(form.spectrum.type, form.acquisition),
  }).run()).meta.last_row_id;
  await db.batch(await detailStatements(db, id, form));
  return { id, slug };
}
