// Drafts: spectra that an assistant or script prepares through API v2 (POST /v2/drafts) with a drafts-only token.
// Nothing is reviewed or published until the owner checks a draft on the website and submits it.
import { Hono, type Context } from "hono";
import { getSettings, twoStepRequired } from "../settings";
import { FRESH_SIGN_IN_MINUTES, requireUser, sha256, signedInRecently, type AppEnv } from "../auth";
import { SITE } from "../api/format";
import { Layout, TypeBadge } from "../pages/layout";
import { ORCID_REQUIRED_MESSAGE } from "./index";
import { collectUploads, parseForm } from "./form";
import { createSpectrum, instrumentOk, storeFile } from "./store";

export const drafts = new Hono<AppEnv>();

export const MAX_DRAFTS_PER_HOUR = 200;
export const DRAFT_DAYS = 30;
const MEASURED = ["beam_energy", "convergence", "collection"];
const SOURCE_LABELS: Record<string, string> = {
  file: "from the file",
  companion: "from the companion file",
  profile: "from the instrument profile",
  user: "given",
  estimate: "approximate",
};

const apiError = (c: Context, status: 400 | 401 | 429, code: string, message: string, fields?: Record<string, string>) =>
  c.json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);

async function tokenUser(c: Context<AppEnv>) {
  const token = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!token) return null;
  const hash = await sha256(token);
  const user = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.slug, u.role,
            (EXISTS (SELECT 1 FROM user_totp x WHERE x.user_id = u.id AND x.enabled_at IS NOT NULL) OR EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)) AS has_2fa
     FROM draft_tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
  ).bind(hash).first<{ id: number; display_name: string; slug: string | null; role: string; has_2fa: number }>();
  if (user && !user.has_2fa) {
    const settings = await getSettings(c.env.DB);
    // Same rule as loadUser: a staff member without two-step sign-in whose group requires it counts as an ordinary user.
    const role = twoStepRequired(settings, user.role) ? "user" : user.role;
    if (role === "user" && twoStepRequired(settings, "user")) return null;
  }
  if (user) await c.env.DB.prepare("UPDATE draft_tokens SET last_used_at = datetime('now') WHERE hash = ?").bind(hash).run();
  return user;
}

/** POST /v2/drafts: the submit form's fields and files, from a script. Acquisition values left out are unknown. */
export async function createDraft(c: Context<AppEnv>) {
  const user = await tokenUser(c);
  if (!user) return apiError(c, 401, "unauthorized", `Send a drafts token as "Authorization: Bearer …". Make one at ${SITE}/account/drafts/.`);
  const db = c.env.DB;
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'draft' AND key = ? AND at > datetime('now', '-1 hour')")
    .bind(String(user.id)).first<number>("n");
  if ((recent ?? 0) >= MAX_DRAFTS_PER_HOUR) return apiError(c, 429, "too_many_drafts", `At most ${MAX_DRAFTS_PER_HOUR} drafts an hour. Please wait and try again.`);

  const body: Record<string, any> = { ...(await c.req.parseBody()) };
  if (!body.title && body.file instanceof File) body.title = body.file.name.replace(/\.[^.]+$/, "");
  for (const key of MEASURED) if (!body[key] && !body[`${key}_choice`]) body[`${key}_unknown`] = "1";
  const { form, errors } = parseForm(body);
  const uploads = await collectUploads(body, errors);
  if (!(await instrumentOk(db, form))) errors.instrument = "Choose an approved instrument profile (instrument=ID:VERSION).";
  if (Object.keys(errors).length) return apiError(c, 400, "invalid_draft", "The draft has errors. Nothing was saved.", errors);

  const { id, slug } = await createSpectrum(db, form, user, "draft");
  const rows = [];
  for (const [role, f, variant] of uploads) rows.push(await storeFile(c.env, id, role, f, variant));
  await db.batch([
    ...rows,
    db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)").bind(id, user.id, JSON.stringify({ action: "draft created" })),
    db.prepare("INSERT INTO rate_events (kind, key) VALUES ('draft', ?)").bind(String(user.id)),
  ]);
  return c.json({ id, slug, status: "draft" as const, review_url: `${SITE}/spectra/${encodeURIComponent(slug)}/edit/` }, 201);
}

/** Deletes drafts and their files. `where` selects from spectra; it is always limited to drafts. */
async function deleteDrafts(env: Env, where: string, ...binds: unknown[]) {
  const { results } = await env.DB.prepare(`SELECT id FROM spectra WHERE status = 'draft' AND ${where}`).bind(...binds).all<{ id: number }>();
  if (!results.length) return 0;
  const ids = results.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const { results: files } = await env.DB.prepare(`SELECT r2_key FROM files WHERE spectrum_id IN (${marks})`).bind(...ids).all<{ r2_key: string }>();
  if (files.length) await env.FILES.delete(files.map((f) => f.r2_key));
  await env.DB.prepare(`DELETE FROM spectra WHERE status = 'draft' AND id IN (${marks})`).bind(...ids).run();
  return ids.length;
}

/** Run daily by the cron trigger. */
export const deleteOldDrafts = (env: Env) => deleteDrafts(env, `created_at < datetime('now', '-${DRAFT_DAYS} days')`);

function measured(a: Record<string, any> | undefined, col: string, unit: string, value: string) {
  const v = a?.[value];
  if (!a || v === null || v === undefined || a[`${col}_source`] === "unknown") return <span class="muted">Unknown</span>;
  return `${v} ${unit} (${SOURCE_LABELS[a[`${col}_source`]] ?? a[`${col}_source`]})`;
}

drafts.get("/account/drafts/", requireUser, async (c) => draftsPage(c, null));

async function draftsPage(c: Context<AppEnv>, created: string | null, notice?: string, status: 200 | 403 = 200) {
  const user = c.get("user")!;
  const db = c.env.DB;
  const [{ results: list }, { results: acq }, { results: files }, { results: tokens }] = await db.batch<any>([
    db.prepare("SELECT id, slug, title, type, formula, created_at FROM spectra WHERE owner_id = ? AND status = 'draft' ORDER BY created_at DESC, id DESC").bind(user.id),
    db.prepare("SELECT a.* FROM eels_acquisition a JOIN spectra s ON s.id = a.spectrum_id WHERE s.owner_id = ? AND s.status = 'draft'").bind(user.id),
    db.prepare("SELECT f.spectrum_id, f.filename FROM files f JOIN spectra s ON s.id = f.spectrum_id WHERE s.owner_id = ? AND s.status = 'draft' AND f.role = 'original'").bind(user.id),
    db.prepare("SELECT id, label, created_at, last_used_at FROM draft_tokens WHERE user_id = ? ORDER BY id DESC").bind(user.id),
  ]);
  const acqOf = new Map(acq.map((a: any) => [a.spectrum_id, a]));
  const fileOf = new Map(files.map((f: any) => [f.spectrum_id, f.filename]));
  return c.html(
    <Layout title="Your drafts" path="/account/" user={user}>
      <h1>Your drafts</h1>
      <p class="lede">
        Drafts are spectra that an assistant or a script prepared for you. They are not public and moderators do not see them. Check each one, then
        submit it for review. Drafts are deleted after {DRAFT_DAYS} days.
      </p>
      {notice && <p class="notice" role="status">{notice}</p>}
      {user.orcid_prompt === "required" && (
        <div class="notice orcid-required" role="status">
          <p>{ORCID_REQUIRED_MESSAGE}</p>
          <p><a class="button" href="/auth/orcid/link?next=%2Faccount%2Fdrafts%2F">Link ORCID</a></p>
        </div>
      )}
      {list.length ? (
        <form method="post" action="/account/drafts/">
          <div class="table-scroll">
            <table class="drafts">
              <thead>
                <tr><th></th><th>Spectrum</th><th>Type</th><th>File</th><th>Beam energy</th><th>Convergence</th><th>Collection</th><th class="num">Made</th></tr>
              </thead>
              <tbody>
                {list.map((d: any) => {
                  const a = acqOf.get(d.id);
                  return (
                    <tr>
                      <td><input type="checkbox" name="id" value={String(d.id)} aria-label={`Choose ${d.title}`} /></td>
                      <td><a href={`/spectra/${encodeURIComponent(d.slug)}/edit/`}>{d.title}</a><br /><span class="muted small">{d.formula}</span></td>
                      <td><TypeBadge type={d.type} /></td>
                      <td class="small">{fileOf.get(d.id) ?? ""}</td>
                      <td>{measured(a, "beam_energy", "kV", "beam_energy_kv")}</td>
                      <td>{measured(a, "convergence", "mrad", "convergence_mrad")}</td>
                      <td>{measured(a, "collection", "mrad", "collection_mrad")}</td>
                      <td class="num">{String(d.created_at).slice(0, 10)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p class="hint">Open a draft to see its plot and the file checks, and to correct it. To send several at once, choose them here.</p>
          <div class="field">
            <label class="check agreement">
              <input type="checkbox" name="agreement" value="1" /> I have checked the chosen drafts, and I agree to publish this data under the{" "}
              <a href="https://opendatacommons.org/licenses/odbl/">Open Data Commons Open Database Licence (ODbL)</a>: others may reuse it if they credit
              me and the EELS Data Base.
            </label>
          </div>
          <div class="filter-actions">
            <button class="button" type="submit" name="action" value="submit">Submit the chosen drafts for review</button>
            <button class="button secondary" type="submit" name="action" value="delete">Delete the chosen drafts</button>
          </div>
        </form>
      ) : (
        <p class="muted">You have no drafts.</p>
      )}

      <h2>Let an assistant make drafts</h2>
      <p class="prose">
        An AI assistant or a script can make drafts for you with a token. A token can only make drafts: it cannot submit, publish or change
        anything else. Treat it like a password. See <a href="/docs/share/drafts/">Prepare drafts with an assistant</a>.
      </p>
      {created && (
        <div class="notice" role="status">
          <p><strong>Your new token.</strong> Copy it now: it is not shown again.</p>
          <pre id="new-token">{created}</pre>
        </div>
      )}
      <form method="post" action="/account/drafts/tokens/" class="inline-form">
        <input type="text" name="label" placeholder="What is it for? e.g. laptop" aria-label="Token label" maxlength={80} />
        <button class="button secondary" type="submit">Make a token</button>
      </form>
      {tokens.length > 0 && (
        <div class="table-scroll">
          <table>
            <thead><tr><th>Label</th><th>Made</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {tokens.map((t: any) => (
                <tr>
                  <td>{t.label || <span class="muted">No label</span>}</td>
                  <td>{String(t.created_at).slice(0, 10)}</td>
                  <td>{t.last_used_at ? String(t.last_used_at).slice(0, 10) : "Never"}</td>
                  <td>
                    <form method="post" action={`/account/drafts/tokens/${t.id}/revoke/`}>
                      <button class="button secondary" type="submit">Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>,
    status,
  );
}

drafts.post("/account/drafts/", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const body = await c.req.parseBody({ all: true });
  const ids = [body.id ?? []].flat().map(Number).filter(Number.isInteger);
  if (!ids.length) return draftsPage(c, null, "Choose one or more drafts first.");
  const marks = ids.map(() => "?").join(",");
  if (body.action === "delete") {
    const n = await deleteDrafts(c.env, `owner_id = ? AND id IN (${marks})`, user.id, ...ids);
    return draftsPage(c, null, `Deleted ${n === 1 ? "one draft" : `${n} drafts`}.`);
  }
  if (user.orcid_prompt === "required") return draftsPage(c, null, ORCID_REQUIRED_MESSAGE, 403);
  if (!body.agreement) return draftsPage(c, null, "Please confirm that you checked the drafts and agree to the licence.");
  const { results } = await db.prepare(`SELECT id, slug FROM spectra WHERE owner_id = ? AND status = 'draft' AND id IN (${marks})`)
    .bind(user.id, ...ids).all<{ id: number; slug: string }>();
  if (!results.length) return draftsPage(c, null, "None of the chosen drafts is still a draft.");
  await db.batch(results.flatMap((s) => submitDraftStatements(db, s.id, user.id, null)));
  return c.redirect(`/account/submissions/?submitted=${results.length}`);
});

/** A checked draft joins the review queue as a new submission. */
export const submitDraftStatements = (db: D1Database, id: number, userId: number, browserChecks: string | null) => [
  db.prepare("UPDATE spectra SET status = 'pending' WHERE id = ? AND status = 'draft'").bind(id),
  db.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status, kind, browser_checks_json) VALUES (?, ?, 'pending', 'new', ?)")
    .bind(id, userId, browserChecks),
  db.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)").bind(id, userId, JSON.stringify({ action: "submitted" })),
];

const staleSignIn = (c: Context<AppEnv>) =>
  draftsPage(c, null, `To make or revoke a token, sign out and sign in again, then do it within ${FRESH_SIGN_IN_MINUTES} minutes. This keeps a token out of reach of anyone at a browser you left signed in.`, 403);

drafts.post("/account/drafts/tokens/", requireUser, async (c) => {
  const user = c.get("user")!;
  if (!(await signedInRecently(c))) return staleSignIn(c);
  const label = String((await c.req.parseBody()).label ?? "").trim().slice(0, 80) || null;
  const token = "eelsdb_draft_" + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await c.env.DB.prepare("INSERT INTO draft_tokens (user_id, hash, label) VALUES (?, ?, ?)").bind(user.id, await sha256(token), label).run();
  return draftsPage(c, token);
});

drafts.post("/account/drafts/tokens/:id/revoke/", requireUser, async (c) => {
  if (!(await signedInRecently(c))) return staleSignIn(c);
  await c.env.DB.prepare("DELETE FROM draft_tokens WHERE id = ? AND user_id = ?").bind(Number(c.req.param("id")), c.get("user")!.id).run();
  return c.redirect("/account/drafts/");
});
