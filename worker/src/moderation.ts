// Moderation decisions, shared by the admin pages and the moderation API used by `eelsdb review`.
import type { MiddlewareHandler } from "hono";
import { sha256, type AppEnv, type User } from "./auth";
import { sendEmail } from "./email";
import type { ParsedForm } from "./submit/form";
import { completeness } from "./submit/form";
import { detailStatements } from "./submit/store";

export type Decision = "approve" | "request_changes" | "reject";
export const DECISIONS: Decision[] = ["approve", "request_changes", "reject"];

export const QUEUE_SQL = `
  SELECT b.id, b.kind, b.status, b.created_at, b.spectrum_id, s.slug, s.title, s.type, s.formula,
         u.display_name AS submitter, u.id AS submitter_id
  FROM submissions b JOIN spectra s ON s.id = b.spectrum_id LEFT JOIN users u ON u.id = b.submitted_by`;

export async function submissionDetail(db: D1Database, id: number) {
  const sub = await db.prepare(`${QUEUE_SQL} WHERE b.id = ?`).bind(id).first<any>();
  if (!sub) return null;
  const extra = await db.prepare("SELECT browser_checks_json, change_json, moderator_notes FROM submissions WHERE id = ?").bind(id).first<any>();
  const { results: files } = await db.prepare("SELECT role, r2_key, filename, bytes, sha256 FROM files WHERE spectrum_id = ? ORDER BY id").bind(sub.spectrum_id).all<any>();
  return {
    ...sub,
    browser_checks: extra.browser_checks_json ? JSON.parse(extra.browser_checks_json) : null,
    change: extra.change_json ? JSON.parse(extra.change_json) : null,
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
    const change = JSON.parse(sub.change_json) as { form: ParsedForm; file: { key: string; name: string; bytes: number } | null };
    const f = change.form;
    statements.push(
      db.prepare(
        `UPDATE spectra SET title = ?, description = ?, source_purity = ?, type = ?, phase = ?, formula = ?, completeness = ?,
         legacy_v1 = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).bind(f.spectrum.title, f.spectrum.description, f.spectrum.source_purity, f.spectrum.type, f.spectrum.phase, f.spectrum.formula,
        completeness(f.spectrum.type, f.acquisition), sub.spectrum_id),
      ...(await detailStatements(db, sub.spectrum_id, f)),
    );
    if (change.file) {
      // The legacy file stays at its old URL; the new upload becomes the original and the download.
      statements.push(
        db.prepare("DELETE FROM files WHERE spectrum_id = ? AND role IN ('original', 'legacy', 'msa', 'hspy')").bind(sub.spectrum_id),
        db.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, bytes) VALUES (?, 'original', ?, ?, ?)")
          .bind(sub.spectrum_id, change.file.key, change.file.name, change.file.bytes),
      );
    }
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
