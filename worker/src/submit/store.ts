import { mediaType } from "../files";
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

/**
 * Statements that rewrite the rows a text-only edit may change: keywords, links and the reference.
 * Links to other people's spectra are one-way; only the owner's own spectra link back.
 */
export async function textStatements(db: D1Database, id: number, form: ParsedForm, ownerId: number | null) {
  const related = form.associated.length
    ? (
        await db
          .prepare(`SELECT id, slug, owner_id FROM spectra WHERE status IN ('published', 'pending') AND id != ? AND slug IN (${form.associated.map(() => "?").join(",")})`)
          .bind(id, ...form.associated)
          .all<{ id: number; slug: string; owner_id: number | null }>()
      ).results
    : [];
  const own = (r: { owner_id: number | null }) => ownerId !== null && r.owner_id === ownerId;
  const out = [
    ...["spectrum_keywords", "spectrum_other_urls", "reference"].map((t) => db.prepare(`DELETE FROM ${t} WHERE spectrum_id = ?`).bind(id)),
    db.prepare("DELETE FROM spectrum_links WHERE spectrum_id = ?").bind(id),
    db.prepare("DELETE FROM spectrum_links WHERE related_id = ? AND spectrum_id IN (SELECT id FROM spectra WHERE owner_id = ?)").bind(id, ownerId),
    ...form.keywords.map((keyword, position) => insertRow(db, "spectrum_keywords", { spectrum_id: id, keyword, position })),
    ...form.otherUrls.map((u, position) => insertRow(db, "spectrum_other_urls", { spectrum_id: id, ...u, position })),
    ...related.flatMap((r, position) => [
      db.prepare("INSERT OR IGNORE INTO spectrum_links (spectrum_id, related_id, position) VALUES (?, ?, ?)").bind(id, r.id, position),
      ...(own(r)
        ? [
            db.prepare(
              "INSERT OR IGNORE INTO spectrum_links (spectrum_id, related_id, position) VALUES (?, ?, (SELECT COUNT(*) FROM spectrum_links WHERE spectrum_id = ?))",
            ).bind(r.id, id, r.id),
          ]
        : []),
    ]),
  ];
  if (Object.values(form.reference).some((v) => v)) out.push(insertRow(db, "reference", { spectrum_id: id, ...form.reference }));
  return out;
}

/** Statements that rewrite the specimen and measurement rows: elements, edges, acquisition, treatment. */
export function coreStatements(db: D1Database, id: number, form: ParsedForm) {
  const out = [
    db.prepare(
      "UPDATE spectra SET type = ?, phase = ?, intensity_units = ?, formula = ?, completeness = ?, legacy_v1 = NULL, updated_at = datetime('now') WHERE id = ?",
    ).bind(form.spectrum.type, form.spectrum.phase, form.spectrum.intensity_units, form.spectrum.formula,
      completeness(form.spectrum.type, form.acquisition), id),
    ...["spectrum_elements", "spectrum_edges", "eels_acquisition", "xas_acquisition", "treatment"].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE spectrum_id = ?`).bind(id),
    ),
    ...form.elements.map((element, position) => insertRow(db, "spectrum_elements", { spectrum_id: id, element, position })),
    ...form.edges.map((e, position) => insertRow(db, "spectrum_edges", { spectrum_id: id, ...e, position })),
    insertRow(db, "eels_acquisition", { spectrum_id: id, ...form.acquisition }),
    insertRow(db, "treatment", { spectrum_id: id, ...form.treatment }),
  ];
  if (form.xas) out.push(insertRow(db, "xas_acquisition", { spectrum_id: id, ...form.xas }));
  return out;
}

/** Title, description and source: the spectra columns a text-only edit may change. */
export const textColumnsStatement = (db: D1Database, id: number, form: ParsedForm) =>
  db.prepare("UPDATE spectra SET title = ?, description = ?, source_purity = ?, legacy_v1 = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(form.spectrum.title, form.spectrum.description, form.spectrum.source_purity, id);

/** Statements that rewrite every typed row of a spectrum except its title, description and source. */
export async function detailStatements(db: D1Database, id: number, form: ParsedForm, ownerId: number | null) {
  return [...coreStatements(db, id, form), ...(await textStatements(db, id, form, ownerId))];
}

/** A pending instrument profile choice must name an approved version. */
export async function instrumentOk(db: D1Database, form: ParsedForm) {
  if (!form.instrument) return true;
  return (await db.prepare("SELECT 1 FROM instrument_versions WHERE instrument_id = ? AND version = ? AND status = 'approved'")
    .bind(form.instrument.id, form.instrument.version).first()) !== null;
}

export async function createSpectrum(
  db: D1Database,
  form: ParsedForm,
  owner: { id: number; display_name: string; slug: string | null },
  status: "pending" | "draft" = "pending",
): Promise<{ id: number; slug: string }> {
  const slug = await uniqueSlug(db, form.spectrum.title);
  const authorSlugValue = await authorSlug(db, owner);
  const id = (await insertRow(db, "spectra", {
    slug,
    status,
    ...form.spectrum,
    technique: form.spectrum.type === "xrayabs" ? "xas" : "eels",
    owner_id: owner.id,
    author_display: owner.display_name,
    author_slug: authorSlugValue,
    licence: "ODbL-1.0",
    completeness: completeness(form.spectrum.type, form.acquisition),
  }).run()).meta.last_row_id;
  try {
    await db.batch(await detailStatements(db, id, form, owner.id));
  } catch (e) {
    // The spectra row was written on its own; do not leave it behind without its details.
    await db.prepare("DELETE FROM spectra WHERE id = ?").bind(id).run();
    throw e;
  }
  return { id, slug };
}

/** Puts an uploaded file in R2 under the submission and returns the statement that records it. */
export async function storeFile(env: { DB: D1Database; FILES: R2Bucket }, id: number, role: string, f: File, variant?: string) {
  const bytes = await f.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `submissions/${id}/${variant ? `variant-${variant}` : role}/${f.name.replace(/[^\w.\-]+/g, "_")}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mediaType(f.name) }, sha256 });
  return env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, media_type, bytes, sha256, variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, role, key, f.name, mediaType(f.name), f.size, sha256, variant ?? null);
}
