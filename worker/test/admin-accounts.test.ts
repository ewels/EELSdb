import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/auth";
import { sent } from "../src/email";
import { pbkdf2Hash } from "../src/legacy-password";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const go = (path: string, cookie = "", init: RequestInit = {}) =>
  exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as object) } });
const post = (path: string, cookie: string, body: Record<string, string> = {}) =>
  go(path, cookie, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
const row = <T,>(sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const count = (sql: string, ...args: unknown[]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).bind(...args).first<number>("n").then((n) => n ?? 0);

let nextId = 9920100;
const admin = () => sessionFor({ id: ++nextId, display_name: "Account Admin", role: "admin" }).then((cookie) => ({ id: nextId, cookie }));

/** An ordinary account with a confirmed address, a password and a session. */
async function person(opts: { name?: string; slug?: string; verified?: boolean; password?: boolean } = {}) {
  const id = ++nextId;
  const email = `p${id}@example.invalid`;
  await env.DB.prepare("INSERT INTO users (id, display_name, slug, password_hash, legacy_password_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(id, opts.name ?? `Person ${id}`, opts.slug ?? null, opts.password === false ? null : await pbkdf2Hash("a long password"), opts.password === false ? null : "$P$Bold").run();
  await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, ?, 1)").bind(id, email, opts.verified === false ? 0 : 1).run();
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").bind(await sha256(token), id).run();
  return { id, email, cookie: `eelsdb_session=${token}` };
}

const staleCookie = async (userId: number) => {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'))")
    .bind(await sha256(token), userId).run();
  return `eelsdb_session=${token}`;
};
const log = (userId: number) => env.DB.prepare("SELECT action, details_json, admin_id FROM admin_actions WHERE user_id = ? ORDER BY id").bind(userId).all<any>().then((r) => r.results);
const mailTo = (to: string) => sent.filter((m) => m.to === to);

describe("find accounts", () => {
  it("searches by name, username, any address, ORCID iD and id, and lists accounts with no sign-in", async () => {
    const a = await admin();
    const p = await person({ name: "Zebulon Quirk", slug: "zquirk" });
    await env.DB.prepare("UPDATE users SET orcid = '0000-0002-1825-0097' WHERE id = ?").bind(p.id).run();
    await env.DB.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)").bind(p.id, `second${p.id}@example.invalid`).run();
    const find = async (q: string) => (await (await go(`/admin/users/?q=${encodeURIComponent(q)}`, a.cookie)).text());
    for (const q of ["zebulon", "zquirk", p.email, `SECOND${p.id}@example`, "0000-0002-1825", String(p.id)]) {
      expect(await find(q), q).toContain(`/admin/users/${p.id}/`);
    }
    expect(await find("no-such-person-anywhere")).toContain("No accounts found");
    expect(await (await go("/admin/users/", a.cookie)).text()).toContain(`/admin/users/${p.id}/`);
    expect(await find("100%")).toContain("No accounts found");
  });

  it("pages the list", async () => {
    const a = await admin();
    await env.DB.batch(Array.from({ length: 55 }, (_, i) => env.DB.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").bind(9930000 + i, `Pager Person ${String(i).padStart(2, "0")}`)));
    const first = await (await go("/admin/users/?q=Pager+Person", a.cookie)).text();
    expect(first).toContain("Pager Person 00");
    expect(first).not.toContain("Pager Person 54");
    expect(first).toContain("Page 1 of 2");
    expect(await (await go("/admin/users/?q=Pager+Person&page=2", a.cookie)).text()).toContain("Pager Person 54");
  });

  it("is for admins only", async () => {
    const mod = await sessionFor({ id: ++nextId, display_name: "Account Mod", role: "moderator" });
    const p = await person();
    expect((await go("/admin/users/", mod)).status).toBe(403);
    expect((await go(`/admin/users/${p.id}/`, mod)).status).toBe(403);
    expect((await post(`/admin/users/${p.id}/sessions/end/`, mod)).status).toBe(403);
    expect((await post(`/admin/users/${p.id}/`, mod, { role: "admin" })).status).toBe(403);
    expect(await row("SELECT role FROM users WHERE id = ?", p.id).then((r: any) => r.role)).toBe("user");
    expect((await go("/admin/users/")).status).toBe(302);
  });

  it("names in the queue link to the account page for admins, not for moderators", async () => {
    const a = await admin();
    const mod = await sessionFor({ id: ++nextId, display_name: "Queue Mod", role: "moderator" });
    const p = await person({ name: "Queue Submitter" });
    const spectrum = await env.DB.prepare("INSERT INTO spectra (slug, status, title, type, owner_id) VALUES (?, 'pending', 'Queue spectrum', 'lowloss', ?) RETURNING id")
      .bind(`queue-${p.id}`, p.id).first<number>("id");
    await env.DB.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status) VALUES (?, ?, 'pending')").bind(spectrum, p.id).run();
    expect(await (await go("/admin/", a.cookie)).text()).toContain(`<a href="/admin/users/${p.id}/">Queue Submitter</a>`);
    const asMod = await (await go("/admin/", mod)).text();
    expect(asMod).toContain("Queue Submitter");
    expect(asMod).not.toContain(`/admin/users/${p.id}/`);
  });
});

describe("user page", () => {
  it("shows the sign-in facts without secrets", async () => {
    const a = await admin();
    const p = await person({ name: "Facts Person" });
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject, email, email_verified) VALUES (?, 'github', '4242', 'gh@example.invalid', 1)").bind(p.id).run();
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, 'SECRETSECRETSECRET', datetime('now'))").bind(p.id).run();
    await env.DB.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, 'h1'), (?, 'h2')").bind(p.id, p.id).run();
    await env.DB.prepare("INSERT INTO passkeys (credential_id, user_id, public_key, name) VALUES ('cred-facts', ?, 'KEYKEYKEY', 'Laptop key')").bind(p.id).run();
    const html = await (await go(`/admin/users/${p.id}/`, a.cookie)).text();
    for (const text of [p.email, "GitHub", "gh@example.invalid", "On, 2 recovery codes left", "Laptop key", "1 active", "Remove password"]) expect(html).toContain(text);
    for (const secret of ["SECRETSECRETSECRET", "KEYKEYKEY", "pbkdf2", "$P$Bold", "cred-facts"]) expect(html).not.toContain(secret);
    expect((await go("/admin/users/999999999/", a.cookie)).status).toBe(404);
  });

  it("sends an admin who opens their own page to their settings", async () => {
    const a = await admin();
    expect((await go(`/admin/users/${a.id}/`, a.cookie)).headers.get("location")).toBe("/account/settings/profile/");
  });
});

describe("profile", () => {
  it("is edited with the checks of the person's own settings, and logged", async () => {
    const a = await admin();
    const p = await person({ name: "Old Name", slug: "old-name" });
    const other = await person({ slug: "taken-name" });
    const bad = await post(`/admin/users/${p.id}/profile/`, a.cookie, { display_name: "Edited", username: "taken-name", orcid: "nonsense", link_github: "not a link" });
    expect(bad.status).toBe(422);
    const html = await bad.text();
    expect(html).toContain("That username is taken.");
    expect(await row<any>("SELECT display_name, slug FROM users WHERE id = ?", p.id)).toMatchObject({ display_name: "Old Name", slug: "old-name" });
    expect(await log(p.id)).toEqual([]);
    expect(other.id).not.toBe(p.id);

    const ok = await post(`/admin/users/${p.id}/profile/`, a.cookie, { display_name: "New Name", username: "new-name", job_title: "Microscopist", show_details: "1", show_links: "1" });
    expect(ok.headers.get("location")).toBe(`/admin/users/${p.id}/?notice=profile`);
    expect(await row<any>("SELECT display_name, slug, job_title, show_details FROM users WHERE id = ?", p.id)).toEqual({ display_name: "New Name", slug: "new-name", job_title: "Microscopist", show_details: 1 });
    expect(await row("SELECT slug FROM user_slug_history WHERE user_id = ?", p.id).then((r: any) => r.slug)).toBe("old-name");
    const entries = await log(p.id);
    expect(entries.map((e) => e.action)).toEqual(["profile_edited"]);
    expect(entries[0].admin_id).toBe(a.id);
    expect(JSON.parse(entries[0].details_json).fields).toEqual(expect.arrayContaining(["display_name", "username", "job_title"]));
  });

  it("drops the uploaded picture for initials or Gravatar, from the one profile form", async () => {
    const a = await admin();
    const withPicture = async () => {
      const p = await person();
      await env.FILES.put(`avatars/${p.id}/pic.png`, new Uint8Array([1]));
      await env.DB.prepare("UPDATE users SET avatar_key = ? WHERE id = ?").bind(`${p.id}/pic.png`, p.id).run();
      return p;
    };
    const p = await withPicture();
    const page = await (await go(`/admin/users/${p.id}/`, a.cookie)).text();
    expect(page).toContain('name="picture" id="f-picture-upload" value="upload" checked=""');
    expect(page).not.toContain('type="file"');
    expect(page).not.toContain("/avatar/remove/");
    expect(page).not.toContain("/gravatar/");

    expect((await post(`/admin/users/${p.id}/profile/`, a.cookie, { display_name: `Person ${p.id}`, picture: "initials" })).headers.get("location")).toBe(`/admin/users/${p.id}/?notice=profile`);
    expect(await row<any>("SELECT avatar_key, use_gravatar FROM users WHERE id = ?", p.id)).toEqual({ avatar_key: null, use_gravatar: 0 });
    expect(await env.FILES.get(`avatars/${p.id}/pic.png`)).toBeNull();
    expect((await log(p.id)).map((e) => e.action)).toEqual(["avatar_removed"]);

    const g = await withPicture();
    await post(`/admin/users/${g.id}/profile/`, a.cookie, { display_name: `Person ${g.id}`, picture: "gravatar" });
    expect(await row<any>("SELECT avatar_key, use_gravatar FROM users WHERE id = ?", g.id)).toEqual({ avatar_key: null, use_gravatar: 1 });
    expect(await env.FILES.get(`avatars/${g.id}/pic.png`)).toBeNull();
    const entries = await log(g.id);
    expect(entries.map((e) => e.action)).toEqual(["avatar_removed", "profile_edited"]);
    expect(JSON.parse(entries[1].details_json).fields).toEqual(["picture"]);
  });

  it("cannot pick an uploaded picture that is not there", async () => {
    const a = await admin();
    const p = await person();
    const res = await post(`/admin/users/${p.id}/profile/`, a.cookie, { display_name: `Person ${p.id}`, picture: "upload" });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("There is no uploaded picture to keep.");
    expect(await log(p.id)).toEqual([]);
  });
});

describe("email addresses", () => {
  it("adds an unconfirmed address, whatever the form says, emails its link, and tells the person at their confirmed address", async () => {
    const a = await admin();
    const p = await person();
    const added = `added${p.id}@example.invalid`;
    await post(`/admin/users/${p.id}/emails/`, a.cookie, { email: added, verified: "1" });
    expect(await row<any>("SELECT verified, is_primary FROM user_emails WHERE email = ?", added)).toEqual({ verified: 0, is_primary: 0 });
    expect(mailTo(added).at(-1)!.text).toMatch(/\/account\/emails\/verify\/[\w-]+\//);
    const notice = mailTo(p.email).at(-1)!;
    expect(notice.text).toContain(added);
    expect(notice.text).not.toContain("Account Admin");
    expect(mailTo(added).every((m) => !m.text.includes("An administrator"))).toBe(true);
    expect((await log(p.id)).map((e) => e.action)).toEqual(["email_added"]);
    expect((await post(`/admin/users/${p.id}/emails/`, a.cookie, { email: "not an address" })).headers.get("location")).toContain("notice=email-bad");
  });

  it("has no route that confirms an address, and the link works only for the person", async () => {
    const a = await admin();
    const p = await person();
    await post(`/admin/users/${p.id}/emails/`, a.cookie, { email: `later${p.id}@example.invalid` });
    const id = await row<number>("SELECT id FROM user_emails WHERE email = ?", `later${p.id}@example.invalid`).then((r: any) => r.id);
    for (const path of ["verify", "confirm", "verified"]) expect((await post(`/admin/users/${p.id}/emails/${id}/${path}/`, a.cookie)).status).toBe(404);
    const token = mailTo(`later${p.id}@example.invalid`).at(-1)!.text.match(/verify\/([\w-]+)\//)![1];
    await go(`/account/emails/verify/${token}/`, a.cookie);
    expect(await row("SELECT verified FROM user_emails WHERE id = ?", id).then((r: any) => r.verified)).toBe(0);
    await go(`/account/emails/verify/${token}/`, p.cookie);
    expect(await row("SELECT verified FROM user_emails WHERE id = ?", id).then((r: any) => r.verified)).toBe(1);
  });

  it("resends a link, changes the primary and removes an address, but not the primary", async () => {
    const a = await admin();
    const p = await person();
    const extra = `extra${p.id}@example.invalid`;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 0)").bind(p.id, extra).run();
    const extraId = await row<number>("SELECT id FROM user_emails WHERE email = ?", extra).then((r: any) => r.id);
    const primaryId = await row<number>("SELECT id FROM user_emails WHERE email = ?", p.email).then((r: any) => r.id);
    const before = mailTo(extra).length;
    await post(`/admin/users/${p.id}/emails/${extraId}/send/`, a.cookie);
    expect(mailTo(extra).length).toBe(before + 1);
    expect((await post(`/admin/users/${p.id}/emails/${extraId}/primary/`, a.cookie)).status).toBe(404);
    expect((await post(`/admin/users/${p.id}/emails/${primaryId}/remove/`, a.cookie)).headers.get("location")).toContain("notice=keep-primary");
    const mails = mailTo(p.email).length;
    await post(`/admin/users/${p.id}/emails/${extraId}/remove/`, a.cookie);
    expect(await count("SELECT 1 FROM user_emails WHERE id = ?", extraId)).toBe(0);
    expect(mailTo(p.email).length).toBe(mails + 1);
    expect(mailTo(p.email).at(-1)!.text).toContain(extra);

    const second = `second${p.id}@example.invalid`;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(p.id, second).run();
    const secondId = await row<number>("SELECT id FROM user_emails WHERE email = ?", second).then((r: any) => r.id);
    await post(`/admin/users/${p.id}/emails/${secondId}/primary/`, a.cookie);
    expect(await row("SELECT is_primary FROM user_emails WHERE id = ?", secondId).then((r: any) => r.is_primary)).toBe(1);
    expect((await log(p.id)).map((e) => e.action)).toEqual(["email_verification_sent", "email_removed", "email_primary_changed"]);
    expect((await post(`/admin/users/${a.id}/emails/${secondId}/remove/`, a.cookie)).status).toBe(400);
  });

  it("does not reach another account's address", async () => {
    const a = await admin();
    const p = await person();
    const q = await person();
    const qEmail = await row<number>("SELECT id FROM user_emails WHERE user_id = ?", q.id).then((r: any) => r.id);
    expect((await post(`/admin/users/${p.id}/emails/${qEmail}/remove/`, a.cookie)).status).toBe(404);
    expect(await count("SELECT 1 FROM user_emails WHERE id = ?", qEmail)).toBe(1);
  });

  it("sends a sign-in link to a confirmed address; the admin never sees the token", async () => {
    const a = await admin();
    const p = await person();
    const unconfirmed = await person({ verified: false });
    const id = await row<number>("SELECT id FROM user_emails WHERE user_id = ?", p.id).then((r: any) => r.id);
    const res = await post(`/admin/users/${p.id}/emails/${id}/login-link/`, a.cookie);
    expect(res.headers.get("location")).toContain("notice=link-sent");
    expect(await res.text()).not.toMatch(/login\/email\/[\w-]{20,}/);
    const mail = mailTo(p.email).at(-1)!;
    const token = mail.text.match(/\/login\/email\/([\w-]+)\//)![1];
    expect(mail.subject).toBe("Your EELS Data Base sign-in link");
    const page = await (await go(`/admin/users/${p.id}/`, a.cookie)).text();
    expect(page).not.toContain(token);
    const signedIn = await post(`/login/email/${token}/`, "");
    expect(signedIn.headers.get("set-cookie")).toContain("eelsdb_session=");
    expect(await row("SELECT user_id FROM sessions ORDER BY rowid DESC LIMIT 1").then((r: any) => r.user_id)).toBe(p.id);
    const unconfirmedId = await row<number>("SELECT id FROM user_emails WHERE user_id = ?", unconfirmed.id).then((r: any) => r.id);
    expect((await post(`/admin/users/${unconfirmed.id}/emails/${unconfirmedId}/login-link/`, a.cookie)).status).toBe(404);
    expect((await log(p.id)).map((e) => e.action)).toEqual(["login_link_sent"]);
  });

  it("sends no notice, and does not fail, for an account with no confirmed address", async () => {
    const a = await admin();
    const p = await person({ verified: false });
    const before = sent.length;
    const res = await post(`/admin/users/${p.id}/sessions/end/`, a.cookie);
    expect(res.status).toBe(302);
    expect(sent.length).toBe(before);
    expect((await log(p.id)).map((e) => e.action)).toEqual(["sessions_ended"]);
  });
});

describe("sign-in methods and sessions", () => {
  it("unlinks a linked account and tells the person", async () => {
    const a = await admin();
    const p = await person();
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'google', ?)").bind(p.id, `g${p.id}`).run();
    await post(`/admin/users/${p.id}/identities/unlink/`, a.cookie, { provider: "google", subject: `g${p.id}` });
    expect(await count("SELECT 1 FROM identities WHERE user_id = ?", p.id)).toBe(0);
    expect(mailTo(p.email).at(-1)!.text).toContain("Google sign-in was unlinked");
    expect((await post(`/admin/users/${p.id}/identities/unlink/`, a.cookie, { provider: "google", subject: `g${p.id}` })).status).toBe(404);
    expect((await log(p.id)).map((e) => e.action)).toEqual(["identity_unlinked"]);
  });

  it("removes the password, both hashes, signs the person out everywhere and tells them", async () => {
    const a = await admin();
    const p = await person();
    const res = await post(`/admin/users/${p.id}/password/remove/`, a.cookie);
    expect(res.headers.get("location")).toContain("notice=password-removed");
    expect(await row<any>("SELECT password_hash, legacy_password_hash FROM users WHERE id = ?", p.id)).toEqual({ password_hash: null, legacy_password_hash: null });
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", p.id)).toBe(0);
    expect((await go("/account/", p.cookie)).status).toBe(302);
    expect(mailTo(p.email).at(-1)!.text).toContain("password was removed");
    expect((await post(`/admin/users/${p.id}/password/remove/`, a.cookie)).headers.get("location")).toContain("notice=no-password");
    expect((await log(p.id)).map((e) => e.action)).toEqual(["password_removed"]);
  });

  it("resets two-step sign-in: secret, recovery codes and passkeys go, sessions end, a moderator loses the role until set up again", async () => {
    const a = await admin();
    const mod = await sessionFor({ id: ++nextId, display_name: "Reset Mod", role: "moderator" });
    const modId = nextId;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)").bind(modId, `mod${modId}@example.invalid`).run();
    await env.DB.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, 'x')").bind(modId).run();
    await env.DB.prepare("INSERT INTO passkeys (credential_id, user_id, public_key, name) VALUES (?, ?, 'k', 'Key')").bind(`cred-${modId}`, modId).run();
    await env.DB.prepare("INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").bind(`c${modId}`, modId).run();
    await env.DB.prepare("UPDATE users SET mfa_all_methods = 1 WHERE id = ?").bind(modId).run();
    expect((await go("/admin/", mod)).status).toBe(200);

    await post(`/admin/users/${modId}/two-step/reset/`, a.cookie);
    for (const table of ["user_totp", "recovery_codes", "passkeys", "login_challenges"]) expect(await count(`SELECT 1 FROM ${table} WHERE user_id = ?`, modId), table).toBe(0);
    expect(await row("SELECT mfa_all_methods FROM users WHERE id = ?", modId).then((r: any) => r.mfa_all_methods)).toBe(0);
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", modId)).toBe(0);
    expect(await row("SELECT role FROM users WHERE id = ?", modId).then((r: any) => r.role)).toBe("moderator");
    const mail = mailTo(`mod${modId}@example.invalid`).at(-1)!;
    expect(mail.text).toContain("Two-step sign-in was reset");
    expect(mail.text).toContain("Your role does nothing");

    // A new session for the moderator has no role until two-step sign-in is back.
    const token = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").bind(await sha256(token), modId).run();
    expect((await go("/admin/", `eelsdb_session=${token}`)).headers.get("location")).toContain("two-step-required");
    expect((await post(`/admin/users/${modId}/two-step/reset/`, a.cookie)).headers.get("location")).toContain("notice=no-two-step");
    expect((await log(modId)).map((e) => e.action)).toEqual(["two_step_reset"]);
  });

  it("signs the person out everywhere", async () => {
    const a = await admin();
    const p = await person();
    await post(`/admin/users/${p.id}/sessions/end/`, a.cookie);
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", p.id)).toBe(0);
    expect(mailTo(p.email).at(-1)!.text).toContain("signed out");
    expect(JSON.parse((await log(p.id))[0].details_json)).toEqual({ sessions: 1 });
  });

  it("changes a role, gives staff a username, and tells the person; the role form is on the user page", async () => {
    const a = await admin();
    const p = await person({ name: "Role Person" });
    expect(await (await go(`/admin/users/${p.id}/`, a.cookie)).text()).toContain('name="role"');
    await post(`/admin/users/${p.id}/`, a.cookie, { role: "moderator" });
    expect(await row<any>("SELECT role, slug FROM users WHERE id = ?", p.id)).toMatchObject({ role: "moderator", slug: "role-person" });
    expect(mailTo(p.email).at(-1)!.text).toContain("changed to moderator");
    expect((await post(`/admin/users/${p.id}/`, a.cookie, { role: "wizard" })).status).toBe(400);
    expect(JSON.parse((await log(p.id))[0].details_json)).toEqual({ from: "user", to: "moderator" });
  });
});

describe("safety", () => {
  it("needs a sign-in in the last 15 minutes for every action", async () => {
    const a = await admin();
    const old = await staleCookie(a.id);
    const p = await person();
    const emailId = await row<number>("SELECT id FROM user_emails WHERE user_id = ?", p.id).then((r: any) => r.id);
    const attempts: [string, Record<string, string>][] = [
      ["", { role: "admin" }],
      ["profile/", { display_name: "Changed" }],
      ["emails/", { email: "x@example.invalid" }],
      [`emails/${emailId}/send/`, {}],
      [`emails/${emailId}/login-link/`, {}],
      [`emails/${emailId}/primary/`, {}],
      [`emails/${emailId}/remove/`, {}],
      ["identities/unlink/", { provider: "google", subject: "1" }],
      ["password/remove/", {}],
      ["two-step/reset/", {}],
      ["sessions/end/", {}],
    ];
    const mails = sent.length;
    for (const [path, body] of attempts) {
      const res = await post(`/admin/users/${p.id}/${path}`, old, body);
      expect(res.headers.get("location"), path).toBe(`/admin/users/${p.id}/?notice=stale`);
    }
    expect(await row<any>("SELECT role, display_name, password_hash IS NOT NULL AS pw FROM users WHERE id = ?", p.id)).toEqual({ role: "user", display_name: `Person ${p.id}`, pw: 1 });
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", p.id)).toBe(1);
    expect(await log(p.id)).toEqual([]);
    expect(sent.length).toBe(mails);
    expect(await (await go(`/admin/users/${p.id}/?notice=stale`, old)).text()).toContain("need a sign-in in the last 15 minutes");
  });

  it("refuses every action on one's own account, including the role", async () => {
    const a = await admin();
    const emailId = (await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1) RETURNING id").bind(a.id, `self${a.id}@example.invalid`).first<number>("id"))!;
    for (const path of ["", "profile/", "emails/", `emails/${emailId}/remove/`, `emails/${emailId}/login-link/`, "identities/unlink/", "password/remove/", "two-step/reset/", "sessions/end/"]) {
      expect((await post(`/admin/users/${a.id}/${path}`, a.cookie, { role: "user", email: "y@example.invalid" })).status, path).toBe(400);
    }
    expect(await row("SELECT role FROM users WHERE id = ?", a.id).then((r: any) => r.role)).toBe("admin");
    expect(await count("SELECT 1 FROM user_totp WHERE user_id = ?", a.id)).toBe(1);
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", a.id)).toBe(1);
    expect(await log(a.id)).toEqual([]);
  });

  it("never leaves the site without an admin: only another admin can lower an admin's role", async () => {
    const a = await admin();
    const b = await admin();
    await post(`/admin/users/${b.id}/`, a.cookie, { role: "user" });
    expect(await row("SELECT role FROM users WHERE id = ?", b.id).then((r: any) => r.role)).toBe("user");
    expect((await post(`/admin/users/${a.id}/`, a.cookie, { role: "user" })).status).toBe(400);
    expect((await post(`/admin/users/${a.id}/`, b.cookie, { role: "user" })).status).toBe(403);
  });

  it("keeps secrets and hashes out of the log", async () => {
    const a = await admin();
    const p = await person();
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, 'LOGSECRET', datetime('now'))").bind(p.id).run();
    await post(`/admin/users/${p.id}/password/remove/`, a.cookie);
    await post(`/admin/users/${p.id}/two-step/reset/`, a.cookie);
    const all = JSON.stringify(await log(p.id));
    expect(all).not.toMatch(/LOGSECRET|pbkdf2|\$P\$/);
    const html = await (await go(`/admin/users/${p.id}/`, a.cookie)).text();
    expect(html).toContain("Password removed");
    expect(html).toContain("Two-step sign-in reset");
  });
});
