import { Hono, type Context } from "hono";
import { loadBundle, type SpectrumBundle } from "../api/format";
import { requireUser, type AppEnv } from "../auth";
import { isModerator } from "../instruments";
import { SPECTRUM_EXTENSIONS, XAS_FIELDS, checkUpload, completeness, parseForm, type ParsedForm } from "./form";
import { SubmitPage, approvedInstruments, formValues } from "./index";
import { Layout } from "../pages/layout";
import { detailStatements, textStatements } from "./store";

export const edit = new Hono<AppEnv>();
type C = Context<AppEnv>;
type Values = Record<string, string>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The form values that reproduce a spectrum's stored rows. */
export function valuesFromBundle(b: SpectrumBundle): Values {
  const s = b.spectrum;
  const a = b.acquisition ?? {};
  const t = b.treatment ?? {};
  const r = b.reference ?? {};
  const v: Values = {
    title: s.title,
    type: s.type,
    phase: s.phase,
    intensity_units: s.intensity_units,
    formula: str(s.formula),
    elements: b.elements.join(", "),
    edges: b.edges.map((e) => `${e.element}_${e.edge}`).join("; "),
    keywords: b.keywords.join(", "),
    source_purity: str(s.source_purity),
    description: str(s.description),
    other_urls: b.otherUrls.map((u) => [u.url, u.title].filter(Boolean).join(" ")).join("\n"),
    associated: b.links.map((l) => l.slug).join(" "),
    instrument: a.instrument_profile_id ? `${a.instrument_profile_id}:${a.instrument_profile_version}` : "",
  };
  for (const k of ["microscope", "gun_type", "acquisition_mode", "detector", "resolution_ev", "probe_size_nm2", "beam_current", "integration_time_s", "readouts", "dispersion_ev", "monochromated"]) {
    v[k] = str(a[k]);
  }
  for (const k of ["dark_current", "gain_variation", "calibration", "thickness_t_lambda", "deconv_other"]) v[k] = str(t[k]);
  for (const k of ["deconv_fourier_log", "deconv_fourier_ratio", "deconv_stephens", "deconv_richardson_lucy", "deconv_maximum_entropy"]) {
    if (Number(t[k])) v[k] = "1";
  }
  for (const k of XAS_FIELDS) v[`xas_${k}`] = str(b.xas?.[k]);
  for (const k of ["doi", "url", "authors", "journal", "volume", "issue", "page", "year", "title", "freetext"]) v[`ref_${k}`] = str(r[k]);

  const kv = a.beam_energy_kv;
  if (a.beam_energy_source === "unknown" || kv === null || kv === undefined) v.beam_energy_choice = "unknown";
  else if ([60, 80, 120, 200, 300].includes(kv) && a.beam_energy_source !== "estimate") v.beam_energy_choice = String(kv);
  else Object.assign(v, { beam_energy_choice: "other", beam_energy: String(kv) });
  for (const [key, col] of [["beam_energy", "beam_energy"], ["convergence", "convergence"], ["collection", "collection"]] as const) {
    const source = a[`${col}_source`];
    const value = col === "beam_energy" ? a.beam_energy_kv : a[`${col}_mrad`];
    if (col !== "beam_energy") {
      if (source === "unknown" || value === null || value === undefined) v[`${key}_unknown`] = "1";
      else v[key] = String(value);
    }
    if (source === "estimate") v[`${key}_approx`] = "1";
    if (a[`${col}_uncertainty`] != null) v[`${key}_uncertainty`] = String(a[`${col}_uncertainty`]);
    if (source && !["unknown", "estimate"].includes(source)) v[`${key}_source`] = source;
  }
  return v;
}

/** Changes that need a moderator: the data, the specimen or how it was measured. */
const core = (f: ParsedForm) =>
  JSON.stringify({
    type: f.spectrum.type,
    phase: f.spectrum.phase,
    intensity_units: f.spectrum.intensity_units,
    xas: f.xas,
    formula: f.spectrum.formula,
    elements: f.elements,
    edges: f.edges,
    acquisition: f.acquisition,
    treatment: f.treatment,
  });

function textChanges(before: ParsedForm, after: ParsedForm) {
  const pairs: Record<string, [unknown, unknown]> = {
    title: [before.spectrum.title, after.spectrum.title],
    description: [before.spectrum.description, after.spectrum.description],
    source_purity: [before.spectrum.source_purity, after.spectrum.source_purity],
    keywords: [before.keywords, after.keywords],
    other_urls: [before.otherUrls, after.otherUrls],
    associated: [before.associated, after.associated],
    reference: [before.reference, after.reference],
  };
  return Object.fromEntries(Object.entries(pairs).filter(([, [x, y]]) => JSON.stringify(x) !== JSON.stringify(y)));
}

async function editable(c: C) {
  const user = c.get("user")!;
  const row = await c.env.DB.prepare("SELECT id, owner_id, status FROM spectra WHERE slug = ?").bind(c.req.param("slug")).first<any>();
  if (!row || !["published", "pending"].includes(row.status)) return null;
  if (row.owner_id !== user.id && !isModerator(user)) return null;
  const bundle = await loadBundle(c.env.DB, row.id);
  return bundle && { bundle, status: row.status as string };
}

edit.get("/spectra/:slug/edit/", requireUser, async (c) => {
  const found = await editable(c);
  if (!found) return c.notFound();
  const s = found.bundle.spectrum;
  return c.html(
    <SubmitPage c={c} v={valuesFromBundle(found.bundle)} errors={{}} instruments={await approvedInstruments(c.env.DB)} edit={{ slug: s.slug, title: s.title }} />,
  );
});

edit.post("/spectra/:slug/edit/", requireUser, async (c) => {
  const found = await editable(c);
  if (!found) return c.notFound();
  const { bundle, status } = found;
  const s = bundle.spectrum;
  const user = c.get("user")!;
  const db = c.env.DB;
  const body = await c.req.parseBody();
  const { form, errors } = parseForm(body as any);
  const file = body.file instanceof File && body.file.size ? body.file : null;
  if (file) {
    const e = await checkUpload(file, SPECTRUM_EXTENSIONS, "Spectrum file");
    if (e) errors.file = e;
  }
  if (Object.keys(errors).length) {
    return c.html(
      <SubmitPage c={c} v={formValues(body)} errors={errors} instruments={await approvedInstruments(db)} edit={{ slug: s.slug, title: s.title }} />,
      422,
    );
  }

  const before = parseForm(valuesFromBundle(bundle)).form;
  const coreChanged = core(before) !== core(form) || !!file;
  const changes = textChanges(before, form);
  const back = `/spectra/${encodeURIComponent(s.slug)}/`;
  let fileKey: string | null = null;
  if (file) {
    fileKey = `submissions/${s.id}/edit-${Date.now()}/${file.name.replace(/[^\w.\-]+/g, "_")}`;
    await c.env.FILES.put(fileKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  }

  // A published spectrum's data and measurement changes wait for a moderator; the whole edit waits with them.
  if (coreChanged && status === "published") {
    await db.batch([
      db.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status, kind, change_json) VALUES (?, ?, 'pending', 'edit', ?)")
        .bind(s.id, user.id, JSON.stringify({ form, file: fileKey && { key: fileKey, name: file!.name, bytes: file!.size } })),
      db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
        .bind(s.id, user.id, JSON.stringify({ action: "edit submitted for review" })),
    ]);
    return c.redirect(`/account/submissions/?edited=${s.id}`);
  }

  if (!coreChanged && !Object.keys(changes).length) return c.redirect(back);

  const statements = [
    // The v1 object is rebuilt from the typed rows from now on.
    db.prepare("UPDATE spectra SET title = ?, description = ?, source_purity = ?, legacy_v1 = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(form.spectrum.title, form.spectrum.description, form.spectrum.source_purity, s.id),
    db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
      .bind(s.id, user.id, JSON.stringify({ action: "edited", changes: coreChanged ? { ...changes, core: [JSON.parse(core(before)), JSON.parse(core(form))] } : changes })),
  ];
  if (coreChanged) {
    // Still pending: nothing is public yet, so the edit applies in full.
    statements.push(
      db.prepare("UPDATE spectra SET type = ?, phase = ?, intensity_units = ?, formula = ?, completeness = ? WHERE id = ?")
        .bind(form.spectrum.type, form.spectrum.phase, form.spectrum.intensity_units, form.spectrum.formula, completeness(form.spectrum.type, form.acquisition), s.id),
      ...(await detailStatements(db, s.id, form)),
    );
    if (fileKey) {
      statements.push(
        db.prepare("DELETE FROM files WHERE spectrum_id = ? AND role = 'original'").bind(s.id),
        db.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, bytes) VALUES (?, 'original', ?, ?, ?)").bind(s.id, fileKey, file!.name, file!.size),
      );
    }
  } else {
    statements.push(...(await textStatements(db, s.id, form)));
  }
  await db.batch(statements);
  return c.redirect(status === "published" ? back : "/account/submissions/");
});

edit.get("/spectra/:slug/history/", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, title, slug FROM spectra WHERE slug = ? AND status = 'published'").bind(c.req.param("slug")).first<any>();
  if (!row) return c.notFound();
  const { results } = await c.env.DB.prepare(
    "SELECT h.at, h.change_json, u.display_name FROM history h LEFT JOIN users u ON u.id = h.user_id WHERE h.spectrum_id = ? ORDER BY h.at DESC, h.id DESC",
  ).bind(row.id).all<any>();
  return c.html(
    <Layout title={`History of ${row.title}`} path="/spectra/" user={c.get("user")}>
      <p class="small" style="margin-top:1.25rem"><a href={`/spectra/${encodeURIComponent(row.slug)}/`}>← {row.title}</a></p>
      <h1>History</h1>
      {results.length ? (
        <ul>
          {results.map((h) => {
            const change = JSON.parse(h.change_json);
            const fields = change.changes ? Object.keys(change.changes).join(", ") : "";
            return (
              <li>
                {String(h.at).slice(0, 16).replace("T", " ")}: {change.action}
                {fields && ` (${fields.replace("core", "measurement details")})`}
                {h.display_name && ` by ${h.display_name}`}
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="muted">No changes since it was published.</p>
      )}
    </Layout>,
  );
});
