// Token-authenticated API for the `eelsdb` CLI: submit spectra, and (moderators) review the queue.
import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { isModerator } from "../instruments";
import { DECISIONS, QUEUE_SQL, decide, submissionDetail, tokenAuth, type Decision } from "../moderation";
import { COMPANION_EXTENSIONS, SPECTRUM_EXTENSIONS, checkUpload, parseForm } from "../submit/form";
import { createSpectrum } from "../submit/store";

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
  if (Object.keys(errors).length) return c.json({ message: "The submission has errors.", errors }, 400);
  const { id, slug } = await createSpectrum(c.env.DB, form, user);
  const statements = [];
  for (const [role, f] of [["original", file!], ["companion", companion]] as const) {
    if (!f) continue;
    const bytes = await f.arrayBuffer();
    const key = `submissions/${id}/${role}/${f.name.replace(/[^\w.\-]+/g, "_")}`;
    await c.env.FILES.put(key, bytes);
    statements.push(
      c.env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, bytes) VALUES (?, ?, ?, ?, ?)").bind(id, role, key, f.name, f.size),
    );
  }
  statements.push(
    c.env.DB.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status, kind, browser_checks_json) VALUES (?, ?, 'pending', 'new', ?)")
      .bind(id, user.id, typeof body.checks === "string" ? body.checks : null),
    c.env.DB.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)").bind(id, user.id, JSON.stringify({ action: "submitted (CLI)" })),
  );
  await c.env.DB.batch(statements);
  return c.json({ id, slug, status: "pending" }, 201);
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
  return c.json({ ...detail, spectrum: { ...spectrum, legacy_v1: undefined }, acquisition });
});

cli.get("/queue/:id/files/:role", async (c) => {
  const detail = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  const file = detail?.files.find((f: any) => f.role === c.req.param("role"));
  const object = file && (await c.env.FILES.get(file.r2_key));
  if (!object) return c.json({ message: "No such file." }, 404);
  return new Response(object.body, { headers: { "Content-Disposition": `attachment; filename="${file.filename}"` } });
});

/** Processed files from `eelsdb review` (clean MSA with EELS header fields, HSPY) and the processing record. */
cli.put("/queue/:id/files/:role", async (c) => {
  const role = c.req.param("role");
  if (!PROCESSED_ROLES.includes(role)) return c.json({ message: `Upload role must be one of ${PROCESSED_ROLES.join(", ")}.` }, 400);
  const detail = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!detail) return c.json({ message: "No such submission." }, 404);
  const filename = (c.req.query("filename") ?? `${detail.slug}.${role}`).replace(/[^\w.\-]+/g, "_");
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) return c.json({ message: "Empty upload." }, 400);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `files/${detail.spectrum_id}/${filename}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: role === "msa" ? "text/plain; charset=utf-8" : "application/x-hdf5" }, sha256: sha });
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM files WHERE spectrum_id = ? AND role = ?").bind(detail.spectrum_id, role),
    c.env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(detail.spectrum_id, role, key, filename, bytes.byteLength, sha),
  ]);
  return c.json({ key, bytes: bytes.byteLength, sha256: sha }, 201);
});

cli.post("/queue/:id/processing", async (c) => {
  const detail = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!detail) return c.json({ message: "No such submission." }, 404);
  const record = await c.req.json<{ tools: { tool: string; version: string }[]; warnings?: unknown; values?: Record<string, number | null> }>();
  const db = c.env.DB;
  const statements = [
    db.prepare("DELETE FROM processing WHERE spectrum_id = ?").bind(detail.spectrum_id),
    ...record.tools.map((t, i) =>
      db.prepare("INSERT INTO processing (spectrum_id, tool, version, warnings_json) VALUES (?, ?, ?, ?)")
        .bind(detail.spectrum_id, t.tool, t.version, i === 0 ? JSON.stringify(record.warnings ?? []) : null),
    ),
  ];
  // The energy range and step measured from the file at review are authoritative.
  const v = record.values ?? {};
  if (v.min_energy_ev != null || v.max_energy_ev != null || v.step_ev != null) {
    statements.push(
      db.prepare("UPDATE spectra SET min_energy_ev = COALESCE(?, min_energy_ev), max_energy_ev = COALESCE(?, max_energy_ev), step_ev = COALESCE(?, step_ev) WHERE id = ?")
        .bind(v.min_energy_ev ?? null, v.max_energy_ev ?? null, v.step_ev ?? null, detail.spectrum_id),
    );
  }
  await db.batch(statements);
  return c.json({ ok: true });
});

cli.post("/queue/:id/:decision{approve|request_changes|reject}", async (c) => {
  const decision = c.req.param("decision") as Decision;
  if (!DECISIONS.includes(decision)) return c.json({ message: "Unknown decision." }, 400);
  const body = await c.req.json<{ notes?: string }>().catch(() => ({} as { notes?: string }));
  const error = await decide(c.env, Number(c.req.param("id")), decision, body.notes?.trim() || null, c.get("user")!);
  return error ? c.json({ message: error }, 409) : c.json({ ok: true });
});
