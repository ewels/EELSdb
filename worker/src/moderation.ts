// Moderation decisions, shared by the admin pages and the moderation API used by `eelsdb review`.
import type { MiddlewareHandler } from "hono";
import { sha256, type AppEnv, type User } from "./auth";
import { sendEmail } from "./email";
import type { ParsedForm } from "./submit/form";
import { mediaType } from "./files";
import { coreStatements } from "./submit/store";

export type Decision = "approve" | "request_changes" | "reject";
export const DECISIONS: Decision[] = ["approve", "request_changes", "reject"];

export const QUEUE_SQL = `
  SELECT b.id, b.kind, b.status, b.created_at, b.spectrum_id, s.slug, s.title, s.type, s.formula,
         u.display_name AS submitter, u.id AS submitter_id
  FROM submissions b JOIN spectra s ON s.id = b.spectrum_id LEFT JOIN users u ON u.id = b.submitted_by`;

const parseJson = (s: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

export type StagedFile = { key: string; filename: string; bytes: number; sha256: string };
export type ProcessingRecord = { tools: { tool: string; version: string }[]; warnings?: unknown; values?: Record<string, number | null> };
/** What an edit submission proposes, and what review has prepared for it; applied on approval. */
export type EditChange = {
  form: ParsedForm;
  file: { key: string; name: string; bytes: number } | null;
  processed?: Record<string, StagedFile>;
  processing?: ProcessingRecord;
};

export function processingStatements(db: D1Database, spectrumId: number, record: ProcessingRecord) {
  const statements = [
    db.prepare("DELETE FROM processing WHERE spectrum_id = ?").bind(spectrumId),
    ...record.tools.map((t, i) =>
      db.prepare("INSERT INTO processing (spectrum_id, tool, version, warnings_json) VALUES (?, ?, ?, ?)")
        .bind(spectrumId, String(t.tool), String(t.version), i === 0 ? JSON.stringify(record.warnings ?? []) : null),
    ),
  ];
  // The energy range and step measured from the file at review are authoritative.
  const v = record.values ?? {};
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  if (n(v.min_energy_ev) !== null || n(v.max_energy_ev) !== null || n(v.step_ev) !== null) {
    statements.push(
      db.prepare("UPDATE spectra SET min_energy_ev = COALESCE(?, min_energy_ev), max_energy_ev = COALESCE(?, max_energy_ev), step_ev = COALESCE(?, step_ev), legacy_v1 = NULL WHERE id = ?")
        .bind(n(v.min_energy_ev), n(v.max_energy_ev), n(v.step_ev), spectrumId),
    );
  }
  return statements;
}

export async function submissionDetail(db: D1Database, id: number) {
  const sub = await db.prepare(`${QUEUE_SQL} WHERE b.id = ?`).bind(id).first<any>();
  if (!sub) return null;
  const extra = await db.prepare("SELECT browser_checks_json, change_json, moderator_notes FROM submissions WHERE id = ?").bind(id).first<any>();
  const { results: files } = await db.prepare("SELECT role, r2_key, filename, bytes, sha256 FROM files WHERE spectrum_id = ? ORDER BY id").bind(sub.spectrum_id).all<any>();
  const change = parseJson(extra.change_json) as EditChange | null;
  // A new file in an edit is not attached to the spectrum until approval; reviewers get it as role "edit".
  if (change?.file) files.push({ role: "edit", r2_key: change.file.key, filename: change.file.name, bytes: change.file.bytes, sha256: null });
  return {
    ...sub,
    browser_checks: parseJson(extra.browser_checks_json),
    change,
    moderator_notes: extra.moderator_notes,
    files,
  };
}

const MESSAGES: Record<Decision, (title: string, notes: string | null) => { subject: string; text: string }> = {
  approve: (title) => ({ subject: `Published: ${title}`, text: `Your spectrum "${title}" is now published in the EELS Data Base. Thank you!` }),
  request_changes: (title, notes) => ({
    subject: `Changes requested: ${title}`,
    text: `A moderator asks for changes to "${title}" before it can be published:\n\n${notes ?? ""}\n\nYou can edit it from your submissions page.`,
  }),
  reject: (title, notes) => ({ subject: `Not accepted: ${title}`, text: `Your submission "${title}" was not accepted.\n\n${notes ?? ""}` }),
};

/** Applies a decision and returns the error message if it cannot be made. */
export async function decide(env: Env, id: number, decision: Decision, notes: string | null, moderator: User): Promise<string | null> {
  const db = env.DB;
  const sub = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<any>();
  if (!sub) return "No such submission.";
  if (!["pending", "changes_requested"].includes(sub.status)) return `This submission was already ${sub.status}.`;
  const spectrum = await db.prepare("SELECT id, title, status FROM spectra WHERE id = ?").bind(sub.spectrum_id).first<any>();
  const status = { approve: "approved", request_changes: "changes_requested", reject: "rejected" }[decision];

  const statements = [
    db.prepare("UPDATE submissions SET status = ?, moderator_notes = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?")
      .bind(status, notes, moderator.id, id),
    db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
      .bind(sub.spectrum_id, moderator.id, JSON.stringify({ action: `${sub.kind} ${status.replace("_", " ")}`, notes })),
  ];
  if (sub.kind === "new" && decision === "approve") {
    statements.push(db.prepare("UPDATE spectra SET status = 'published', published_at = datetime('now') WHERE id = ?").bind(sub.spectrum_id));
  }
  if (sub.kind === "new" && decision === "reject") {
    statements.push(db.prepare("UPDATE spectra SET status = 'rejected' WHERE id = ?").bind(sub.spectrum_id));
  }
  if (sub.kind === "edit" && decision === "approve") {
    // Only the specimen and measurement: text changes were published when they were made.
    const change = JSON.parse(sub.change_json) as EditChange;
    statements.push(...coreStatements(db, sub.spectrum_id, change.form));
    if (change.file) {
      // The legacy file stays at its old URL; the new upload becomes the original and the download.
      statements.push(
        db.prepare("DELETE FROM files WHERE spectrum_id = ? AND role IN ('original', 'legacy', 'msa', 'hspy')").bind(sub.spectrum_id),
        db.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, media_type, bytes) VALUES (?, 'original', ?, ?, ?, ?)")
          .bind(sub.spectrum_id, change.file.key, change.file.name, mediaType(change.file.name), change.file.bytes),
      );
    }
    for (const [role, f] of Object.entries(change.processed ?? {})) {
      statements.push(
        db.prepare("DELETE FROM files WHERE spectrum_id = ? AND role = ?").bind(sub.spectrum_id, role),
        db.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, media_type, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(sub.spectrum_id, role, f.key, f.filename, mediaType(f.filename), f.bytes, f.sha256),
      );
    }
    if (change.processing) statements.push(...processingStatements(db, sub.spectrum_id, change.processing));
  }
  await db.batch(statements);

  const submitter = await db
    .prepare("SELECT COALESCE((SELECT email FROM identities WHERE user_id = u.id AND email_verified = 1 LIMIT 1), u.legacy_email) AS email FROM users u WHERE u.id = ?")
    .bind(sub.submitted_by)
    .first<string>("email");
  if (submitter) await sendEmail(env, { to: submitter, ...MESSAGES[decision](spectrum.title, notes) });
  return null;
}

/** Bearer-token authentication for the moderation API (tokens made on /account/tokens/). */
export const tokenAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  const user = token
    ? await c.env.DB.prepare(
        `SELECT u.id, u.display_name, u.role, u.slug, u.orcid FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
      ).bind(await sha256(token)).first<User>()
    : null;
  if (!user) return c.json({ message: "A valid API token is needed (Authorization: Bearer …)." }, 401);
  await c.env.DB.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE hash = ?").bind(await sha256(token!)).run();
  c.set("user", user);
  await next();
};
