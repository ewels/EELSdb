import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/auth";
import { pbkdf2Hash } from "../src/legacy-password";

const SITE = "https://eelsdb.eu";
const PHPASS = "$P$BabcdefghKfdE7H4Uy7ajxpijsjAJW0"; // "correct horse"
const BCRYPT = "$2b$04$Y65bD2bQwzw1PdrH4xO9ce.AQh12kQxXztCrt432LRlCTPmRHV5Au"; // "correct horse"

const post = (path: string, body: Record<string, string>, cookie?: string) =>
  exports.default.fetch(`${SITE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(body).toString(),
  });
const login = (user: string, password: string, extra: Record<string, string> = {}) => post("/login/password/", { login: user, password, ...extra });
const sessionOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("eelsdb_session=") && c.length > 15);

const legacyFlag = () => env as { LEGACY_PASSWORD_LOGIN?: string };
let n = 0;
async function mkUser(fields: { password?: string; legacyHash?: string; legacyLogin?: string; legacyEmail?: string; email?: string } = {}) {
  const id = (await env.DB.prepare("INSERT INTO users (display_name, legacy_login, legacy_email, password_hash, legacy_password_hash) VALUES ('Pw', ?, ?, ?, ?) RETURNING id")
    .bind(fields.legacyLogin ?? null, fields.legacyEmail ?? null, fields.password ? await pbkdf2Hash(fields.password) : null, fields.legacyHash ?? null)
    .first<number>("id"))!;
  if (fields.email) await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(id, fields.email).run();
  return id;
}
const unique = (p: string) => `${p}-${++n}-${crypto.randomUUID().slice(0, 6)}`;
const column = (id: number, col: string) => env.DB.prepare(`SELECT ${col} AS v FROM users WHERE id = ?`).bind(id).first<string | null>("v");

/** A session as created `minutesAgo` minutes ago. */
async function sessionAt(userId: number, minutesAgo: number) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, datetime('now', ?), datetime('now', '+1 day'))")
    .bind(await sha256(token), userId, `-${minutesAgo} minutes`).run();
  return `eelsdb_session=${token}`;
}
const sessionCount = (userId: number) => env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(userId).first<number>("n");

afterEach(() => {
  legacyFlag().LEGACY_PASSWORD_LOGIN = "1";
});

describe("email and password sign-in", () => {
  it("signs in with any verified address, case-insensitively, and returns to next", async () => {
    const email = `${unique("a")}@example.invalid`;
    await mkUser({ password: "a long password", email });
    const ok = await login(email.toUpperCase(), "a long password", { next: "/spectra/" });
    expect(ok.headers.get("location")).toBe("/spectra/");
    expect(sessionOf(ok)).toBeTruthy();
  });

  it("signs in with the username in the profile address, and an address wins over another account's username", async () => {
    const slug = unique("user");
    const id = await mkUser({ password: "a long password" });
    await env.DB.prepare("UPDATE users SET slug = ? WHERE id = ?").bind(slug, id).run();
    expect(sessionOf(await login(slug.toUpperCase(), "a long password"))).toBeTruthy();

    const email = `${unique("e")}@example.invalid`;
    await mkUser({ password: "the address owner", email });
    const other = await mkUser({ password: "the username owner" });
    await env.DB.prepare("UPDATE users SET slug = ? WHERE id = ?").bind(email, other).run();
    expect(sessionOf(await login(email, "the address owner"))).toBeTruthy();
  });

  it("does not say whether the account exists", async () => {
    const email = `${unique("b")}@example.invalid`;
    await mkUser({ password: "a long password", email });
    const wrong = await login(email, "not the password");
    const unknown = await login(`${unique("none")}@example.invalid`, "a long password");
    expect(wrong.headers.get("location")).toBe("/login/?error=password");
    expect(unknown.headers.get("location")).toBe("/login/?error=password");
    expect(sessionOf(wrong)).toBeUndefined();
  });

  it("does not accept an unverified address", async () => {
    const id = await mkUser({ password: "a long password" });
    const email = `${unique("c")}@example.invalid`;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 0)").bind(id, email).run();
    expect((await login(email, "a long password")).headers.get("location")).toBe("/login/?error=password");
  });

  it("locks a login after 10 wrong passwords, even for the right one", async () => {
    const email = `${unique("d")}@example.invalid`;
    await mkUser({ password: "a long password", email });
    for (let i = 0; i < 10; i++) expect((await login(email, "wrong")).headers.get("location")).toBe("/login/?error=password");
    const locked = await login(email, "a long password");
    expect(locked.headers.get("location")).toBe("/login/?error=locked");
    expect(sessionOf(locked)).toBeUndefined();
  });

  it("shows the password form on the login page whether or not the old-password flag is on", async () => {
    for (const flag of ["1", "0"]) {
      legacyFlag().LEGACY_PASSWORD_LOGIN = flag;
      const html = await (await exports.default.fetch(`${SITE}/login/`)).text();
      expect(html).toContain('action="/login/password/"');
      expect(html).not.toContain("Old EELSdb password");
    }
  });
});

describe("migrated passwords", () => {
  it.each([["phpass", PHPASS], ["bcrypt", BCRYPT]])("moves a %s hash to password_hash with the flag on", async (_, hash) => {
    const legacyLogin = unique("old");
    const id = await mkUser({ legacyHash: hash, legacyLogin, legacyEmail: `${legacyLogin}@lab.org` });
    expect((await login(legacyLogin, "nope")).headers.get("location")).toBe("/login/?error=password");
    expect(await column(id, "password_hash")).toBeNull();
    const ok = await login(`${legacyLogin}@LAB.org`, "correct horse");
    expect(sessionOf(ok)).toBeTruthy();
    expect(await column(id, "password_hash")).toMatch(/^\$pbkdf2-sha256\$/);
    expect(await column(id, "legacy_password_hash")).toBeNull();
    expect(sessionOf(await login(legacyLogin, "correct horse"))).toBeTruthy();
  });

  it("does not check legacy hashes with the flag off, and keeps them", async () => {
    legacyFlag().LEGACY_PASSWORD_LOGIN = "0";
    const legacyLogin = unique("off");
    const id = await mkUser({ legacyHash: PHPASS, legacyLogin });
    expect((await login(legacyLogin, "correct horse")).headers.get("location")).toBe("/login/?error=password");
    expect(await column(id, "legacy_password_hash")).toBe(PHPASS);
  });

  it("checks password_hash with the flag off", async () => {
    legacyFlag().LEGACY_PASSWORD_LOGIN = "0";
    const legacyLogin = unique("own");
    await mkUser({ password: "a long password", legacyLogin });
    expect(sessionOf(await login(legacyLogin, "a long password"))).toBeTruthy();
  });
});

describe("password settings", () => {
  it("sets a first password only after a fresh sign-in, then signs in with it", async () => {
    const email = `${unique("s")}@example.invalid`;
    const id = await mkUser({ email });
    const stale = await sessionAt(id, 60);
    expect((await post("/account/settings/password/", { new_password: "a long password" }, stale)).headers.get("location")).toContain("password-stale");
    expect(await column(id, "password_hash")).toBeNull();
    const cookie = await sessionAt(id, 1);
    expect((await post("/account/settings/password/", { new_password: "short" }, cookie)).headers.get("location")).toBe("/account/settings/?notice=password-short");
    expect(await column(id, "password_hash")).toBeNull();
    expect((await post("/account/settings/password/", { new_password: "x".repeat(201) }, cookie)).headers.get("location")).toContain("password-short");
    expect((await post("/account/settings/password/", { new_password: "a long password" }, cookie)).headers.get("location")).toContain("password-saved");
    expect(sessionOf(await login(email, "a long password"))).toBeTruthy();
  });

  it("needs the current password to change or remove when the sign-in is older than 15 minutes", async () => {
    const id = await mkUser({ password: "old password!" });
    const cookie = await sessionAt(id, 16);
    const before = await column(id, "password_hash");
    expect((await post("/account/settings/password/", { new_password: "brand new one" }, cookie)).headers.get("location")).toContain("password-wrong");
    expect((await post("/account/settings/password/", { new_password: "brand new one", current_password: "nope nope nope" }, cookie)).headers.get("location")).toContain("password-wrong");
    expect((await post("/account/settings/password/remove/", {}, cookie)).headers.get("location")).toContain("password-wrong");
    expect(await column(id, "password_hash")).toBe(before);
    expect((await post("/account/settings/password/", { new_password: "brand new one", current_password: "old password!" }, cookie)).headers.get("location")).toContain("password-saved");
    expect(await column(id, "password_hash")).not.toBe(before);
  });

  it("skips the current password after a sign-in in the last 15 minutes", async () => {
    const id = await mkUser({ password: "old password!" });
    const cookie = await sessionAt(id, 5);
    expect((await post("/account/settings/password/", { new_password: "brand new one" }, cookie)).headers.get("location")).toContain("password-saved");
    expect((await post("/account/settings/password/remove/", {}, cookie)).headers.get("location")).toContain("password-removed");
    expect(await column(id, "password_hash")).toBeNull();
  });

  it("asks for the current password on the page only when it is needed", async () => {
    const id = await mkUser({ password: "old password!" });
    const page = (cookie: string) => exports.default.fetch(`${SITE}/account/settings/`, { headers: { Cookie: cookie } }).then((r) => r.text());
    expect(await page(await sessionAt(id, 30))).toContain('name="current_password"');
    expect(await page(await sessionAt(id, 1))).not.toContain('name="current_password"');
  });

  it("locks wrong current passwords after 10 tries", async () => {
    const id = await mkUser({ password: "old password!" });
    const cookie = await sessionAt(id, 30);
    for (let i = 0; i < 10; i++) await post("/account/settings/password/", { new_password: "brand new one", current_password: "wrong" }, cookie);
    const res = await post("/account/settings/password/", { new_password: "brand new one", current_password: "old password!" }, cookie);
    expect(res.headers.get("location")).toContain("password-locked");
  });

  it("signs out the other sessions on change and removal, keeping this one", async () => {
    const id = await mkUser({ password: "old password!" });
    const mine = await sessionAt(id, 1);
    await sessionAt(id, 1);
    await sessionAt(id, 1);
    expect(await sessionCount(id)).toBe(3);
    await post("/account/settings/password/", { new_password: "brand new one" }, mine);
    expect(await sessionCount(id)).toBe(1);
    await sessionAt(id, 1);
    await post("/account/settings/password/remove/", {}, mine);
    expect(await sessionCount(id)).toBe(1);
    const page = await exports.default.fetch(`${SITE}/account/settings/`, { headers: { Cookie: mine }, redirect: "manual" });
    expect(page.status).toBe(200);
  });

  it("clears a leftover legacy hash when a new password is set", async () => {
    const id = await mkUser({ legacyHash: PHPASS });
    await post("/account/settings/password/", { new_password: "brand new one" }, await sessionAt(id, 1));
    expect(await column(id, "legacy_password_hash")).toBeNull();
  });
});
