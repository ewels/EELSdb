import { Hono, type Context } from "hono";
import { loadBundle, type SpectrumBundle } from "../api/format";
import { requireUser, type AppEnv } from "../auth";
import { isModerator } from "../instruments";
import { SPECTRUM_EXTENSIONS, XAS_FIELDS, checkUpload, cleanBrowserChecks, completeness, parseForm, type ParsedForm } from "./form";
import { submitDraftStatements } from "./drafts";
import { SubmitPage, approvedInstruments, finishForm, formValues, rejectForm, wantsJson, ORCID_REQUIRED_MESSAGE } from "./index";
import { mediaType } from "../files";
import { Layout } from "../pages/layout";
import { coreStatements, instrumentOk, textColumnsStatement, textStatements } from "./store";
import { HistoryTimeline, spectrumHistory } from "../pages/history";

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
  if (!row || !["published", "pending", "draft"].includes(row.status)) return null;
  if (row.owner_id !== user.id && (row.status === "draft" || !isModerator(user))) return null;
  const bundle = await loadBundle(c.env.DB, row.id);
  return bundle && { bundle, status: row.status as string };
}

/** The spectrum being edited, with its current data file so the form can plot it. */
const editInfo = (b: SpectrumBundle) => ({
  slug: b.spectrum.slug,
  title: b.spectrum.title,
  draft: b.spectrum.status === "draft",
  file: b.legacyFile ? { url: `/${b.legacyFile.split("/").map(encodeURIComponent).join("/")}`, name: b.legacyFile.split("/").pop()! } : null,
});

edit.get("/spectra/:slug/edit/", requireUser, async (c) => {
  const found = await editable(c);
  if (!found) return c.notFound();
  const s = found.bundle.spectrum;
  return c.html(
    <SubmitPage c={c} v={valuesFromBundle(found.bundle)} errors={{}} instruments={await approvedInstruments(c.env.DB)} edit={editInfo(found.bundle)} />,
  );
});

edit.post("/spectra/:slug/edit/", requireUser, async (c) => {
  const found = await editable(c);
  if (!found) return c.notFound();
  const { bundle, status } = found;
  const s = bundle.spectrum;
  const user = c.get("user")!;
  const db = c.env.DB;
  if (status === "draft" && user.orcid_prompt === "required") {
    return wantsJson(c) ? c.json({ errors: { orcid: ORCID_REQUIRED_MESSAGE } }, 403) : c.html(<SubmitPage c={c} v={valuesFromBundle(bundle)} errors={{}} instruments={await approvedInstruments(db)} edit={editInfo(bundle)} />, 403);
  }
  const body = await c.req.parseBody();
  const { form, errors } = parseForm(body as any);
  const file = body.file instanceof File && body.file.size ? body.file : null;
  if (file) {
    const e = await checkUpload(file, SPECTRUM_EXTENSIONS, "Spectrum file");
    if (e) errors.file = e;
  }
  if (Object.keys(errors).length) {
    return rejectForm(c, errors, 422, async () => <SubmitPage c={c} v={formValues(body)} errors={errors} instruments={await approvedInstruments(db)} edit={editInfo(found.bundle)} />);
  }

  if (!(await instrumentOk(db, form))) {
    errors.instrument = "Choose an approved instrument profile.";
    return rejectForm(c, errors, 422, async () => <SubmitPage c={c} v={formValues(body)} errors={errors} instruments={await approvedInstruments(db)} edit={editInfo(found.bundle)} />);
  }

  if (status === "draft" && !body.agreement) {
    errors.agreement = "Please agree to the licence to publish your data.";
    return rejectForm(c, errors, 422, async () => <SubmitPage c={c} v={formValues(body)} errors={errors} instruments={await approvedInstruments(db)} edit={editInfo(found.bundle)} />);
  }

  const before = parseForm(valuesFromBundle(bundle)).form;
  const coreChanged = core(before) !== core(form) || !!file;
  const changes = textChanges(before, form);
  const back = `/spectra/${encodeURIComponent(s.slug)}/`;
  const ownerId = s.owner_id ?? null;

  if (coreChanged && status === "published") {
    const waiting = await db.prepare("SELECT 1 FROM submissions WHERE spectrum_id = ? AND kind = 'edit' AND status IN ('pending', 'changes_requested')")
      .bind(s.id).first();
    if (waiting) {
      errors.file = "A change to the data or measurement of this spectrum is already waiting for review. Please wait for it before sending another.";
      return rejectForm(c, errors, 409, async () => <SubmitPage c={c} v={formValues(body)} errors={errors} instruments={await approvedInstruments(db)} edit={editInfo(found.bundle)} />);
    }
  }

  let fileKey: string | null = null;
  if (file) {
    fileKey = `submissions/${s.id}/edit-${Date.now()}/${file.name.replace(/[^\w.\-]+/g, "_")}`;
    await c.env.FILES.put(fileKey, await file.arrayBuffer(), { httpMetadata: { contentType: mediaType(file.name) } });
  }

  const statements: D1PreparedStatement[] = [];
  if (Object.keys(changes).length) {
    statements.push(
      textColumnsStatement(db, s.id, form),
      ...(await textStatements(db, s.id, form, ownerId)),
      db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
        .bind(s.id, user.id, JSON.stringify({ action: "edited", changes })),
    );
  }

  if (coreChanged && status === "published") {
    // The data and measurement wait for a moderator; text changes above are already published.
    statements.push(
      db.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status, kind, change_json) VALUES (?, ?, 'pending', 'edit', ?)")
        .bind(s.id, user.id, JSON.stringify({ form, file: fileKey && { key: fileKey, name: file!.name, bytes: file!.size } })),
      db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
        .bind(s.id, user.id, JSON.stringify({ action: "edit submitted for review" })),
    );
    await db.batch(statements);
    return finishForm(c, `/account/submissions/?edited=${s.id}`);
  }

  if (status === "draft") {
    statements.push(...coreStatements(db, s.id, form), ...submitDraftStatements(db, s.id, user.id, cleanBrowserChecks(body.browser_checks)));
    if (fileKey) statements.push(...replaceOriginal(db, s.id, fileKey, file!));
    await db.batch(statements);
    return finishForm(c, `/account/submissions/?submitted=${s.id}`);
  }

  if (coreChanged) {
    // Not published yet: the edit applies in full, and a submission sent back for changes returns to the queue.
    statements.push(
      ...coreStatements(db, s.id, form),
      db.prepare("UPDATE submissions SET status = 'pending' WHERE spectrum_id = ? AND kind = 'new' AND status = 'changes_requested'").bind(s.id),
      db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
        .bind(s.id, user.id, JSON.stringify({ action: "edited", changes: { core: [JSON.parse(core(before)), JSON.parse(core(form))] } })),
    );
    if (fileKey) statements.push(...replaceOriginal(db, s.id, fileKey, file!));
  } else if (status === "pending" && statements.length) {
    statements.push(db.prepare("UPDATE submissions SET status = 'pending' WHERE spectrum_id = ? AND kind = 'new' AND status = 'changes_requested'").bind(s.id));
  }
  if (statements.length) await db.batch(statements);
  return finishForm(c, status === "published" ? back : "/account/submissions/");
});

const replaceOriginal = (db: D1Database, id: number, key: string, file: File) => [
  db.prepare("DELETE FROM files WHERE spectrum_id = ? AND role = 'original'").bind(id),
  db.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, media_type, bytes) VALUES (?, 'original', ?, ?, ?, ?)")
    .bind(id, key, file.name, mediaType(file.name), file.size),
];

edit.get("/spectra/:slug/history/", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, title, slug, published_at, author_display, author_slug FROM spectra WHERE slug = ? AND status = 'published'").bind(c.req.param("slug")).first<any>();
  if (!row) return c.notFound();
  return c.html(
    <Layout title={`History of ${row.title}`} path="/spectra/" user={c.get("user")}>
      <p class="small back-link"><a href={`/spectra/${encodeURIComponent(row.slug)}/`}>← {row.title}</a></p>
      <h1>History</h1>
      <HistoryTimeline events={await spectrumHistory(c.env.DB, row)} />
    </Layout>,
  );
});
