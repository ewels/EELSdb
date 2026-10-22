import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/auth";
import { sent } from "../src/email";

const SITE = "https://eelsdb.eu";
const go = (path: string, init: RequestInit = {}) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init });
const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  go(path, {
    method: "POST",
    headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
const sessionOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("eelsdb_session=") && c.length > 15);

let n = 0;
const fresh = () => `link-${++n}-${crypto.randomUUID().slice(0, 6)}@example.invalid`;

/** Asks for a link and returns its token from the email that was "sent". */
async function requestLink(email: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const before = sent.length;
  const res = await post("/login/email/", { email, ...extra }, headers);
  expect(res.headers.get("location")).toBe("/login/?notice=sent");
  if (sent.length === before) return null;
  const mail = sent[sent.length - 1];
  expect(mail.to).toBe(email.toLowerCase());
  return mail.text.match(/\/login\/email\/([^/\s]+)\//)![1];
}

const mkUser = async (name: string, legacyEmail: string | null = null) =>
  (await env.DB.prepare("INSERT INTO users (display_name, legacy_email) VALUES (?, ?) RETURNING id").bind(name, legacyEmail).first<number>("id"))!;

const userIdFor = (email: string) => env.DB.prepare("SELECT user_id FROM user_emails WHERE email = ? AND verified = 1").bind(email).first<number>("user_id");

describe("email sign-in link", () => {
  it("shows the form on the login page and gives the same answer for every address", async () => {
    expect(await (await go("/login/")).text()).toContain("Email me a sign-in link");
    const known = fresh();
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(await mkUser("Known"), known).run();
    const a = await post("/login/email/", { email: known });
    const b = await post("/login/email/", { email: fresh() });
    const c = await post("/login/email/", { email: "not-an-address" });
    for (const r of [a, b, c]) expect(r.headers.get("location")).toBe("/login/?notice=sent");
    expect(await (await go("/login/?notice=sent")).text()).toContain("works for 15 minutes, once");
  });

  it("says in the email that the link works 15 minutes and once", async () => {
    const email = fresh();
    await requestLink(email);
    expect(sent[sent.length - 1].text).toMatch(/15 minutes and only once/);
  });

  it("limits links to 5 an hour per address, without telling the visitor", async () => {
    const email = fresh();
    for (let i = 0; i < 5; i++) expect(await requestLink(email, {}, { "CF-Connecting-IP": `10.0.0.${i}` })).toBeTruthy();
    expect(await requestLink(email, {}, { "CF-Connecting-IP": "10.0.1.1" })).toBeNull();
  });

  it("limits links to 30 an hour per IP", async () => {
    const ip = { "CF-Connecting-IP": "192.0.2.77" };
    for (let i = 0; i < 30; i++) expect(await requestLink(fresh(), {}, ip)).toBeTruthy();
    expect(await requestLink(fresh(), {}, ip)).toBeNull();
    expect(await requestLink(fresh(), {}, { "CF-Connecting-IP": "192.0.2.78" })).toBeTruthy();
  });

  it("a GET shows the button and does not sign in or use the link; a POST does", async () => {
    const email = fresh();
    const token = await requestLink(email);
    const page = await go(`/login/email/${token}/`);
    expect(page.status).toBe(200);
    expect(sessionOf(page)).toBeUndefined();
    expect(await page.text()).toContain("Sign in</button>");
    expect(await env.DB.prepare("SELECT used_at FROM login_links WHERE token_hash = ?").bind(await sha256(token!)).first("used_at")).toBeNull();

    expect((await post(`/login/email/${token}/`, {}, { Origin: "https://evil.example" })).status).toBe(403);
    const res = await post(`/login/email/${token}/`, {});
    expect(res.headers.get("location")).toBe("/account/");
    const cookie = sessionOf(res)!;
    expect(cookie).toBeTruthy();
    expect((await go("/account/", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("works once", async () => {
    const token = (await requestLink(fresh()))!;
    expect(sessionOf(await post(`/login/email/${token}/`, {}))).toBeTruthy();
    const again = await post(`/login/email/${token}/`, {});
    expect(sessionOf(again)).toBeUndefined();
    const page = await go(`/login/email/${token}/`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("Send a new link");
  });

  it("refuses an expired or unknown link, and offers a new one", async () => {
    const email = fresh();
    const token = (await requestLink(email))!;
    await env.DB.prepare("UPDATE login_links SET expires_at = ? WHERE token_hash = ?").bind(new Date(Date.now() - 1000).toISOString(), await sha256(token)).run();
    expect(sessionOf(await post(`/login/email/${token}/`, {}))).toBeUndefined();
    const page = await go(`/login/email/${token}/`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain(`Send a new link to ${email}`);
    expect((await go("/login/email/nope/")).status).toBe(410);
    expect(sessionOf(await post("/login/email/nope/", {}))).toBeUndefined();
  });

  it("signs in to the account that has the address verified", async () => {
    const email = fresh();
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(await mkUser("Verified"), email).run();
    const res = await post(`/login/email/${await requestLink(email.toUpperCase())}/`, {});
    const cookie = sessionOf(res)!;
    expect(await (await go("/account/", { headers: { Cookie: cookie } })).text()).toContain("Verified");
  });

  it("links an unclaimed migrated account by legacy_email and verifies the address", async () => {
    const email = fresh();
    const id = await mkUser("Migrated", email);
    const res = await post(`/login/email/${await requestLink(email)}/`, {});
    expect(sessionOf(res)).toBeTruthy();
    expect(await userIdFor(email)).toBe(id);
  });

  it("does not take a migrated account that already has a sign-in method", async () => {
    const email = fresh();
    const id = await mkUser("Claimed", email);
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'github', ?)").bind(id, `x-${id}`).run();
    await post(`/login/email/${await requestLink(email)}/`, {});
    expect(await userIdFor(email)).not.toBe(id);
  });

  it("makes a new account from the address", async () => {
    const email = fresh();
    const cookie = sessionOf(await post(`/login/email/${await requestLink(email)}/`, {}))!;
    const id = (await userIdFor(email))!;
    expect(id).toBeGreaterThan(0);
    const user = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(id).first<string>("display_name");
    expect(user).toBe(email.split("@")[0]);
    expect(await env.DB.prepare("SELECT is_primary FROM user_emails WHERE user_id = ? AND email = ?").bind(id, email).first("is_primary")).toBe(1);
    expect((await go("/account/", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("only returns to same-site paths", async () => {
    const good = await post(`/login/email/${await requestLink(fresh(), { next: "/spectra/" })}/`, {});
    expect(good.headers.get("location")).toBe("/spectra/");
    const bad = await post(`/login/email/${await requestLink(fresh(), { next: "https://evil.example/x" })}/`, {});
    expect(bad.headers.get("location")).toBe("/account/");
  });
});
