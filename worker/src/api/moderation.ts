// Token-authenticated API for the `eelsdb` CLI: submit spectra, and (moderators) review the queue.
import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { fileHeaders, mediaType } from "../files";
import { isModerator } from "../instruments";
import {
  DECISIONS,
  QUEUE_SQL,
  decide,
  processingStatements,
  submissionDetail,
  tokenAuth,
  type Decision,
  type EditChange,
  type ProcessingRecord,
} from "../moderation";
import { COMPANION_EXTENSIONS, SPECTRUM_EXTENSIONS, checkUpload, cleanBrowserChecks, parseForm } from "../submit/form";
import { createSpectrum, instrumentOk } from "../submit/store";

export const cli = new Hono<AppEnv>();
cli.use(tokenAuth);

const PROCESSED_ROLES = ["msa", "hspy"];

cli.get("/me", (c) => c.json(c.get("user")));

/** Same fields as the web form; the licence agreement is part of using the CLI. */
cli.post("/submissions", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const { form, errors } = parseForm(body as any);
  const file = body.file instanceof File ? body.file : null;
  const e = await checkUpload(file, SPECTRUM_EXTENSIONS, "Spectrum file");
  if (e) errors.file = e;
  const companion = body.companion_file instanceof File && body.companion_file.size ? body.companion_file : null;
  if (companion) {
    const ce = await checkUpload(companion, COMPANION_EXTENSIONS, "Companion file");
    if (ce) errors.companion_file = ce;
  }
  if (!(await instrumentOk(c.env.DB, form))) errors.instrument = "Choose an approved instrument profile.";
  if (Object.keys(errors).length) return c.json({ message: "The submission has errors.", errors }, 400);
  const { id, slug } = await createSpectrum(c.env.DB, form, user);
  const statements = [];
  for (const [role, f] of [["original", file!], ["companion", companion]] as const) {
    if (!f) continue;
    const bytes = await f.arrayBuffer();
    const key = `submissions/${id}/${role}/${f.name.replace(/[^\w.\-]+/g, "_")}`;
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mediaType(f.name) } });
    statements.push(
      c.env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, bytes) VALUES (?, ?, ?, ?, ?)").bind(id, role, key, f.name, f.size),
    );
  }
  statements.push(
    c.env.DB.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status, kind, browser_checks_json) VALUES (?, ?, 'pending', 'new', ?)")
      .bind(id, user.id, cleanBrowserChecks(body.checks)),
    c.env.DB.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)").bind(id, user.id, JSON.stringify({ action: "submitted (CLI)" })),
  );
  await c.env.DB.batch(statements);
  return c.json({ id, slug, status: "pending" }, 201);
});

/** The bulk archive made by `eelsdb export --upload` (admins). */
cli.put("/exports/:name{eelsdb-spectra\\.zip}", async (c) => {
  if (c.get("user")!.role !== "admin") return c.json({ message: "Only admins can upload exports." }, 403);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength < 22) return c.json({ message: "Empty upload." }, 400);
  const key = `exports/${c.req.param("name")}`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: "application/zip", contentDisposition: `attachment; filename="${c.req.param("name")}"` },
    customMetadata: { uploaded_by: String(c.get("user")!.id) },
  });
  return c.json({ url: `https://eelsdb.eu/${key}`, bytes: bytes.byteLength }, 201);
});

cli.use("/queue/*", async (c, next) => {
  if (!isModerator(c.get("user"))) return c.json({ message: "Only moderators can use the review queue." }, 403);
  await next();
});

cli.get("/queue", async (c) => {
  const { results } = await c.env.DB.prepare(`${QUEUE_SQL} WHERE b.status = 'pending' ORDER BY b.created_at, b.id`).all();
  return c.json(results);
});

cli.get("/queue/:id", async (c) => {
  const detail = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!detail) return c.json({ message: "No such submission." }, 404);
  const spectrum = await c.env.DB.prepare("SELECT * FROM spectra WHERE id = ?").bind(detail.spectrum_id).first<any>();
  const acquisition = await c.env.DB.prepare("SELECT * FROM eels_acquisition WHERE spectrum_id = ?").bind(detail.spectrum_id).first();
  const reference = await c.env.DB.prepare("SELECT * FROM reference WHERE spectrum_id = ?").bind(detail.spectrum_id).first();
  const { results: elements } = await c.env.DB.prepare("SELECT element FROM spectrum_elements WHERE spectrum_id = ? ORDER BY position").bind(detail.spectrum_id).all<any>();
  const { results: edges } = await c.env.DB.prepare("SELECT element, edge FROM spectrum_edges WHERE spectrum_id = ? ORDER BY position").bind(detail.spectrum_id).all<any>();
  return c.json({
    ...detail,
    // For an edit, what the spectrum would become; review checks the file against these values.
    proposed: detail.change?.form ?? null,
    spectrum: { ...spectrum, legacy_v1: undefined },
    acquisition,
    reference,
    elements: elements.map((e) => e.element),
    edges: edges.map((e) => `${e.element}_${e.edge}`),
  });
});

cli.get("/queue/:id/files/:role", async (c) => {
  const detail = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  const file = detail?.files.find((f: any) => f.role === c.req.param("role"));
  const object = file && (await c.env.FILES.get(file.r2_key));
  if (!object) return c.json({ message: "No such file." }, 404);
  return new Response(object.body, { headers: fileHeaders(file.filename) });
});

async function stageForEdit(db: D1Database, id: number, change: EditChange) {
  await db.prepare("UPDATE submissions SET change_json = ? WHERE id = ?").bind(JSON.stringify(change), id).run();
}

/**
 * Processed files from `eelsdb review` (clean MSA with EELS header fields, HSPY). For a new spectrum they
 * attach directly (it is not public yet); for an edit they wait in the submission until approval.
 */
cli.put("/queue/:id/files/:role", async (c) => {
  const role = c.req.param("role");
  if (!PROCESSED_ROLES.includes(role)) return c.json({ message: `Upload role must be one of ${PROCESSED_ROLES.join(", ")}.` }, 400);
  const id = Number(c.req.param("id"));
  const detail = await submissionDetail(c.env.DB, id);
  if (!detail) return c.json({ message: "No such submission." }, 404);
  if (!["pending", "changes_requested"].includes(detail.status)) return c.json({ message: "This submission was already decided." }, 409);
  const filename = (c.req.query("filename") ?? `${detail.slug}.${role}`).replace(/[^\w.\-]+/g, "_");
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) return c.json({ message: "Empty upload." }, 400);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Per submission, so an edit's reprocessed file never replaces the published one before approval.
  const key = `files/${detail.spectrum_id}/s${id}/${filename}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mediaType(filename) }, sha256: sha });
  if (detail.kind === "edit" && detail.change) {
    await stageForEdit(c.env.DB, id, { ...detail.change, processed: { ...detail.change.processed, [role]: { key, filename, bytes: bytes.byteLength, sha256: sha } } });
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM files WHERE spectrum_id = ? AND role = ?").bind(detail.spectrum_id, role),
      c.env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, media_type, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(detail.spectrum_id, role, key, filename, mediaType(filename), bytes.byteLength, sha),
    ]);
  }
  return c.json({ key, bytes: bytes.byteLength, sha256: sha }, 201);
});

cli.post("/queue/:id/processing", async (c) => {
  const id = Number(c.req.param("id"));
  const detail = await submissionDetail(c.env.DB, id);
  if (!detail) return c.json({ message: "No such submission." }, 404);
  const record = await c.req.json<ProcessingRecord>().catch(() => null);
  if (!record || !Array.isArray(record.tools)) return c.json({ message: "Expected {tools: [{tool, version}], warnings, values}." }, 400);
  if (detail.kind === "edit" && detail.change) await stageForEdit(c.env.DB, id, { ...detail.change, processing: record });
  else await c.env.DB.batch(processingStatements(c.env.DB, detail.spectrum_id, record));
  return c.json({ ok: true });
});

cli.post("/queue/:id/:decision{approve|request_changes|reject}", async (c) => {
  const decision = c.req.param("decision") as Decision;
  if (!DECISIONS.includes(decision)) return c.json({ message: "Unknown decision." }, 400);
  const body = await c.req.json<{ notes?: string }>().catch(() => ({} as { notes?: string }));
  const error = await decide(c.env, Number(c.req.param("id")), decision, body.notes?.trim() || null, c.get("user")!);
  return error ? c.json({ message: error }, 409) : c.json({ ok: true });
});
