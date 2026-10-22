import { Hono, type Context } from "hono";
import { FRESH_SIGN_IN_MINUTES, PROVIDERS, methodOn, signOutEverywhere, signedInRecently, type AppEnv } from "./auth";
import { EmailList, ProfileFields, addEmail, emailOf, makePrimary, removeAvatar, removeEmail, resendVerification, saveProfile, storedProfile, type EmailRow } from "./account-edit";
import { sendEmail } from "./email";
import { accountFacts, mergeAccounts, mergePlan, outranks, type Facts } from "./merge";
import { Avatar, Layout } from "./pages/layout";
import { sendLoginLink } from "./pages/account";
import { HAS_PAGE_SQL } from "./pages/profile";
import { authorSlug } from "./submit/store";

export const adminUsers = new Hono<AppEnv>();
type C = Context<AppEnv>;
type Person = { id: number; display_name: string; role: string; slug: string | null };

const PAGE_SIZE = 50;
const ROLES = ["user", "moderator", "admin"];

const NOTICES: Record<string, string> = {
  stale: `Admin changes need a sign-in in the last ${FRESH_SIGN_IN_MINUTES} minutes. Sign out, sign in again, then repeat the change.`,
  profile: "Profile saved.",
  "avatar-removed": "Picture removed.",
  role: "Role saved.",
  sent: "Added, and a confirmation link was sent to the address. It stays unconfirmed until the person opens it.",
  limit: "That account has had its daily limit of confirmation emails. Try again tomorrow.",
  "email-bad": "That does not look like an email address.",
  primary: "Primary address changed.",
  removed: "Address removed.",
  "keep-primary": "Make another confirmed address primary before removing this one.",
  "link-sent": "Sign-in link sent to the address.",
  "link-off": "Email links are switched off on this site, so no sign-in link was sent.",
  unlinked: "Account unlinked. The person was told by email.",
  "password-removed": "Password removed and the person signed out everywhere.",
  "no-password": "This account has no password.",
  "two-step-reset": "Two-step sign-in reset and the person signed out everywhere.",
  "no-two-step": "This account has no two-step sign-in to reset.",
  "signed-out": "Signed out everywhere.",
  merged: "Accounts merged. Both people were told by email, where they had a confirmed address.",
};

const ACTION_LABELS: Record<string, string> = {
  profile_edited: "Profile edited",
  avatar_removed: "Picture removed",
  role_changed: "Role changed",
  email_added: "Email address added",
  email_verification_sent: "Confirmation link sent",
  email_primary_changed: "Primary address changed",
  email_removed: "Email address removed",
  login_link_sent: "Sign-in link sent",
  identity_unlinked: "Linked account removed",
  password_removed: "Password removed",
  two_step_reset: "Two-step sign-in reset",
  sessions_ended: "Signed out everywhere",
  accounts_merged: "Accounts merged",
};

const when = () => `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** The address the person gets notices at: confirmed only, so an address an admin just added never receives them. */
const noticeAddress = (db: D1Database, userId: number) =>
  db.prepare("SELECT email FROM user_emails WHERE user_id = ? AND verified = 1 ORDER BY is_primary DESC, id LIMIT 1").bind(userId).first<string>("email");

/** Logs the change and, when `change` is given, tells the person what changed and when, without naming the admin. */
async function record(c: C, p: Person, action: string, details: Record<string, unknown>, change?: string, to?: string | null) {
  await c.env.DB.prepare("INSERT INTO admin_actions (admin_id, user_id, action, details_json) VALUES (?, ?, ?, ?)")
    .bind(c.get("user")!.id, p.id, action, JSON.stringify(details)).run();
  if (!change) return;
  const address = to === undefined ? await noticeAddress(c.env.DB, p.id) : to;
  if (!address) return;
  await sendEmail(c.env, {
    to: address,
    subject: "A change to your EELS Data Base account",
    text: `An administrator of the EELS Data Base changed your account on ${when()}:\n\n${change}\n\nIf you did not expect this, please contact us: ${new URL(c.req.url).origin}/contact/`,
  });
}

adminUsers.use("/admin/users/*", async (c, next) => {
  if (c.get("user")!.role !== "admin") return c.text("Only admins can manage accounts.", 403);
  await next();
});

const personRow = (db: D1Database, id: number) => db.prepare("SELECT id, display_name, role, slug FROM users WHERE id = ?").bind(id).first<Person>();
const pageUrl = (id: number, notice?: string) => `/admin/users/${id}/${notice ? `?notice=${notice}` : ""}`;

/** The search behind the list and the merge picker; ?1 is the LIKE pattern and ?2 the account number. */
function searchWhere(q: string) {
  if (!q) return { where: "", args: [] as unknown[] };
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const esc = (col: string) => `${col} LIKE ?1 ESCAPE '\\'`;
  const where = `WHERE (${esc("u.display_name")} OR ${esc("u.slug")} OR ${esc("u.orcid")} OR ${esc("u.legacy_email")} OR u.id = ?2
       OR EXISTS (SELECT 1 FROM user_emails e WHERE e.user_id = u.id AND ${esc("e.email")})
       OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = 'orcid' AND ${esc("i.subject")}))`;
  return { where, args: [like, /^\d+$/.test(q) ? Number(q) : -1] };
}

// ---- List -----------------------------------------------------------------------------------

adminUsers.get("/admin/users/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(c.req.query("page"))) || 1);
  const { where, args } = searchWhere(q);
  const db = c.env.DB;
  const [total, { results }] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(...args).first<number>("n"),
    db.prepare(
      `SELECT u.id, u.display_name, u.slug, u.role, u.created_at, (SELECT COUNT(*) FROM spectra s WHERE s.owner_id = u.id AND s.status = 'published') AS spectra
       FROM users u ${where} ORDER BY u.role = 'user', u.role != 'admin', u.display_name COLLATE NOCASE, u.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    ).bind(...args).all<any>(),
  ]);
  const pages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
  const href = (n: number) => `/admin/users/?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
  return c.html(
    <Layout title="Accounts" path="/admin/" user={c.get("user")}>
      <p class="small back-link"><a href="/admin/">← Moderation</a></p>
      <h1>Accounts</h1>
      <form method="get" action="/admin/users/" class="inline-form" role="search">
        <input type="search" name="q" value={q} aria-label="Name, username, email address or ORCID iD" placeholder="Name, username, email address or ORCID iD" size={40} />
        <button class="button secondary" type="submit">Search</button>
        {q && <a href="/admin/users/">Clear</a>}
      </form>
      <p class="muted">{total} {total === 1 ? "account" : "accounts"}{q ? ` matching “${q}”` : ""}. Administrators and moderators come first.</p>
      <div class="table-scroll admin-users">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th class="num">Spectra</th><th class="num">Joined</th></tr></thead>
          <tbody>
            {results.map((u) => (
              <tr>
                <td><a href={pageUrl(u.id)}>{u.display_name}</a></td>
                <td>{u.slug}</td>
                <td>{u.role}</td>
                <td class="num">{u.spectra}</td>
                <td class="num">{String(u.created_at).slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {results.length === 0 && <p class="muted">No accounts found.</p>}
      {pages > 1 && (
        <nav class="pager" aria-label="Pages">
          {page > 1 && <a href={href(page - 1)} rel="prev">Previous</a>}
          <span aria-current="page">Page {page} of {pages}</span>
          {page < pages && <a href={href(page + 1)} rel="next">Next</a>}
        </nav>
      )}
    </Layout>,
  );
});

// ---- User page ------------------------------------------------------------------------------

async function renderUser(c: C, id: number, form?: { values: Record<string, string>; errors: Record<string, string> }) {
  const db = c.env.DB;
  const linksOn = await methodOn(c.env, "email_link");
  const [{ results: [u] }, { results: emails }, { results: identities }, { results: totpRows }, { results: passkeys }, { results: sessionRows }, { results: log }, { results: spectra }, { results: submissions }, { results: instruments }] =
    await db.batch<any>([
      db.prepare(
        `SELECT u.id, u.display_name, u.slug, u.role, u.created_at, u.avatar_key, u.orcid, u.password_hash IS NOT NULL AS has_password,
                u.legacy_password_hash IS NOT NULL AS has_legacy_password, ${HAS_PAGE_SQL} AS has_page,
                (SELECT COUNT(*) FROM spectra s WHERE s.owner_id = u.id AND s.status = 'draft') AS drafts
         FROM users u WHERE u.id = ?`,
      ).bind(id),
      db.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE user_id = ? ORDER BY is_primary DESC, verified DESC, email").bind(id),
      db.prepare("SELECT provider, subject, email FROM identities WHERE user_id = ? ORDER BY provider, subject").bind(id),
      db.prepare(
        `SELECT t.enabled_at, (SELECT COUNT(*) FROM recovery_codes r WHERE r.user_id = t.user_id AND r.used_at IS NULL) AS codes_left
         FROM user_totp t WHERE t.user_id = ?`,
      ).bind(id),
      db.prepare("SELECT name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at, name").bind(id),
      db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?").bind(id, new Date().toISOString()),
      db.prepare(
        `SELECT a.at, a.action, a.details_json, a.admin_id, u.display_name AS admin FROM admin_actions a JOIN users u ON u.id = a.admin_id
         WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 50`,
      ).bind(id),
      db.prepare("SELECT slug, title, status FROM spectra WHERE owner_id = ? AND status != 'draft' ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50").bind(id),
      db.prepare("SELECT b.id, b.status, s.title FROM submissions b JOIN spectra s ON s.id = b.spectrum_id WHERE b.submitted_by = ? ORDER BY b.id DESC LIMIT 50").bind(id),
      db.prepare("SELECT id, name, status FROM instruments WHERE created_by = ? ORDER BY id").bind(id),
    ]);
  if (!u) return null;
  const totp = totpRows[0] as { enabled_at: string | null; codes_left: number } | undefined;
  const totpOn = !!totp?.enabled_at;
  const v = form?.values ?? (await storedProfile(db, id));
  const errors = form?.errors ?? {};
  const base = `/admin/users/${id}`;
  const noticeText = form ? null : NOTICES[c.req.query("notice") ?? ""];
  const origin = new URL(c.req.url).origin;
  const staff = u.role !== "user";
  return (
    <Layout title={`Account: ${u.display_name}`} path="/admin/" user={c.get("user")}>
      <div class="settings">
        <p class="small back-link"><a href="/admin/users/">← Accounts</a></p>
        <div class="profile-head">
          <Avatar name={u.display_name} seed={u.slug ?? u.display_name} src={u.avatar_key ? `/avatars/${u.avatar_key}` : null} class="av-large" />
          <div>
            <h1>{u.display_name}</h1>
            <p class="muted profile-facts">
              Account {u.id} · {u.role} · joined {String(u.created_at).slice(0, 10)}
              {u.has_page ? <> · <a href={`/author/${u.slug}/`}>public page</a></> : " · no public page"}
            </p>
          </div>
        </div>
        {noticeText && <p class="notice" role="status">{noticeText}</p>}

        <section class="settings-section" aria-labelledby="h-profile">
          <h2 id="h-profile">Profile</h2>
          {Object.keys(errors).length > 0 && <p class="notice error-summary" role="alert">Some fields need attention. Nothing was saved.</p>}
          <form method="post" action={`${base}/profile/`} class="settings-form">
            <ProfileFields v={v} errors={errors} origin={origin} orcidLocked={identities.some((i: any) => i.provider === "orcid")} who="their" />
            <div><button class="button" type="submit">Save profile</button></div>
          </form>
          {u.avatar_key && (
            <form method="post" action={`${base}/avatar/remove/`}>
              <button class="link-button danger" type="submit">Remove the uploaded picture</button>
            </form>
          )}
        </section>

        <section class="settings-section" aria-labelledby="h-role">
          <h2 id="h-role">Role</h2>
          <form method="post" action={`${base}/`} class="inline-form role-form">
            <select name="role" aria-label="Role">{ROLES.map((r) => <option value={r} selected={u.role === r}>{r}</option>)}</select>
            <button class="button secondary" type="submit">Save</button>
          </form>
          <p class="hint">Moderators and admins need two-step sign-in; without it their role does nothing.</p>
        </section>

        <section class="settings-section" aria-labelledby="h-emails">
          <h2 id="h-emails">Email addresses</h2>
          <p class="hint">
            An address you add stays unconfirmed until the person opens the link we email to it. Admins cannot confirm one, because a confirmed address signs in by email link.
          </p>
          {emails.length > 0 && (
            <EmailList
              emails={emails as EmailRow[]}
              base={`${base}/emails`}
              extra={(e) => e.verified && linksOn ? <form method="post" action={`${base}/emails/${e.id}/login-link/`}><button class="link-button" type="submit">Send sign-in link</button></form> : null}
            />
          )}
          <form method="post" action={`${base}/emails/`} class="inline-form">
            <input type="email" name="email" required aria-label="Email address to add" placeholder="name@example.org" />
            <button class="button secondary" type="submit">Add address</button>
          </form>
        </section>

        <section class="settings-section" aria-labelledby="h-signin">
          <h2 id="h-signin">Sign-in</h2>
          <dl class="meta">
            {identities.map((i: any) => (
              <>
                <dt>{PROVIDERS[i.provider]?.label ?? i.provider}</dt>
                <dd>
                  {i.provider === "orcid" ? i.subject : i.email ?? "Connected"}{" "}
                  <form method="post" action={`${base}/identities/unlink/`} class="inline-form">
                    <input type="hidden" name="provider" value={i.provider} />
                    <input type="hidden" name="subject" value={i.subject} />
                    <button class="link-button danger" type="submit">Unlink</button>
                  </form>
                </dd>
              </>
            ))}
            <dt>Password</dt>
            <dd>
              {u.has_password ? "Set" : u.has_legacy_password ? "Set (from the old site)" : "None"}{" "}
              {(u.has_password || u.has_legacy_password) && (
                <form method="post" action={`${base}/password/remove/`} class="inline-form">
                  <button class="link-button danger" type="submit">Remove password</button>
                </form>
              )}
            </dd>
            <dt>Authenticator app</dt>
            <dd>{totpOn ? `On, ${totp!.codes_left} recovery ${totp!.codes_left === 1 ? "code" : "codes"} left` : "Off"}</dd>
            <dt>Passkeys</dt>
            <dd>
              {passkeys.length === 0 ? "None" : (
                <ul class="plain">
                  {passkeys.map((p: any) => <li>{p.name}, added {String(p.created_at).slice(0, 10)}, {p.last_used_at ? `last used ${String(p.last_used_at).slice(0, 10)}` : "never used"}</li>)}
                </ul>
              )}
            </dd>
            <dt>Sessions</dt>
            <dd>{sessionRows[0].n} active</dd>
          </dl>
          <p class="hint">
            For someone locked out: reset two-step sign-in, or remove the password{linksOn && ", then send a sign-in link to a confirmed address"}. Both sign the person out everywhere, and the person gets an email.
            {staff && " Their role does nothing until they set two-step sign-in up again."}
          </p>
          <div class="account-actions">
            <form method="post" action={`${base}/two-step/reset/`}><button class="button secondary" type="submit">Reset two-step sign-in</button></form>
            <form method="post" action={`${base}/sessions/end/`}><button class="button secondary" type="submit">Sign out everywhere</button></form>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="h-work">
          <h2 id="h-work">Their work</h2>
          <h3>Spectra</h3>
          {spectra.length ? <ul>{spectra.map((s: any) => <li><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a> ({s.status})</li>)}</ul> : <p class="muted">None.</p>}
          <h3>Submissions</h3>
          {submissions.length ? <ul>{submissions.map((s: any) => <li><a href={`/admin/submissions/${s.id}/`}>{s.title}</a> ({s.status.replace("_", " ")})</li>)}</ul> : <p class="muted">None.</p>}
          <h3>Drafts</h3>
          <p class="muted">{u.drafts} {u.drafts === 1 ? "draft" : "drafts"}, visible only to their owner.</p>
          <h3>Instrument profiles</h3>
          {instruments.length ? <ul>{instruments.map((i: any) => <li><a href={`/instruments/${i.id}/`}>{i.name}</a> ({i.status})</li>)}</ul> : <p class="muted">None.</p>}
        </section>

        <section class="settings-section" aria-labelledby="h-merge">
          <h2 id="h-merge">Merge another account into this one</h2>
          <p class="hint">For one person with two accounts. You pick the other account and see what moves before anything changes. This account's name, profile, role and username are kept.</p>
          <form method="get" action={`${base}/merge/`} class="inline-form" role="search">
            <input type="search" name="q" required aria-label="Name, username, email address, ORCID iD or account number of the other account" placeholder="Name, username, email address or ORCID iD" size={40} />
            <button class="button secondary" type="submit">Find the other account</button>
          </form>
        </section>

        <section class="settings-section" aria-labelledby="h-log">
          <h2 id="h-log">Log</h2>
          {log.length ? (
            <div class="table-scroll">
              <table>
                <thead><tr><th>When (UTC)</th><th>Change</th><th>Details</th><th>By</th></tr></thead>
                <tbody>
                  {log.map((a: any) => (
                    <tr>
                      <td>{String(a.at).slice(0, 16)}</td>
                      <td>{ACTION_LABELS[a.action] ?? a.action}</td>
                      <td>{Object.entries(JSON.parse(a.details_json ?? "{}")).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : x}`).join("; ")}</td>
                      <td><a href={pageUrl(a.admin_id)}>{a.admin}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p class="muted">No changes yet.</p>}
        </section>
      </div>
    </Layout>
  );
}

adminUsers.get("/admin/users/:id/", async (c) => {
  const id = Number(c.req.param("id"));
  if (id === c.get("user")!.id) return c.redirect("/account/settings/");
  const view = await renderUser(c, id);
  return view ? c.html(view) : c.notFound();
});

// ---- Merge ----------------------------------------------------------------------------------

adminUsers.get("/admin/users/:id/merge/", async (c) => {
  const id = Number(c.req.param("id"));
  const adminId = c.get("user")!.id;
  if (id === adminId) return c.redirect("/account/settings/");
  const kept = await personRow(c.env.DB, id);
  if (!kept) return c.notFound();
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const { where, args } = searchWhere(q);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.slug, u.role FROM users u ${where || "WHERE 1"} AND u.id NOT IN (${id}, ${adminId}) ORDER BY u.display_name COLLATE NOCASE, u.id LIMIT 20`,
  ).bind(...args).all<Person>();
  return c.html(
    <Layout title="Merge an account" path="/admin/" user={c.get("user")}>
      <p class="small back-link"><a href={pageUrl(id)}>← {kept.display_name}</a></p>
      <h1>Merge an account into {kept.display_name}</h1>
      <form method="get" action={`/admin/users/${id}/merge/`} class="inline-form" role="search">
        <input type="search" name="q" value={q} aria-label="Name, username, email address, ORCID iD or account number" placeholder="Name, username, email address or ORCID iD" size={40} />
        <button class="button secondary" type="submit">Search</button>
      </form>
      {results.length ? (
        <ul>
          {results.map((u) => <li><a href={`/admin/users/${id}/merge/${u.id}/`}>{u.display_name}</a> (account {u.id}{u.slug ? `, ${u.slug}` : ""}{u.role !== "user" ? `, ${u.role}` : ""})</li>)}
        </ul>
      ) : <p class="muted">No other accounts found. You cannot merge your own account.</p>}
    </Layout>,
  );
});

const list = (xs: string[]) => (xs.length ? <ul>{xs.map((x) => <li>{x}</li>)}</ul> : <p class="muted">Nothing.</p>);

/** Refuses the same account twice and the admin's own account on either side. */
async function mergePair(c: C) {
  const db = c.env.DB;
  const keptId = Number(c.req.param("id"));
  const goneId = Number(c.req.param("other"));
  if (keptId === goneId || keptId === c.get("user")!.id || goneId === c.get("user")!.id) return null;
  const [kept, gone] = await Promise.all([accountFacts(db, keptId), accountFacts(db, goneId)]);
  return kept && gone ? { kept, gone } : undefined;
}

function renderMerge(c: C, kept: Facts, gone: Facts, error?: string) {
  const plan = mergePlan(kept, gone);
  const row = (label: string, f: (x: Facts) => unknown) => <tr><th scope="row">{label}</th><td>{f(kept) as any}</td><td>{f(gone) as any}</td></tr>;
  const methods = (x: Facts) =>
    [...x.identities.map((i) => i.provider), x.has_password && "password", x.totp && "authenticator app", x.passkeys > 0 && `${x.passkeys} ${x.passkeys === 1 ? "passkey" : "passkeys"}`].filter(Boolean).join(", ") || "None";
  const addresses = (x: Facts) => (x.emails.length ? <ul class="plain">{x.emails.map((e) => <li>{e.email}{e.verified ? "" : " (unconfirmed)"}{e.is_primary ? ", primary" : ""}</li>)}</ul> : "None");
  const bothAdmins = kept.role === "admin" && gone.role === "admin";
  return (
    <Layout title="Merge accounts" path="/admin/" user={c.get("user")}>
      <p class="small back-link"><a href={pageUrl(kept.id)}>← {kept.display_name}</a></p>
      <h1>Merge {gone.display_name} into {kept.display_name}</h1>
      <p>
        Everything that belongs to <strong>{gone.display_name}</strong> (account {gone.id}) moves to <strong>{kept.display_name}</strong> (account {kept.id}),
        and account {gone.id} is deleted. This cannot be undone.
      </p>
      {error && <p class="notice error-summary" role="alert">{error}</p>}
      <div class="table-scroll">
        <table>
          <thead><tr><td></td><th scope="col">Kept: {kept.display_name}</th><th scope="col">Merged away: {gone.display_name}</th></tr></thead>
          <tbody>
            {row("Account", (x) => x.id)}
            {row("Name", (x) => x.display_name)}
            {row("Username", (x) => x.slug ?? "None")}
            {row("Role", (x) => x.role)}
            {row("Email addresses", addresses)}
            {row("Sign-in methods", methods)}
            {row("Recovery codes left", (x) => (x.totp ? x.recovery_codes : "None"))}
            {row("Active sessions", (x) => x.sessions)}
            {row("Spectra", (x) => x.spectra)}
            {row("Drafts", (x) => x.drafts)}
            {row("Submissions", (x) => x.submissions)}
            {row("Instrument profiles", (x) => x.instruments)}
            {row("Favourites", (x) => x.favourites)}
            {row("Access tokens", (x) => x.tokens)}
          </tbody>
        </table>
      </div>
      <h2>What moves</h2>
      {list([
        `${gone.spectra} ${gone.spectra === 1 ? "spectrum" : "spectra"} and ${gone.drafts} ${gone.drafts === 1 ? "draft" : "drafts"}, with the kept name and username as author`,
        "Submissions, edit history, instrument profiles and the decisions on them",
        `${gone.favourites} ${gone.favourites === 1 ? "favourite" : "favourites"} (ones the kept account has already stay once) and ${gone.tokens} access ${gone.tokens === 1 ? "token" : "tokens"}`,
        "The admin log entries about this account and made by it",
        ...plan.moves,
      ])}
      <h2>What is dropped</h2>
      {list(plan.drops)}
      <p>The kept account's name, profile, role and username win.{gone.role !== "user" && outranks(gone.role, kept.role) && ` ${gone.display_name} is ${gone.role === "admin" ? "an administrator" : "a moderator"}, which the kept account is not: the role is not moved. Change it on the account page afterwards if it should be.`}</p>
      <p>Both people get an email, where they have a confirmed address. The merged-away account's sessions end.</p>
      <form method="post" action={`/admin/users/${kept.id}/merge/${gone.id}/`}>
        {bothAdmins && (
          <p>
            <label><input type="checkbox" name="both_admins" value="1" /> Both accounts are administrators. I checked that they are the same person.</label>
          </p>
        )}
        <button class="button danger" type="submit">Merge the accounts</button>{" "}
        <a href={pageUrl(kept.id)}>Cancel</a>
      </form>
    </Layout>
  );
}

adminUsers.get("/admin/users/:id/merge/:other/", async (c) => {
  if (Number(c.req.param("id")) === c.get("user")!.id) return c.redirect("/account/settings/");
  const pair = await mergePair(c);
  if (pair === null) return c.text("You cannot merge your own account, or an account into itself.", 400);
  if (!pair) return c.notFound();
  return c.html(renderMerge(c, pair.kept, pair.gone));
});

// ---- Actions --------------------------------------------------------------------------------

/** Every action needs a recent sign-in, is refused on one's own account, and ends in a redirect to the user page with a notice. */
function action(path: string, run: (c: C, p: Person) => Promise<string | Response>) {
  adminUsers.post(`/admin/users/:id/${path}`, async (c) => {
    const id = Number(c.req.param("id"));
    if (id === c.get("user")!.id) return c.text("Use your own settings to change your own account.", 400);
    const p = await personRow(c.env.DB, id);
    if (!p) return c.notFound();
    if (!(await signedInRecently(c))) return c.redirect(pageUrl(id, "stale"));
    const result = await run(c, p);
    return typeof result === "string" ? c.redirect(pageUrl(id, result)) : result;
  });
}

const originOf = (c: C) => new URL(c.req.url).origin;
const intro = (p: Person) => `Someone added this address to the account "${p.display_name}" on the EELS Data Base.`;

action("", async (c, p) => {
  const role = String((await c.req.parseBody()).role);
  if (!ROLES.includes(role)) return c.text("Unknown role.", 400);
  if (role === p.role) return "role";
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, p.id).run();
  if (role !== "user") await authorSlug(c.env.DB, p);
  await record(c, p, "role_changed", { from: p.role, to: role }, `Your role was changed to ${role}.`);
  return "role";
});

action("profile/", async (c, p) => {
  const before = await storedProfile(c.env.DB, p.id);
  const failed = await saveProfile(c.env.DB, p.id, await c.req.parseBody());
  if (failed) return c.html((await renderUser(c, p.id, failed))!, 422);
  const after = await storedProfile(c.env.DB, p.id);
  const fields = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  if (fields.length) await record(c, p, "profile_edited", { fields });
  return "profile";
});

action("avatar/remove/", async (c, p) => {
  await removeAvatar(c.env, p.id);
  await record(c, p, "avatar_removed", {});
  return "avatar-removed";
});

action("emails/", async (c, p) => {
  const email = String((await c.req.parseBody()).email ?? "").trim().toLowerCase();
  const result = await addEmail(c.env, originOf(c), p.id, email, intro(p));
  if (result === "sent") {
    await record(c, p, "email_added", { email }, `The address ${email} was added to your account. It cannot be used to sign in until it is confirmed.`);
  }
  return result;
});

const withEmail = (run: (c: C, p: Person, row: EmailRow) => Promise<string | Response>) => async (c: C, p: Person) => {
  const row = await emailOf(c.env.DB, p.id, Number(c.req.param("eid")));
  return row ? run(c, p, row) : c.notFound();
};

action("emails/:eid/send/", withEmail(async (c, p, row) => {
  await resendVerification(c.env, originOf(c), p.id, row, intro(p));
  await record(c, p, "email_verification_sent", { email: row.email });
  return "sent";
}));

action("emails/:eid/primary/", withEmail(async (c, p, row) => {
  if (!row.verified) return c.notFound();
  await makePrimary(c.env.DB, p.id, row);
  await record(c, p, "email_primary_changed", { email: row.email });
  return "primary";
}));

action("emails/:eid/remove/", withEmail(async (c, p, row) => {
  const to = await noticeAddress(c.env.DB, p.id);
  const result = await removeEmail(c.env.DB, row);
  if (result === "removed") await record(c, p, "email_removed", { email: row.email }, `The address ${row.email} was removed from your account.`, to);
  return result;
}));

action("emails/:eid/login-link/", withEmail(async (c, p, row) => {
  if (!row.verified) return c.notFound();
  if (!(await methodOn(c.env, "email_link"))) return "link-off";
  await sendLoginLink(c.env, originOf(c), row.email, null);
  await record(c, p, "login_link_sent", { email: row.email });
  return "link-sent";
}));

action("identities/unlink/", async (c, p) => {
  const body = await c.req.parseBody();
  const done = await c.env.DB.prepare("DELETE FROM identities WHERE user_id = ? AND provider = ? AND subject = ?")
    .bind(p.id, String(body.provider), String(body.subject)).run();
  if (!done.meta.changes) return c.notFound();
  const label = PROVIDERS[String(body.provider)]?.label ?? String(body.provider);
  await record(c, p, "identity_unlinked", { provider: String(body.provider) }, `Your ${label} sign-in was unlinked from your account.`);
  return "unlinked";
});

action("password/remove/", async (c, p) => {
  const done = await c.env.DB.prepare("UPDATE users SET password_hash = NULL, legacy_password_hash = NULL WHERE id = ? AND (password_hash IS NOT NULL OR legacy_password_hash IS NOT NULL)")
    .bind(p.id).run();
  if (!done.meta.changes) return "no-password";
  await signOutEverywhere(c.env.DB, p.id);
  await record(c, p, "password_removed", {}, "Your password was removed and you were signed out everywhere. You can still sign in with an email link to a confirmed address.");
  return "password-removed";
});

action("two-step/reset/", async (c, p) => {
  const db = c.env.DB;
  const has = await db.prepare("SELECT EXISTS (SELECT 1 FROM user_totp WHERE user_id = ?1) OR EXISTS (SELECT 1 FROM passkeys WHERE user_id = ?1) AS has").bind(p.id).first<number>("has");
  if (!has) return "no-two-step";
  await db.batch([
    db.prepare("DELETE FROM user_totp WHERE user_id = ?").bind(p.id),
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(p.id),
    db.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(p.id),
    db.prepare("DELETE FROM login_challenges WHERE user_id = ?").bind(p.id),
    db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").bind(p.id),
    db.prepare("UPDATE users SET mfa_all_methods = 0 WHERE id = ?").bind(p.id),
  ]);
  await signOutEverywhere(db, p.id);
  const staff = p.role !== "user" ? " Your role does nothing until you set two-step sign-in up again." : "";
  await record(c, p, "two_step_reset", {}, `Two-step sign-in was reset: your authenticator app, recovery codes and passkeys were removed, and you were signed out everywhere.${staff}`);
  return "two-step-reset";
});

action("sessions/end/", async (c, p) => {
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(p.id).first<number>("n");
  await signOutEverywhere(c.env.DB, p.id);
  await record(c, p, "sessions_ended", { sessions: count ?? 0 }, "You were signed out of the EELS Data Base everywhere.");
  return "signed-out";
});

action("merge/:other/", async (c, p) => {
  const pair = await mergePair(c);
  if (pair === null) return c.text("You cannot merge your own account, or an account into itself.", 400);
  if (!pair) return c.notFound();
  const { kept, gone } = pair;
  if (kept.role === "admin" && gone.role === "admin" && (await c.req.parseBody()).both_admins !== "1") {
    return c.html(renderMerge(c, kept, gone, "Both accounts are administrators. Tick the box to confirm they are the same person."), 422);
  }
  const keptTo = await noticeAddress(c.env.DB, kept.id);
  const goneTo = await noticeAddress(c.env.DB, gone.id);
  const { droppedAvatar } = await mergeAccounts(c.env.DB, gone.id, kept.id);
  if (droppedAvatar) await c.env.FILES.delete(`avatars/${droppedAvatar}`);
  await record(
    c, p, "accounts_merged", { merged_id: gone.id, merged_name: gone.display_name },
    `The account "${gone.display_name}" was merged into this one. Its spectra, favourites and sign-in methods now belong here. Your name, username and role did not change.`,
    keptTo,
  );
  if (goneTo) {
    await sendEmail(c.env, {
      to: goneTo,
      subject: "Your EELS Data Base account was merged",
      text: `An administrator of the EELS Data Base merged your account "${gone.display_name}" into the account "${kept.display_name}" on ${when()}. Its spectra, favourites and email addresses now belong to that account, and you were signed out of this one. Please sign in with the other account from now on.\n\nIf you did not expect this, please contact us: ${originOf(c)}/docs/about/contact/`,
    });
  }
  return "merged";
});
