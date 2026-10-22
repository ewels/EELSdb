import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { sent } from "../src/email";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const API = "https://api.eelsdb.eu";
const go = (path: string, cookie = "", init: RequestInit = {}) =>
  exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as object) } });
const post = (path: string, body: Record<string, string>, cookie = "") =>
  go(path, cookie, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
const where = (res: Response) => res.headers.get("location");
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
const run = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).run();
const value = (key: string) => env.DB.prepare("SELECT value FROM site_settings WHERE key = ?").bind(key).first<string>("value");
const set = (group: string, v: "0" | "1") => run("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)", `require_2fa_${group}`, v);
const REDIRECT = "/account/settings/two-step/?notice=two-step-required#h-two-step";

let nextId = 9970001;
const person = async (role: string, opts: { totp?: boolean; passkey?: boolean } = {}) => {
  const id = nextId++;
  const cookie = await sessionFor({ id, display_name: `Group ${role} ${id}`, role }, { totp: opts.totp ?? (role !== "user" ? true : false) });
  if (opts.totp === true && role === "user") await run("INSERT OR IGNORE INTO user_totp (user_id, secret, enabled_at) VALUES (?, 'JBSWY3DPEHPK3PXP', datetime('now'))", id);
  if (opts.passkey) await run("INSERT INTO passkeys (user_id, credential_id, public_key, counter, name) VALUES (?, ?, 'k', 0, 'Key')", id, `cred-${id}`);
  await run("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)", id, `group${id}@example.invalid`);
  return { id, cookie, email: `group${id}@example.invalid` };
};

afterEach(async () => {
  await run("DELETE FROM site_settings WHERE key LIKE 'require_2fa_%'");
});

async function signInByLink(email: string) {
  await post("/login/email/", { email });
  const token = sent[sent.length - 1].text.match(/\/login\/email\/([^/\s]+)\//)![1];
  return post(`/login/email/${token}/`, {});
}

describe("defaults", () => {
  it("admins and moderators on, other users off", async () => {
    const admin = await person("admin", { totp: false });
    expect((await go("/admin/", admin.cookie)).status).toBe(302);
    const mod = await person("moderator", { totp: false });
    expect(where(await go("/admin/", mod.cookie))).toBe(REDIRECT);
    const user = await person("user");
    expect((await go("/account/", user.cookie)).status).toBe(200);
  });
});

describe("admins and moderators", () => {
  for (const [role, route] of [["admin", "/admin/users/"], ["moderator", "/admin/"]] as const) {
    it(`${role}: on, no 2FA means no role; off, the role works without 2FA`, async () => {
      const p = await person(role, { totp: false });
      expect(where(await go(route, p.cookie))).toBe(REDIRECT);
      await set(role, "0");
      expect((await go(route, p.cookie)).status).toBe(200);
      await set(role, "1");
      expect(where(await go(route, p.cookie))).toBe(REDIRECT);
    });
  }

  it("a group's switch does not change the other group", async () => {
    const mod = await person("moderator", { totp: false });
    const admin = await person("admin", { totp: false });
    await set("admin", "0");
    expect(where(await go("/admin/", mod.cookie))).toBe(REDIRECT);
    expect((await go("/admin/users/", admin.cookie)).status).toBe(200);
  });

  it("with the switch on, staff with 2FA are asked for the second step after email link and providers; off, they are asked as ordinary users are", async () => {
    const mod = await person("moderator");
    expect(where(await signInByLink(mod.email))).toBe("/login/second-step/");
    await set("moderator", "0");
    // An email link always asks an account with 2FA.
    expect(where(await signInByLink(mod.email))).toBe("/login/second-step/");
    const { completeSignIn } = await import("../src/auth");
    const asked = async (method: "github" | "orcid") => {
      const { Hono } = await import("hono");
      const app = new Hono<any>();
      app.get("/", (c) => completeSignIn(c, mod.id, { method }));
      return where(await app.request("/", {}, env));
    };
    expect(await asked("github")).toBe("/account/");
    await run("UPDATE users SET mfa_all_methods = 1 WHERE id = ?", mod.id);
    expect(await asked("github")).toBe("/login/second-step/");
    await run("UPDATE users SET mfa_all_methods = 0 WHERE id = ?", mod.id);
    await set("moderator", "1");
    expect(await asked("orcid")).toBe("/login/second-step/");
  });
});

describe("other users", () => {
  const pages = ["/account/", "/account/drafts/", "/submit-data/", "/account/submissions/", "/account/settings/profile/"];

  it("off: users without 2FA use every page", async () => {
    const u = await person("user");
    for (const p of ["/account/", "/account/drafts/", "/submit-data/"]) expect((await go(p, u.cookie)).status).toBe(200);
  });

  it("on: users without 2FA are sent to the two-step part of settings from every account page, once", async () => {
    await set("user", "1");
    const u = await person("user");
    for (const p of pages.slice(0, 4)) expect(where(await go(p, u.cookie))).toBe(REDIRECT);
    expect(where(await post("/account/settings/profile/", { display_name: "X" }, u.cookie))).toBe(REDIRECT);
    expect(where(await post("/account/drafts/", {}, u.cookie))).toBe(REDIRECT);
    const settings = await go("/account/settings/two-step/?notice=two-step-required", u.cookie);
    expect(settings.status).toBe(200);
    expect(where(await go("/account/emails/verify/not-a-token/", u.cookie))).not.toBe(REDIRECT);
    const html = await (await go("/account/settings/two-step/", u.cookie)).text();
    expect(html).toContain("This site requires two-step sign-in");
  });

  it("on: settings, the two-step and passkey parts and sign-out stay reachable; public pages work", async () => {
    await set("user", "1");
    const u = await person("user");
    expect((await go("/account/settings/two-step/", u.cookie)).status).toBe(200);
    expect(where(await post("/account/settings/two-step/start/", {}, u.cookie))).not.toBe(REDIRECT);
    const options = await go("/account/settings/passkeys/options/", u.cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(options.status).toBe(200);
    expect(where(await post("/logout/", {}, u.cookie))).not.toBe(REDIRECT);
    for (const p of ["/", "/spectra/", "/moderators/"]) expect((await go(p, u.cookie)).status).toBe(200);
  });

  it("on: users with an authenticator app or a passkey are not redirected", async () => {
    await set("user", "1");
    const a = await person("user", { totp: true });
    const b = await person("user", { passkey: true });
    expect((await go("/account/", a.cookie)).status).toBe(200);
    expect((await go("/account/", b.cookie)).status).toBe(200);
  });

  it("on: accounts with 2FA are asked for the second step after every method but a passkey", async () => {
    await set("user", "1");
    const u = await person("user", { totp: true });
    const { completeSignIn } = await import("../src/auth");
    const { Hono } = await import("hono");
    const asked = async (method: "github" | "passkey") => {
      const app = new Hono<any>();
      app.get("/", (c) => completeSignIn(c, u.id, { method }));
      return where(await app.request("/", {}, env));
    };
    expect(await asked("github")).toBe("/login/second-step/");
    expect(await asked("passkey")).toBe("/account/");
    await set("user", "0");
    expect(await asked("github")).toBe("/account/");
  });

  it("on: staff acting as users (their own switch off, no 2FA, role kept) are not redirected; downgraded staff are", async () => {
    await set("user", "1");
    await set("moderator", "0");
    const mod = await person("moderator", { totp: false });
    expect((await go("/account/", mod.cookie)).status).toBe(200);
    await set("moderator", "1");
    expect(where(await go("/account/", mod.cookie))).toBe(REDIRECT);
  });

  it("drafts tokens stop working for accounts without 2FA while it is on", async () => {
    const u = await person("user");
    const html = await (await post("/account/settings/tokens/", { label: "t" }, u.cookie)).text();
    const token = html.match(/eelsdb_draft_[0-9a-f]{48}/)![0];
    const draft = () => {
      const fd = new FormData();
      fd.append("file", new File(["#FORMAT : EMSA/MAS Spectral Data File\n#SPECTRUM : x\n280.0, 1\n280.1, 2\n280.2, 3\n"], "c.msa"));
      return exports.default.fetch(`${API}/v2/drafts`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    };
    expect((await draft()).status).not.toBe(401);
    await set("user", "1");
    expect((await draft()).status).toBe(401);
    await run("INSERT INTO passkeys (user_id, credential_id, public_key, counter, name) VALUES (?, ?, 'k', 0, 'Key')", u.id, `cred-${u.id}`);
    expect((await draft()).status).not.toBe(401);
  });
});

describe("the settings form and its guards", () => {
  const save = (cookie: string, body: Record<string, string>) => post("/admin/settings/two-step/", body, cookie);
  const confirmed = (extra: Record<string, string>) => ({ admin: "1", moderator: "1", step: "confirm", ...extra });

  it("switching users on shows a confirmation with the count and saves nothing until it is typed", async () => {
    const admin = await person("admin");
    const without = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users u WHERE u.role = 'user' AND NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)").first<number>("n"))!;
    const first = await save(admin.cookie, { admin: "1", moderator: "1", user: "1" });
    expect(first.status).toBe(200);
    const html = await first.text();
    expect(html).toContain("Require two-step sign-in for all other users?");
    expect(html).toContain(`To confirm, type the number of accounts that will have to set it up: ${without}`);
    expect(await value("require_2fa_user")).toBeNull();

    const wrong = await save(admin.cookie, confirmed({ user: "1", confirm_count: String(without + 1) }));
    expect(wrong.status).toBe(422);
    expect(await value("require_2fa_user")).toBeNull();

    const ok = await save(admin.cookie, confirmed({ user: "1", confirm_count: ` ${without} ` }));
    expect(where(ok)).toBe("/admin/settings/?notice=saved");
    expect(await value("require_2fa_user")).toBe("1");
    const log = await env.DB.prepare("SELECT changes_json, details_json FROM site_settings_log ORDER BY id DESC LIMIT 1").first<any>();
    expect(JSON.parse(log.changes_json)).toEqual({ require_2fa_user: "1" });
    expect(JSON.parse(log.details_json).without_2fa.user).toBe(without);
    expect(await (await go("/admin/settings/", admin.cookie)).text()).toContain("required two-step sign-in for all other users");
  });

  it("a group with nobody to affect needs a ticked box", async () => {
    const admin = await person("admin");
    await run("UPDATE users SET role = 'user' WHERE role = 'moderator' AND id < 9970000");
    await set("moderator", "0");
    await run("DELETE FROM users WHERE role = 'moderator' AND id >= 9970000");
    const moderatorsWithout = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users u WHERE u.role = 'moderator' AND NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)").first<number>("n"))!;
    expect(moderatorsWithout).toBe(0);
    const page = await (await save(admin.cookie, { admin: "1", moderator: "1" })).text();
    expect(page).toContain('name="confirm"');
    expect((await save(admin.cookie, { admin: "1", moderator: "1", step: "confirm" })).status).toBe(422);
    expect(where(await save(admin.cookie, { admin: "1", moderator: "1", step: "confirm", confirm: "1" }))).toBe("/admin/settings/?notice=saved");
    expect(await value("require_2fa_moderator")).toBe("1");
  });

  it("switching off needs no confirmation and is logged", async () => {
    const admin = await person("admin");
    expect(where(await save(admin.cookie, { admin: "1", user: "" }))).toBe("/admin/settings/?notice=saved");
    expect(await value("require_2fa_moderator")).toBe("0");
    expect(await (await go("/admin/settings/", admin.cookie)).text()).toContain("stopped requiring two-step sign-in for moderators");
  });

  it("refuses switching admins on when the admin has no 2FA", async () => {
    await set("admin", "0");
    const bare = await person("admin", { totp: false });
    const refused = await save(bare.cookie, { admin: "1", moderator: "1", step: "confirm", confirm: "1" });
    expect(refused.status).toBe(422);
    expect(await (refused.text())).toContain("Set up two-step sign-in on your own account first");
    expect(await value("require_2fa_admin")).toBe("0");

    const withKey = await person("admin", { totp: false });
    await run("INSERT INTO passkeys (user_id, credential_id, public_key, counter, name) VALUES (?, ?, 'k', 0, 'Key')", withKey.id, `cred-${withKey.id}`);
    const bareAdmins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users u WHERE u.role = 'admin' AND NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)").first<number>("n");
    const ok = await save(withKey.cookie, { admin: "1", moderator: "1", step: "confirm", confirm_count: String(bareAdmins) });
    expect(where(ok)).toBe("/admin/settings/?notice=saved");
    expect(await value("require_2fa_admin")).toBe("1");
  });

  it("needs a recent sign-in and an admin", async () => {
    const mod = await person("moderator");
    expect((await save(mod.cookie, { admin: "1" })).status).toBe(403);
  });
});

describe("contact recipients follow the admin switch", () => {
  it("with it on only admins with 2FA are recipients; off, every admin is", async () => {
    const { recipients } = await import("../src/contact");
    const keyed = await person("admin");
    const bare = await person("admin", { totp: false });
    const on = await recipients(env);
    expect(on).toContain(keyed.email);
    expect(on).not.toContain(bare.email);
    await set("admin", "0");
    const off = await recipients(env);
    expect(off).toContain(keyed.email);
    expect(off).toContain(bare.email);
  });
});
