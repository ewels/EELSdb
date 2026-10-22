import { Hono, type Context } from "hono";
import { raw } from "hono/html";
import { FRESH_SIGN_IN_MINUTES, PROVIDERS, accountsLockedOut, methodsFrom, requireUser, signedInRecently, wayInSql, type AppEnv } from "./auth";
import { hasTwoStep } from "./totp";
import { EXPORT_KEY, fileHeaders } from "./files";
import { isModerator } from "./instruments";
import { DECISIONS, PROCESSED_ROLES, QUEUE_SQL, decide, reviewInput, storeProcessed, submissionDetail, type Decision, type ProcessingRecord } from "./moderation";
import { Layout, TypeBadge } from "./pages/layout";
import { MessagesPage } from "./contact";
import { adminUsers } from "./admin-users";
import { SIGN_IN_METHODS, TWO_STEP_GROUPS, getSettings, setSetting, type SettingKey, type SwitchableMethod } from "./settings";
import { MAX_FILE_BYTES } from "./submit/form";

export const admin = new Hono<AppEnv>();

/** Admins can open the person's account page; moderators see the name only. */
const Person = (props: { user: { role: string }; id: number | null; name: string | null }) =>
  props.user.role === "admin" && props.id ? <a href={`/admin/users/${props.id}/`}>{props.name}</a> : <>{props.name}</>;

const DECISION_LABELS: Record<Decision, string> = { approve: "Approve", request_changes: "Request changes", reject: "Reject" };

// ---- Moderation (moderators and admins) ----------------------------------------------------

admin.use("/admin/*", requireUser, async (c, next) => {
  if (c.get("user")!.needs_2fa) return c.redirect("/account/settings/?notice=two-step-required#h-two-step");
  if (!isModerator(c.get("user"))) return c.text("Only moderators can see this page.", 403);
  await next();
});

admin.get("/admin/", async (c) => {
  const db = c.env.DB;
  const [{ results: queue }, { results: profiles }, { results: recent }] = await db.batch<any>([
    db.prepare(`${QUEUE_SQL} WHERE b.status = 'pending' ORDER BY b.created_at, b.id`),
    db.prepare(
      `SELECT v.instrument_id, v.version, v.name, v.created_at FROM instrument_versions v WHERE v.status = 'pending' ORDER BY v.created_at`,
    ),
    db.prepare(`${QUEUE_SQL} WHERE b.status != 'pending' ORDER BY b.decided_at DESC LIMIT 10`),
  ]);
  const user = c.get("user")!;
  return c.html(
    <Layout title="Moderation" path="/admin/" user={user}>
      <h1>Moderation</h1>
      {user.role === "admin" && <p><a href="/admin/users/">Accounts</a> · <a href="/admin/settings/">Site settings</a> · <a href="/admin/messages/">Messages</a></p>}
      <h2>Submissions waiting ({queue.length})</h2>
      {queue.length ? (
        <div class="table-scroll">
          <table>
            <thead><tr><th>Spectrum</th><th>Kind</th><th>Type</th><th>Submitter</th><th class="num">Sent</th></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr>
                  <td><a href={`/admin/submissions/${q.id}/`}>{q.title}</a></td>
                  <td>{q.kind === "edit" ? "Edit" : "New"}</td>
                  <td><TypeBadge type={q.type} /></td>
                  <td><Person user={user} id={q.submitter_id} name={q.submitter} /></td>
                  <td class="num">{String(q.created_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">Nothing to review.</p>
      )}
      <h2>Instrument profile versions waiting ({profiles.length})</h2>
      {profiles.length ? (
        <ul>
          {profiles.map((p) => (
            <li><a href={`/instruments/${p.instrument_id}/?version=${p.version}`}>{p.name}, version {p.version}</a></li>
          ))}
        </ul>
      ) : (
        <p class="muted">Nothing to review.</p>
      )}
      {user.role === "admin" && (
        <>
          <h2>Bulk download</h2>
          <form method="post" action="/admin/exports/" enctype="multipart/form-data" class="inline-form">
            <input type="file" name="file" accept=".zip" aria-label="Archive made by python/export.py" required />
            <button class="button secondary" type="submit">Upload</button>
          </form>
          <p class="hint">The zip made by <code>uv run python/export.py</code>. It replaces the one on the <a href="/downloads/">bulk download</a> page.</p>
        </>
      )}
      {recent.length > 0 && (
        <>
          <h2>Recent decisions</h2>
          <ul>
            {recent.map((q) => (
              <li><a href={`/admin/submissions/${q.id}/`}>{q.title}</a>: {q.status.replace("_", " ")}, from <Person user={user} id={q.submitter_id} name={q.submitter} /></li>
            ))}
          </ul>
        </>
      )}
    </Layout>,
  );
});

admin.use("/admin/messages/*", async (c, next) => {
  if (c.get("user")!.role !== "admin") return c.text("Only admins can read contact messages.", 403);
  await next();
});
admin.get("/admin/messages/", async (c) => c.html(await MessagesPage({ c, user: c.get("user")! })));

// ---- Site settings (admins only) -----------------------------------------------------------

admin.use("/admin/settings/*", async (c, next) => {
  if (c.get("user")!.role !== "admin") return c.text("Only admins can change site settings.", 403);
  await next();
});

const SETTINGS_NOTICES: Record<string, string> = {
  saved: "Saved.",
  stale: `To change a site setting, sign out and sign in again, then change it within ${FRESH_SIGN_IN_MINUTES} minutes.`,
};

const METHOD_LABELS: Record<SwitchableMethod, string> = {
  orcid: "ORCID", google: "Google", github: "GitHub", passkey: "Passkey sign-in", email_link: "Email links", password: "Passwords",
};
const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`;
const listAnd = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "");

/** The plan's wording when one service is all that is left, else the general one. */
function lockedOutText(n: number, on: SwitchableMethod[], today = false) {
  const only = on.length === 1 && PROVIDERS[on[0]] ? on[0] : null;
  const has = n === 1 ? "has" : "have";
  if (only) return `${accounts(n)} ${has} no linked ${PROVIDERS[only].label}${only === "orcid" ? " iD" : " account"} and ${today ? "cannot" : "would not be able to"} sign in.`;
  return `${accounts(n)} ${today ? has : "would have"} no switched-on way to sign in.`;
}

/** Accounts that can take each first step today, whether or not it is switched on. */
async function usage(env: Env) {
  const rows = await env.DB.batch<{ n: number }>(SIGN_IN_METHODS.map((m) => env.DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${wayInSql(m, env)}`)));
  return Object.fromEntries(SIGN_IN_METHODS.map((m, i) => [m, rows[i].results[0].n])) as Record<SwitchableMethod, number>;
}

const logChange = (db: D1Database, userId: number, changes: Record<string, string>, details?: object) =>
  db.prepare("INSERT INTO site_settings_log (changed_by, changes_json, details_json) VALUES (?, ?, ?)")
    .bind(userId, JSON.stringify(changes), details ? JSON.stringify(details) : null).run();

const GROUP_LABELS: Record<string, string> = { admin: "admins", moderator: "moderators", user: "all other users" };
const NO_2FA_SQL = `NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)`;

/** Accounts per group with no authenticator app and no passkey. */
async function twoStepCounts(db: D1Database) {
  const rows = await db.batch<{ n: number }>([
    ...TWO_STEP_GROUPS.map((g) => db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE u.role = ? AND ${NO_2FA_SQL}`).bind(g.role)),
  ]);
  const n = rows.map((r) => r.results[0].n);
  return { without: Object.fromEntries(TWO_STEP_GROUPS.map((g, i) => [g.role, n[i]])) as Record<string, number> };
}

function describeChange(changes: Record<string, string>, details: any) {
  const parts = Object.entries(changes).map(([key, value]) => {
    const group = TWO_STEP_GROUPS.find((g) => g.key === key);
    if (group) {
      const n = details?.without_2fa?.[group.role];
      return `${value === "1" ? "required" : "stopped requiring"} two-step sign-in for ${GROUP_LABELS[group.role]}${value === "1" && n !== undefined ? ` (${accounts(n)} had none)` : ""}`;
    }
    if (key === "require_orcid") return value === "1" ? "required an ORCID iD to submit" : "stopped requiring an ORCID iD to submit";
    const m = key.replace(/^signin_/, "") as SwitchableMethod;
    const used = details?.using?.[m];
    return `switched ${METHOD_LABELS[m] ?? m} ${value === "1" ? "on" : "off"}${value === "0" && used !== undefined ? ` (${accounts(used)} could sign in with it)` : ""}`;
  });
  const left = details?.locked_out !== undefined ? `; ${accounts(details.locked_out)} left with no switched-on way to sign in` : "";
  return parts.join(", ") + left;
}

type Proposed = Record<SwitchableMethod, boolean>;
type TwoStepProposed = Record<string, boolean>;

async function settingsPage(c: Context<AppEnv>, opts: { error?: string; proposed?: Proposed; twoStepError?: string; twoStepProposed?: TwoStepProposed } = {}) {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const on = settings.require_orcid === "1";
  const row = await db.prepare("SELECT s.updated_at, u.display_name FROM site_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = 'require_orcid'")
    .first<{ updated_at: string; display_name: string | null }>();
  const configured = PROVIDERS.orcid.configured(c.env);
  const notice = SETTINGS_NOTICES[c.req.query("notice") ?? ""];
  const methods = methodsFrom(c.env, settings);
  const [used, lockedNow, twoStep, { results: log }] = await Promise.all([
    usage(c.env),
    accountsLockedOut(c.env, methods),
    twoStepCounts(db),
    db.prepare("SELECT l.changed_at, l.changes_json, l.details_json, u.display_name FROM site_settings_log l LEFT JOIN users u ON u.id = l.changed_by ORDER BY l.id DESC LIMIT 10")
      .all<{ changed_at: string; changes_json: string; details_json: string | null; display_name: string | null }>(),
  ]);
  return c.html(
    <Layout title="Site settings" path="/admin/" user={c.get("user")}>
      <p class="small back-link"><a href="/admin/">← Moderation</a></p>
      <h1>Site settings</h1>
      {notice && <p class="notice" role="status">{notice}</p>}
      <h2>Submitting</h2>
      <form method="post" action="/admin/settings/" class="settings-form">
        <div class="field">
          <label class="check">
            <input type="checkbox" name="require_orcid" value="1" checked={on} /> Require a linked ORCID iD to submit spectra
          </label>
          <p class="hint">
            People without an ORCID iD linked by signing in with ORCID cannot submit new spectra or send drafts for review. Editing published spectra and making drafts
            through the API still work.
          </p>
          {!configured && <p class="hint">ORCID sign-in is not set up on this server, so the rule does not apply until it is.</p>}
          {row && <p class="hint">Last changed {row.updated_at.slice(0, 16)} UTC{row.display_name ? ` by ${row.display_name}` : ""}.</p>}
        </div>
        <div><button class="button" type="submit">Save</button></div>
      </form>

      <h2 id="h-signin">Sign-in methods</h2>
      {opts.error && <p class="notice error-summary" role="alert">{opts.error}</p>}
      <div class="notice lockout-warning">
        <p><strong>Right now, {lockedOutText(lockedNow, methods, true)}</strong></p>
        <p>
          Switching a method off locks out every account that has no other switched-on way to sign in. People signed in now stay signed in until their session
          ends, then they are locked out too. Switching a method back on restores access straight away.
        </p>
      </div>
      <form method="post" action="/admin/settings/sign-in/" class="settings-form">
        {SIGN_IN_METHODS.map((m) => {
          const provider = PROVIDERS[m];
          return (
            <div class="field">
              <label class="check">
                <input type="checkbox" name={m} value="1" checked={opts.proposed ? opts.proposed[m] : settings[`signin_${m}`] === "1"} /> {METHOD_LABELS[m]}
              </label>
              <p class="hint">
                {accounts(used[m])} can sign in with it.
                {provider && !provider.configured(c.env) && " Not set up on this server, so unavailable whatever this says."}
              </p>
            </div>
          );
        })}
        <div><button class="button" type="submit">Review and save</button></div>
      </form>
      <h2 id="h-two-step">Two-step sign-in</h2>
      {opts.twoStepError && <p class="notice error-summary" role="alert">{opts.twoStepError}</p>}
      <form method="post" action="/admin/settings/two-step/" class="settings-form">
        {TWO_STEP_GROUPS.map((g) => (
          <div class="field">
            <label class="check">
              <input type="checkbox" name={g.role} value="1" checked={opts.twoStepProposed ? opts.twoStepProposed[g.role] : settings[g.key] === "1"} /> Require two-step sign-in for {GROUP_LABELS[g.role]}
            </label>
            <p class="hint">
              {accounts(twoStep.without[g.role])} in this group {twoStep.without[g.role] === 1 ? "has" : "have"} no authenticator app or passkey.
              {g.role === "user"
                ? " Without it, people must set up two-step sign-in before they use their account, and drafts tokens stop working for them."
                : " Without it, the role does nothing until they set it up."}
            </p>
          </div>
        ))}
        <div><button class="button" type="submit">Review and save</button></div>
      </form>
      {log.length > 0 && (
        <>
          <h2>Recent changes</h2>
          <ul class="settings-log">
            {log.map((l) => (
              <li>
                <span class="muted">{l.changed_at.slice(0, 16)} UTC{l.display_name ? `, ${l.display_name}` : ""}:</span>{" "}
                {describeChange(JSON.parse(l.changes_json), l.details_json ? JSON.parse(l.details_json) : null)}
              </li>
            ))}
          </ul>
        </>
      )}
    </Layout>,
    opts.error || opts.twoStepError ? 422 : 200,
  );
}

admin.get("/admin/settings/", (c) => settingsPage(c));

admin.post("/admin/settings/", async (c) => {
  if (!(await signedInRecently(c))) return c.redirect("/admin/settings/?notice=stale");
  const value = (await c.req.parseBody()).require_orcid ? "1" : "0";
  const changed = value !== (await getSettings(c.env.DB)).require_orcid;
  await setSetting(c.env.DB, "require_orcid", value, c.get("user")!.id);
  if (changed) await logChange(c.env.DB, c.get("user")!.id, { require_orcid: value });
  return c.redirect("/admin/settings/?notice=saved");
});

admin.post("/admin/settings/sign-in/", async (c) => {
  if (!(await signedInRecently(c))) return c.redirect("/admin/settings/?notice=stale");
  const env = c.env;
  const me = c.get("user")!;
  const body = await c.req.parseBody();
  const proposed = Object.fromEntries(SIGN_IN_METHODS.map((m) => [m, !!body[m]])) as Proposed;
  const settings = await getSettings(env.DB);
  const changes: Record<string, string> = {};
  for (const m of SIGN_IN_METHODS) if ((settings[`signin_${m}`] === "1") !== proposed[m]) changes[`signin_${m}`] = proposed[m] ? "1" : "0";
  if (!Object.keys(changes).length) return c.redirect("/admin/settings/?notice=saved");
  const now = methodsFrom(env, settings);
  const next = methodsFrom(env, { ...settings, ...changes });
  if (!next.length) return settingsPage(c, { proposed, error: "At least one way to sign in must stay on, and set up on this server. Nothing was changed." });
  if (await accountsLockedOut(env, next, me.id)) {
    return settingsPage(c, {
      proposed,
      error: "This would lock you out: your own account has none of the methods that would stay on. Link one of them to your account in your settings first, or keep on a method your account can use. Nothing was changed.",
    });
  }
  const off = now.filter((m) => !next.includes(m));
  const [lockedOut, lockedBefore, used] = await Promise.all([accountsLockedOut(env, next), accountsLockedOut(env, now), usage(env)]);
  if (off.length) {
    const confirming = body.step === "confirm";
    const confirmed = lockedOut > 0 ? String(body.confirm_count ?? "").trim() === String(lockedOut) : body.confirm === "1";
    if (!confirming || !confirmed) {
      return confirmPage(c, { proposed, off, next, lockedOut, lockedBefore, used, error: confirming });
    }
  }
  for (const [key, value] of Object.entries(changes)) await setSetting(env.DB, key as SettingKey, value, me.id);
  await logChange(env.DB, me.id, changes, { locked_out: lockedOut, locked_out_before: lockedBefore, using: Object.fromEntries(off.map((m) => [m, used[m]])) });
  return c.redirect("/admin/settings/?notice=saved");
});

admin.post("/admin/settings/two-step/", async (c) => {
  if (!(await signedInRecently(c))) return c.redirect("/admin/settings/?notice=stale");
  const db = c.env.DB;
  const me = c.get("user")!;
  const body = await c.req.parseBody();
  const proposed: TwoStepProposed = Object.fromEntries(TWO_STEP_GROUPS.map((g) => [g.role, !!body[g.role]]));
  const settings = await getSettings(db);
  const changes: Record<string, string> = {};
  for (const g of TWO_STEP_GROUPS) if ((settings[g.key] === "1") !== proposed[g.role]) changes[g.key] = proposed[g.role] ? "1" : "0";
  if (!Object.keys(changes).length) return c.redirect("/admin/settings/?notice=saved");
  const counts = await twoStepCounts(db);
  const on = TWO_STEP_GROUPS.filter((g) => changes[g.key] === "1");
  if (on.some((g) => g.role === "admin")) {
    // The admin making the change is an admin, so this also means at least one admin has two-step sign-in.
    if (!(await hasTwoStep(db, me.id))) return settingsPage(c, { twoStepProposed: proposed, twoStepError: "Set up two-step sign-in on your own account first: an authenticator app or a passkey. Nothing was changed." });
  }
  if (on.length) {
    const affected = on.reduce((sum, g) => sum + counts.without[g.role], 0);
    const confirming = body.step === "confirm";
    const confirmed = affected > 0 ? String(body.confirm_count ?? "").trim() === String(affected) : body.confirm === "1";
    if (!confirming || !confirmed) return twoStepConfirmPage(c, { proposed, on: on.map((g) => g.role), counts: counts.without, affected, error: confirming });
  }
  for (const [key, value] of Object.entries(changes)) await setSetting(db, key as SettingKey, value, me.id);
  await logChange(db, me.id, changes, { without_2fa: Object.fromEntries(on.map((g) => [g.role, counts.without[g.role]])) });
  return c.redirect("/admin/settings/?notice=saved");
});

function twoStepConfirmPage(c: Context<AppEnv>, p: { proposed: TwoStepProposed; on: string[]; counts: Record<string, number>; affected: number; error: boolean }) {
  const labels = listAnd(p.on.map((r) => GROUP_LABELS[r]));
  return c.html(
    <Layout title="Confirm two-step sign-in" path="/admin/" user={c.get("user")}>
      <div class="prose lockout-confirm">
        <p class="small back-link"><a href="/admin/settings/">← Site settings</a></p>
        <h1>Require two-step sign-in for {labels}?</h1>
        {p.error && (
          <p class="notice error-summary" role="alert" id="confirm-error">
            {p.affected > 0 ? "The number you typed does not match. Nothing was changed." : "Tick the box to confirm. Nothing was changed."}
          </p>
        )}
        <p class="lockout-count">{accounts(p.affected)} {p.affected === 1 ? "has" : "have"} no authenticator app or passkey today.</p>
        <ul>
          {p.on.map((r) => (
            <li>
              <strong>{GROUP_LABELS[r]}</strong>: {accounts(p.counts[r])} without two-step sign-in.{" "}
              {r === "user"
                ? "They are sent to their settings to set it up before they can submit, use drafts or open their account pages, and their drafts tokens stop working. Public pages still work."
                : "They lose the powers of their role until they set it up."}
            </li>
          ))}
        </ul>
        <p>Everyone in these groups who has two-step sign-in is asked for it after every way of signing in except a passkey. Switching a requirement off again restores access straight away.</p>
        <form method="post" action="/admin/settings/two-step/" class="settings-form">
          {TWO_STEP_GROUPS.filter((g) => p.proposed[g.role]).map((g) => <input type="hidden" name={g.role} value="1" />)}
          <input type="hidden" name="step" value="confirm" />
          {p.affected > 0 ? (
            <div class="field">
              <label for="f-confirm-count">To confirm, type the number of accounts that will have to set it up: {p.affected}</label>
              <input
                id="f-confirm-count" name="confirm_count" type="text" inputmode="numeric" autocomplete="off" required
                aria-invalid={p.error ? "true" : undefined} aria-describedby={p.error ? "confirm-error" : undefined}
              />
            </div>
          ) : (
            <label class="check">
              <input type="checkbox" name="confirm" value="1" required /> Require two-step sign-in for {labels}. Every account in {p.on.length === 1 ? "this group" : "these groups"} already has it.
            </label>
          )}
          <div class="filter-actions">
            <button class="button danger" type="submit">Require two-step sign-in</button>
            <a class="button secondary" href="/admin/settings/">Cancel</a>
          </div>
        </form>
      </div>
    </Layout>,
    p.error ? 422 : 200,
  );
}

function confirmPage(
  c: Context<AppEnv>,
  p: { proposed: Proposed; off: SwitchableMethod[]; next: SwitchableMethod[]; lockedOut: number; lockedBefore: number; used: Record<SwitchableMethod, number>; error: boolean },
) {
  const labels = listAnd(p.off.map((m) => METHOD_LABELS[m]));
  return c.html(
    <Layout title="Confirm sign-in change" path="/admin/" user={c.get("user")}>
      <div class="prose lockout-confirm">
        <p class="small back-link"><a href="/admin/settings/">← Site settings</a></p>
        <h1>Switch off {labels}?</h1>
        {p.error && (
          <p class="notice error-summary" role="alert" id="confirm-error">
            {p.lockedOut > 0 ? "The number you typed does not match. Nothing was changed." : "Tick the box to confirm. Nothing was changed."}
          </p>
        )}
        <p class="lockout-count">{lockedOutText(p.lockedOut, p.next)}</p>
        <p class="muted">{accounts(p.lockedBefore)} already {p.lockedBefore === 1 ? "has" : "have"} no switched-on way to sign in today.</p>
        <ul>
          {p.off.map((m) => <li><strong>{METHOD_LABELS[m]}</strong>: {accounts(p.used[m])} can sign in with it now.</li>)}
        </ul>
        <p>People left without a way to sign in cannot sign in until one of these happens:</p>
        <ul>
          <li>an admin switches a method they have back on;</li>
          <li>they link a method that stays on (only possible while they are still signed in);</li>
          <li>an admin merges their account into one that can sign in.</li>
        </ul>
        <p>People who are signed in now stay signed in until their session ends. Then they are locked out too.</p>
        <form method="post" action="/admin/settings/sign-in/" class="settings-form">
          {SIGN_IN_METHODS.filter((m) => p.proposed[m]).map((m) => <input type="hidden" name={m} value="1" />)}
          <input type="hidden" name="step" value="confirm" />
          {p.lockedOut > 0 ? (
            <div class="field">
              <label for="f-confirm-count">To confirm, type the number of accounts that will be locked out: {p.lockedOut}</label>
              <input
                id="f-confirm-count" name="confirm_count" type="text" inputmode="numeric" autocomplete="off" required
                aria-invalid={p.error ? "true" : undefined} aria-describedby={p.error ? "confirm-error" : undefined}
              />
            </div>
          ) : (
            <label class="check">
              <input type="checkbox" name="confirm" value="1" required /> Switch off {labels}. No account is left without a way to sign in.
            </label>
          )}
          <div class="filter-actions">
            <button class="button danger" type="submit">Switch off {p.off.length === 1 ? labels : `${p.off.length} methods`}</button>
            <a class="button secondary" href="/admin/settings/">Cancel</a>
          </div>
        </form>
      </div>
    </Layout>,
    p.error ? 422 : 200,
  );
}

admin.get("/admin/submissions/:id/", async (c) => {
  const d = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!d) return c.notFound();
  const findings: any[] = Array.isArray(d.browser_checks?.findings) ? d.browser_checks.findings : [];
  const n = (x: unknown) => (typeof x === "number" ? x.toFixed(2) : "?");
  const open = ["pending", "changes_requested"].includes(d.status);
  const input = open ? await reviewInput(c.env.DB, d) : null;
  return c.html(
    <Layout title={`Review: ${d.title}`} path="/admin/" user={c.get("user")} head={input?.file && <link rel="stylesheet" href="/vendor/uPlot.min.css" />}>
      <p class="small back-link"><a href="/admin/">← Moderation</a></p>
      <h1>{d.title}</h1>
      <p class="muted">
        {d.kind === "edit" ? "Edit of a published spectrum" : "New spectrum"} from <Person user={c.get("user")!} id={d.submitter_id} name={d.submitter} />, {String(d.created_at).slice(0, 10)} · status:{" "}
        {d.status.replace("_", " ")} · <a href={`/spectra/${encodeURIComponent(d.slug)}/`}>{d.kind === "edit" ? "Published page" : "Preview the page"}</a>
      </p>
      <div class="spectrum-cols">
        <section>
          <h2>Files</h2>
          <ul>
            {d.files.map((f: any) => (
              <li>
                <a href={`/admin/submissions/${d.id}/files/${f.role}/`}>{f.filename}</a> ({f.role}, {f.bytes ? `${Math.round(f.bytes / 1024)} kB` : "size unknown"})
              </li>
            ))}
            {d.change?.file && <li>New file in this edit: {d.change.file.name}</li>}
          </ul>
          {input && (
            <section id="review" data-id={d.id} data-file={input.file ? `/admin/submissions/${d.id}/files/${input.file.role}/` : ""}>
              <h2>Checks at review</h2>
              <p class="checks-status muted" aria-live="polite">
                {input.file ? "This page reads the file in your browser when JavaScript is on." : "No file to check."}
              </p>
              <div class="review-plot"></div>
              <ul class="findings" hidden></ul>
              <div class="table-scroll" hidden>
                <table class="review-compare">
                  <thead><tr><th></th><th>Submitted</th><th>In the file</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
              {/* Escaped so a title with "</script>" cannot end the element. */}
              <script type="application/json" id="review-input">{raw(JSON.stringify(input).replace(/</g, "\\u003c"))}</script>
            </section>
          )}
          <h2>Checks at submission</h2>
          {d.browser_checks === null ? (
            <p class="muted">None: the submitter's browser did not run them.</p>
          ) : d.browser_checks.error ? (
            <p class="muted">The browser could not read the file: {String(d.browser_checks.error)}</p>
          ) : (
            <>
              <p>
                {String(d.browser_checks.points ?? "?")} points, {n(d.browser_checks.energy_min)} to {n(d.browser_checks.energy_max)} eV.
              </p>
              <ul class="findings">
                {findings.length ? findings.map((f) => <li class={f.severity}>{f.message}</li>) : <li class="info">No problems found.</li>}
              </ul>
            </>
          )}
        </section>
        <section>
          {d.kind === "edit" && d.change && (
            <>
              <h2>Proposed values</h2>
              <pre>{JSON.stringify({ ...d.change.form.spectrum, elements: d.change.form.elements, edges: d.change.form.edges, acquisition: d.change.form.acquisition }, null, 1)}</pre>
            </>
          )}
          <h2>Decision</h2>
          {open ? (
            <form method="post" action={`/admin/submissions/${d.id}/`} class="field" id="decision">
              <label for="notes">Notes for the submitter (needed to request changes or reject)</label>
              <textarea id="notes" name="notes" rows={4}>{d.moderator_notes ?? ""}</textarea>
              <div class="filter-actions">
                {DECISIONS.map((x) => (
                  <button class={x === "approve" ? "button" : "button secondary"} type="submit" name="decision" value={x}>{DECISION_LABELS[x]}</button>
                ))}
              </div>
            </form>
          ) : (
            <p>Decided: {d.status.replace("_", " ")}. {d.moderator_notes}</p>
          )}
        </section>
      </div>
      {input?.file && (
        <>
          <script src="/vendor/uPlot.iife.min.js" defer></script>
          <script src="/review.js" type="module"></script>
        </>
      )}
    </Layout>,
  );
});

admin.post("/admin/submissions/:id/", async (c) => {
  const body = await c.req.parseBody();
  const decision = String(body.decision) as Decision;
  const notes = String(body.notes ?? "").trim() || null;
  const id = Number(c.req.param("id"));
  if (!DECISIONS.includes(decision)) return c.text("Unknown decision.", 400);
  if (decision !== "approve" && !notes) return c.text("Please add notes for the submitter when requesting changes or rejecting.", 400);
  const error = await decide(c.env, id, decision, notes, c.get("user")!);
  if (error) return c.text(error, 409);
  return c.redirect("/admin/");
});

/** The files the moderator's browser made at review (see public/review.js), with the processing record. */
admin.post("/admin/submissions/:id/processed/", async (c) => {
  const d = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!d) return c.json({ message: "No such submission." }, 404);
  if (!["pending", "changes_requested"].includes(d.status)) return c.json({ message: "This submission was already decided." }, 409);
  const body = await c.req.parseBody();
  let record: ProcessingRecord | null = null;
  try {
    record = JSON.parse(String(body.record));
  } catch {}
  if (!record || !Array.isArray(record.tools)) return c.json({ message: "Expected a record: {tools: [{tool, version}], warnings, values}." }, 400);
  const files = PROCESSED_ROLES.flatMap((role) => (body[role] instanceof File && body[role].size ? [[role, body[role]] as [string, File]] : []));
  if (files.some(([, f]) => f.size > MAX_FILE_BYTES)) return c.json({ message: "A processed file is too large." }, 400);
  await storeProcessed(c.env, d, files, record);
  return c.json({ ok: true });
});

admin.post("/admin/exports/", async (c) => {
  if (c.get("user")!.role !== "admin") return c.text("Only admins can upload the bulk download.", 403);
  const file = (await c.req.parseBody()).file;
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
  if (!bytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return c.text("Please choose the zip file made by python/export.py.", 400);
  await c.env.FILES.put(EXPORT_KEY, bytes, {
    httpMetadata: { contentType: "application/zip", contentDisposition: 'attachment; filename="eelsdb-spectra.zip"' },
    customMetadata: { uploaded_by: String(c.get("user")!.id) },
  });
  return c.redirect("/downloads/");
});

admin.get("/admin/submissions/:id/files/:role/", async (c) => {
  const d = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  const file = d?.files.find((f: any) => f.role === c.req.param("role"));
  const object = file && (await c.env.FILES.get(file.r2_key));
  if (!object) return c.notFound();
  return new Response(object.body, { headers: fileHeaders(file.filename) });
});

admin.route("/", adminUsers);
