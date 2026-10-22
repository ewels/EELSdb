import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountsLockedOut, sha256 } from "../src/auth";
import { sent } from "../src/email";
import { pbkdf2Hash } from "../src/legacy-password";
import { SIGN_IN_METHODS } from "../src/settings";
import { SoftwareAuthenticator } from "./helpers/authenticator";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const go = (path: string, cookie = "", init: RequestInit = {}) =>
  exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as object) } });
const post = (path: string, body: Record<string, string>, cookie = "") =>
  go(path, cookie, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
const json = (path: string, body: unknown = {}, cookie = "") =>
  go(path, cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
const where = (res: Response) => res.headers.get("location");
const run = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).run();
const value = (key: string) => env.DB.prepare("SELECT value FROM site_settings WHERE key = ?").bind(key).first<string>("value");
const off = (...methods: string[]) => Promise.all(methods.map((m) => run("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, '0')", `signin_${m}`)));
const allOn = Object.fromEntries(SIGN_IN_METHODS.map((m) => [m, "1"]));
const without = (...methods: string[]) => Object.fromEntries(Object.entries(allOn).filter(([m]) => !methods.includes(m)));

let nextId = 9960001;
let n = 0;
const email = () => `switch-${++n}-${crypto.randomUUID().slice(0, 6)}@example.invalid`;

/** An account with exactly the ways in asked for. */
async function account(ways: { password?: string; email?: boolean; provider?: string; role?: string } = {}) {
  const id = nextId++;
  const address = email();
  await run("INSERT INTO users (id, display_name, role, password_hash) VALUES (?, 'Switch Person', ?, ?)", id, ways.role ?? "user", ways.password ? await pbkdf2Hash(ways.password) : null);
  if (ways.email || ways.password) await run("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, ?, 1)", id, address, ways.email ? 1 : 0);
  if (ways.provider) await run("INSERT INTO identities (user_id, provider, subject) VALUES (?, ?, ?)", id, ways.provider, `sub-${id}`);
  return { id, email: address };
}

/** An admin with two-step sign-in, a fresh session and a linked ORCID iD as their way in. */
async function admin(provider = "orcid") {
  const id = nextId++;
  const cookie = await sessionFor({ id, display_name: "Switch Admin", role: "admin" });
  if (provider) await run("INSERT INTO identities (user_id, provider, subject) VALUES (?, ?, ?)", id, provider, `admin-${id}`);
  return { id, cookie };
}

function stubProvider(profile: Record<string, any>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("token")) return Response.json({ access_token: "tok", orcid: profile.orcid, name: profile.name });
    if (u.endsWith("/user/emails")) return Response.json([]);
    if (u.endsWith("/email")) return Response.json({ email: [] });
    return Response.json(profile);
  });
  return calls;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await run("DELETE FROM site_settings WHERE key LIKE 'signin_%'");
});

describe("each switch hides and refuses its method", () => {
  for (const provider of ["orcid", "google", "github"]) {
    it(`${provider}: no button, start, callback and link refuse, settings offers no link`, async () => {
      const start = await go(`/auth/${provider}/start`);
      expect(start.status).toBe(302);
      await off(provider);
      expect(await (await go("/login/")).text()).not.toContain(`data-method="${provider}"`);
      expect(where(await go(`/auth/${provider}/start`))).toBe("/login/?error=off");
      expect(await (await go("/login/?error=off")).text()).toContain("switched off on this site");

      const calls = stubProvider({ orcid: "0000-0002-1111-2222", sub: "s", id: 1 });
      const state = new URL(where(start)!).searchParams.get("state")!;
      const callback = await go(`/auth/${provider}/callback?code=abc&state=${state}`, cookieOf(start, "eelsdb_oauth")!);
      expect(where(callback)).toBe("/login/?error=off");
      expect(calls).toEqual([]);

      const u = await sessionFor({ id: nextId++, display_name: "Linker" });
      expect(where(await go(`/auth/${provider}/link`, u))).toBe("/account/settings/sign-in/?notice=link-off#h-signin");
      expect(await (await go("/account/settings/sign-in/", u)).text()).not.toContain(`/auth/${provider}/link`);
    });
  }

  it("password: no form, sign-in refused even with the right password, and no setting a password", async () => {
    const a = await account({ password: "a long password", email: true });
    await off("password");
    const page = await (await go("/login/")).text();
    expect(page).not.toContain('data-method="password"');
    expect(page).not.toContain("Forgot your password?");
    const res = await post("/login/password/", { login: a.email, password: "a long password" });
    expect(where(res)).toBe("/login/?error=off");
    expect(cookieOf(res, "eelsdb_session")).toBeUndefined();

    const u = await sessionFor({ id: nextId++, display_name: "No Password" });
    const settings = await (await go("/account/settings/sign-in/", u)).text();
    expect(settings).not.toContain("Set password");
    expect(settings).toContain("Password sign-in is switched off");
    expect(where(await post("/account/settings/password/", { new_password: "another long password" }, u))).toContain("notice=password-off");
  });

  it("email link: no field, no email sent, link page and link refused without spending it", async () => {
    const a = await account({ email: true });
    await post("/login/email/", { email: a.email });
    const token = sent[sent.length - 1].text.match(/\/login\/email\/([^/\s]+)\//)![1];
    await off("email_link");
    expect(await (await go("/login/")).text()).not.toContain('id="email"');
    const before = sent.length;
    expect(where(await post("/login/email/", { email: a.email }))).toBe("/login/?error=off");
    expect(sent.length).toBe(before);
    const linkPage = await go(`/login/email/${token}/`);
    expect(linkPage.status).toBe(403);
    expect(await linkPage.text()).toContain("Email links are switched off");
    const res = await post(`/login/email/${token}/`, {});
    expect(where(res)).toBe("/login/?error=off");
    expect(cookieOf(res, "eelsdb_session")).toBeUndefined();
    expect(await env.DB.prepare("SELECT used_at FROM login_links WHERE token_hash = ?").bind(await sha256(token)).first("used_at")).toBeNull();
  });

  it("email link: admins cannot send a sign-in link", async () => {
    const a = await account({ email: true });
    const ad = await admin();
    const emailId = await env.DB.prepare("SELECT id FROM user_emails WHERE user_id = ?").bind(a.id).first<number>("id");
    expect(await (await go(`/admin/users/${a.id}/`, ad.cookie)).text()).toContain("Send sign-in link");
    await off("email_link");
    expect(await (await go(`/admin/users/${a.id}/`, ad.cookie)).text()).not.toContain("Send sign-in link");
    const before = sent.length;
    expect(where(await post(`/admin/users/${a.id}/emails/${emailId}/login-link/`, {}, ad.cookie))).toContain("link-off");
    expect(sent.length).toBe(before);
  });

  it("passkey: no button or script, options and verify refuse", async () => {
    await off("passkey");
    const page = await (await go("/login/")).text();
    expect(page).not.toContain('data-method="passkey"');
    expect(page).not.toContain("/passkeys.js");
    expect(page).not.toContain("webauthn");
    const options = await json("/login/passkey/options/");
    expect(options.status).toBe(403);
    expect((await options.json<any>()).error).toContain("switched off");
    expect((await json("/login/passkey/", { token: "x", response: {} })).status).toBe(403);
  });

  it("a provider switched off while its welcome page is open makes no account", async () => {
    const calls = stubProvider({ sub: `new-${nextId}`, name: "New Person", email: null });
    const start = await go("/auth/google/start");
    const state = new URL(where(start)!).searchParams.get("state")!;
    const cb = await go(`/auth/google/callback?code=abc&state=${state}`, cookieOf(start, "eelsdb_oauth")!);
    expect(where(cb)).toBe("/login/welcome/");
    expect(calls.length).toBeGreaterThan(0);
    await off("google");
    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<number>("n");
    expect(where(await go("/login/welcome/", cookieOf(cb, "eelsdb_pending")!))).toBe("/login/?error=off");
    expect(where(await post("/login/welcome/", {}, cookieOf(cb, "eelsdb_pending")!))).toBe("/login/?error=off");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<number>("n")).toBe(users);
  });

  it("does not end sessions that already exist", async () => {
    const u = await sessionFor({ id: nextId++, display_name: "Still Here" });
    await off("email_link", "password", "passkey", "google", "github");
    expect((await go("/account/", u)).status).toBe(200);
  });
});

describe("passkeys as the second step", () => {
  it("still work when passkey sign-in is off", async () => {
    const a = await account({ password: "a long password", email: true });
    const cookie = await sessionFor({ id: a.id, display_name: "Two Step" });
    const auth = new SoftwareAuthenticator();
    const reg = await (await json("/account/settings/passkeys/options/", {}, cookie)).json<any>();
    expect((await json("/account/settings/passkeys/", { token: reg.token, name: "Key", response: await auth.register(reg.options) }, cookie)).ok).toBe(true);
    await off("passkey");

    const first = await post("/login/password/", { login: a.email, password: "a long password" });
    expect(where(first)).toBe("/login/second-step/");
    const challenge = cookieOf(first, "eelsdb_second_step")!;
    expect(await (await go("/login/second-step/", challenge)).text()).toContain("Use a passkey");
    const { options, token } = await (await json("/login/second-step/passkey/options/", {}, challenge)).json<any>();
    const done = await json("/login/second-step/passkey/", { token, response: await auth.assert(options) }, challenge);
    expect(where(done)).toBe("/account/");
    expect(cookieOf(done, "eelsdb_session")).toBeTruthy();
  });
});

describe("the sign-in page with methods off", () => {
  it("makes the email link the primary when ORCID is off, and drops the or rule with nothing above it", async () => {
    await off("orcid");
    expect(await (await go("/login/")).text()).toContain('class="button" type="submit" data-method="email_link"');
    await off("google", "github", "passkey");
    expect(await (await go("/login/")).text()).not.toContain('class="auth-or"');
  });

  it("with ORCID only, shows ORCID alone and points old-site people to the claim", async () => {
    await off("google", "github", "passkey", "email_link", "password");
    const page = await (await go("/login/")).text();
    expect(page).toContain('data-method="orcid"');
    expect(page).not.toMatch(/data-method="(google|github|passkey|email_link|password)"/);
    expect(page).toContain("claim the old account");
  });
});

describe("the welcome page", () => {
  async function welcome() {
    stubProvider({ orcid: `0000-0003-0000-${nextId++}`, name: "Ori" });
    const start = await go("/auth/orcid/start");
    const state = new URL(where(start)!).searchParams.get("state")!;
    const cb = await go(`/auth/orcid/callback?code=abc&state=${state}`, cookieOf(start, "eelsdb_oauth")!);
    return (await go("/login/welcome/", cookieOf(cb, "eelsdb_pending")!)).text();
  }

  it("names only the other ways in that are on", async () => {
    await off("password", "github");
    const page = await welcome();
    expect(page).toContain("with Google, a passkey or an email link?");
    expect(page).toContain("Yes, sign in to my account");
  });

  it("asks to merge instead when the provider is the only method on", async () => {
    await off("google", "github", "passkey", "email_link", "password");
    const page = await welcome();
    expect(page).toContain("If you used EELSdb before with another sign-in, create this account and");
    expect(page).toContain('href="/contact/">ask us to merge them</a>');
    expect(page).not.toContain("Yes, sign in to my account");
    expect(page).toContain("Create my account");
  });
});

describe("the ORCID banner", () => {
  it("says ORCID is how you sign in, without a hide button, when ORCID is the only method on", async () => {
    const u = await sessionFor({ id: nextId++, display_name: "Unlinked" }, { email: true });
    let page = await (await go("/spectra/", u)).text();
    expect(page).toContain("Hide for 30 days");
    await off("google", "github", "passkey", "email_link", "password");
    page = await (await go("/spectra/", u)).text();
    expect(page).toContain("EELSdb now signs people in with ORCID only");
    expect(page).not.toContain("Hide for 30 days");
  });

  it("is not shown when ORCID sign-in is off, as nothing could be linked", async () => {
    const u = await sessionFor({ id: nextId++, display_name: "Unlinked Too" }, { email: true });
    await off("orcid");
    expect(await (await go("/spectra/", u)).text()).not.toContain('class="orcid-banner"');
  });
});

describe("counting accounts without a way in", () => {
  it("counts each kind of way in", async () => {
    const all = [...SIGN_IN_METHODS];
    const base = await Promise.all(all.map((m) => accountsLockedOut(env, [m])));
    const count = (m: (typeof all)[number]) => accountsLockedOut(env, [m]);
    const pw = await account({ password: "a long password" });
    const legacy = nextId++;
    await run("INSERT INTO users (id, display_name, legacy_email) VALUES (?, 'Old', ?)", legacy, email());
    await account({ provider: "github" });
    const nothing = await account();
    // Each new account is locked out of every method it does not have.
    expect(await count("password")).toBe(base[all.indexOf("password")] + 3);
    expect(await count("email_link")).toBe(base[all.indexOf("email_link")] + 3);
    expect(await count("github")).toBe(base[all.indexOf("github")] + 3);
    expect(await count("orcid")).toBe(base[all.indexOf("orcid")] + 4);
    expect(await accountsLockedOut(env, all, nothing.id)).toBe(1);
    expect(await accountsLockedOut(env, ["password"], pw.id)).toBe(0);
    expect(await accountsLockedOut(env, ["email_link"], legacy)).toBe(0);
    expect(await accountsLockedOut(env, [])).toBe(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<number>("n"));
  });
});

describe("admin switches", () => {
  it("are all on by default and show the counts next to them", async () => {
    const ad = await admin();
    const page = await (await go("/admin/settings/", ad.cookie)).text();
    for (const m of SIGN_IN_METHODS) expect(page).toMatch(new RegExp(`name="${m}"[^>]*checked`));
    const locked = await accountsLockedOut(env, [...SIGN_IN_METHODS]);
    expect(page).toContain(`Right now, ${locked} ${locked === 1 ? "account has" : "accounts have"} no switched-on way to sign in.`);
    expect(page).toContain("restores access straight away");
    expect(page).toMatch(/\d+ accounts? can sign in with it/);
  });

  it("refuse to switch every method off", async () => {
    const ad = await admin();
    const res = await post("/admin/settings/sign-in/", {}, ad.cookie);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("At least one way to sign in must stay on");
    expect(await value("signin_orcid")).toBeNull();
  });

  it("refuse a change that leaves the admin's own account with no switched-on way in", async () => {
    const ad = await admin("google");
    const res = await post("/admin/settings/sign-in/", without("google"), ad.cookie);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("This would lock you out");
    expect(await value("signin_google")).toBeNull();
  });

  it("need a recent sign-in", async () => {
    const ad = await admin();
    const stale = crypto.randomUUID();
    await run("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'))", await sha256(stale), ad.id);
    expect(where(await post("/admin/settings/sign-in/", without("password"), `eelsdb_session=${stale}`))).toBe("/admin/settings/?notice=stale");
  });

  it("ask for the typed number of locked-out accounts before switching off, then save and log the counts", async () => {
    const ad = await admin();
    await account({ password: "a long password" });
    const passwordUsers = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL OR legacy_password_hash IS NOT NULL").first<number>("n");
    const proposed = SIGN_IN_METHODS.filter((m) => m !== "password");
    const locked = await accountsLockedOut(env, proposed);
    expect(locked).toBeGreaterThan(0);

    const confirm = await post("/admin/settings/sign-in/", without("password"), ad.cookie);
    expect(confirm.status).toBe(200);
    const page = await confirm.text();
    expect(page).toContain("Switch off Passwords?");
    expect(page).toContain(`<p class="lockout-count">${locked} accounts would have no switched-on way to sign in.</p>`);
    expect(page).toContain(`<strong>Passwords</strong>: ${passwordUsers} accounts can sign in with it now.`);
    expect(page).toContain("stay signed in until their session ends");
    expect(page).toContain('name="confirm_count"');
    expect(await value("signin_password")).toBeNull();

    const wrong = await post("/admin/settings/sign-in/", { ...without("password"), step: "confirm", confirm_count: String(locked + 1) }, ad.cookie);
    expect(wrong.status).toBe(422);
    expect(await wrong.text()).toContain("does not match");
    expect(await value("signin_password")).toBeNull();
    const ticked = await post("/admin/settings/sign-in/", { ...without("password"), step: "confirm", confirm: "1" }, ad.cookie);
    expect(ticked.status).toBe(422);
    expect(await value("signin_password")).toBeNull();

    const done = await post("/admin/settings/sign-in/", { ...without("password"), step: "confirm", confirm_count: ` ${locked} ` }, ad.cookie);
    expect(where(done)).toBe("/admin/settings/?notice=saved");
    expect(await env.DB.prepare("SELECT value, updated_by FROM site_settings WHERE key = 'signin_password'").first()).toEqual({ value: "0", updated_by: ad.id });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM site_settings WHERE key LIKE 'signin_%'").first<number>("n")).toBe(1);
    const log = await env.DB.prepare("SELECT changed_by, changes_json, details_json FROM site_settings_log ORDER BY id DESC LIMIT 1").first<any>();
    expect(log.changed_by).toBe(ad.id);
    expect(JSON.parse(log.changes_json)).toEqual({ signin_password: "0" });
    expect(JSON.parse(log.details_json)).toMatchObject({ locked_out: locked, using: { password: passwordUsers } });
    const after = await (await go("/admin/settings/", ad.cookie)).text();
    expect(after).not.toMatch(/name="password"[^>]*checked/);
    expect(after).toContain("Switch Admin");
    expect(after).toContain("switched Passwords off");

    // Switching back on needs no confirmation.
    expect(where(await post("/admin/settings/sign-in/", allOn, ad.cookie))).toBe("/admin/settings/?notice=saved");
    expect(await value("signin_password")).toBe("1");
  });

  it("use the ORCID wording when ORCID would be the only method on", async () => {
    const ad = await admin();
    const page = await (await post("/admin/settings/sign-in/", { orcid: "1" }, ad.cookie)).text();
    const locked = await accountsLockedOut(env, ["orcid"]);
    expect(page).toContain(`${locked} accounts have no linked ORCID iD and would not be able to sign in.`);
  });

  it("ask only for a tick when no account would be locked out", async () => {
    const ad = await admin();
    // Every account in this file's database gets a linked GitHub account, so switching Google off locks no one out.
    await run("INSERT OR IGNORE INTO identities (user_id, provider, subject) SELECT id, 'github', 'all-' || id FROM users");
    const page = await (await post("/admin/settings/sign-in/", without("google"), ad.cookie)).text();
    expect(page).toContain("0 accounts would have no switched-on way to sign in.");
    expect(page).toContain('name="confirm"');
    expect(page).not.toContain('name="confirm_count"');
    expect(await value("signin_google")).toBeNull();
    expect(where(await post("/admin/settings/sign-in/", { ...without("google"), step: "confirm", confirm: "1" }, ad.cookie))).toBe("/admin/settings/?notice=saved");
    expect(await value("signin_google")).toBe("0");
  });
});
