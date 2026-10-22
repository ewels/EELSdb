import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sent } from "../src/email";
import { pbkdf2Hash } from "../src/legacy-password";
import { account } from "../src/pages/account";
import { base32Encode, stepAt, totpCode } from "../src/totp";
import { SoftwareAuthenticator } from "./helpers/authenticator";
import { sessionFor } from "./helpers/session";
import { createIfWelcomed } from "./helpers/welcome";

const SITE = "https://eelsdb.eu";
const go = (path: string, init: RequestInit = {}) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init });
const post = (path: string, body: Record<string, string>, cookie = "") =>
  go(path, {
    method: "POST",
    headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(body).toString(),
  });
const json = (path: string, body: unknown = {}, cookie = "") =>
  go(path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const setCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const cookieOf = (res: Response, name: string) => setCookie(res, name)?.split(";")[0];
/** The method the response hands to the next page, or undefined. */
const handedOff = (res: Response) => {
  const c = setCookie(res, "eelsdb_last_method");
  return c && !/Max-Age=0/i.test(c) ? c.split(";")[0].split("=")[1] : undefined;
};

let n = 0;
const fresh = () => `page-${++n}-${crypto.randomUUID().slice(0, 6)}@example.invalid`;

async function linkSignIn(email: string, cookie = "") {
  await post("/login/email/", { email });
  const token = sent[sent.length - 1].text.match(/\/login\/email\/([^/\s]+)\//)![1];
  return post(`/login/email/${token}/`, {}, cookie);
}

async function oauthSignIn(provider: "github" | "google" | "orcid", profile: Record<string, any>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("token")) return Response.json({ access_token: "tok", orcid: profile.orcid, name: profile.name });
    if (u.endsWith("/user/emails")) return Response.json([]);
    return Response.json(profile);
  });
  const start = await go(`/auth/${provider}/start`);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  return createIfWelcomed(await go(`/auth/${provider}/callback?code=abc&state=${state}`, { headers: { Cookie: cookieOf(start, "eelsdb_oauth")! } }));
}

afterEach(() => vi.unstubAllGlobals());

describe("sign-in page", () => {
  it("puts ORCID first as the one primary, the other services and passkeys next, and email and password after the or rule", async () => {
    const html = await (await go("/login/")).text();
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const order = ['data-method="orcid"', "EELSdb credits contributors by their ORCID iD", 'data-method="google"', 'data-method="github"', 'data-method="passkey"', 'class="auth-or"', 'id="email"', 'data-method="email_link"', 'data-method="password"', 'id="login"'];
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1]), `${order[i - 1]} before ${order[i]}`).toBeLessThan(at(order[i]));
    expect(html).toContain('<a class="button" data-method="orcid"');
    // One primary in the panel; the password form's own submit stays folded away.
    const panel = html.slice(at('class="auth-panel"'), at('class="auth-password"'));
    expect(panel.match(/class="button"/g)).toHaveLength(1);
    for (const m of ["google", "github", "passkey", "email_link"]) expect(html).toMatch(new RegExp(`class="button secondary"[^>]*data-method="${m}"`));
    // The last-used mark never changes fills, so it cannot make a second primary.
    expect(html).not.toContain('classList.remove("secondary")');
    expect(html).not.toContain('classList.add("secondary")');
  });

  it("keeps passkey autofill on the email field and marks every method for the last-used script", async () => {
    const html = await (await go("/login/")).text();
    expect(html).toMatch(/id="email"[^>]*autocomplete="username webauthn"/);
    for (const m of ["email_link", "password", "passkey", "orcid", "google", "github"]) expect(html).toContain(`data-method="${m}"`);
    expect(html).toContain('localStorage.getItem("signin-method")');
    expect(html).toContain("Forgot your password?");
    expect(html).toContain('fill="#A6CE39"');
    expect(html).toContain('fill="#4285F4"');
    expect(html).not.toContain("not set up on this server");
  });

  it("shows no provider buttons when none is configured", async () => {
    const res = await account.request("/login/", {}, { ...env, ORCID_CLIENT_ID: "", GOOGLE_CLIENT_ID: "", GITHUB_CLIENT_ID: "" });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("Continue with");
    expect(html).toContain("not set up on this server");
    expect(html).toContain('data-method="email_link"');
  });

  it("opens the password form after a wrong password and alerts the error", async () => {
    const html = await (await go("/login/?error=password")).text();
    expect(html).toMatch(/<details class="auth-password" open/);
    expect(html).toContain('role="alert"');
    expect(html).toContain('class="button secondary" type="submit" data-method="email_link"');
  });

  it("replaces the form with a check-your-email page after a link is asked for", async () => {
    const html = await (await go("/login/?notice=sent")).text();
    expect(html).toContain("Check your email");
    expect(html).not.toContain('id="email"');
  });
});

describe("last method hand-off", () => {
  it("is a short-lived cookie that scripts can read, for an email link", async () => {
    const res = await linkSignIn(fresh());
    expect(handedOff(res)).toBe("email_link");
    const raw = setCookie(res, "eelsdb_last_method")!;
    expect(raw).not.toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Max-Age=300/);
    expect(raw).not.toContain("@");
  });

  it("is set for a password", async () => {
    const email = fresh();
    const id = (await env.DB.prepare("INSERT INTO users (display_name, password_hash) VALUES ('Pw', ?) RETURNING id").bind(await pbkdf2Hash("a long password")).first<number>("id"))!;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(id, email).run();
    expect(handedOff(await post("/login/password/", { login: email, password: "a long password" }))).toBe("password");
    expect(handedOff(await post("/login/password/", { login: email, password: "wrong" }))).toBeUndefined();
  });

  it("is set for ORCID, Google and GitHub", async () => {
    expect(handedOff(await oauthSignIn("orcid", { orcid: "0000-0002-0000-0001", name: "Or Cid" }))).toBe("orcid");
    expect(handedOff(await oauthSignIn("google", { sub: "page-g", name: "Gee", email: fresh(), email_verified: true }))).toBe("google");
    expect(handedOff(await oauthSignIn("github", { id: 99301, login: "pagegh" }))).toBe("github");
  });

  it("is set for a passkey", async () => {
    const cookie = await sessionFor({ id: 9930101, display_name: "Passkey Page" });
    const auth = new SoftwareAuthenticator();
    const reg = await (await json("/account/settings/passkeys/options/", {}, cookie)).json<any>();
    await json("/account/settings/passkeys/", { token: reg.token, name: "Laptop", response: await auth.register(reg.options) }, cookie);
    const { options, token } = await (await json("/login/passkey/options/")).json<any>();
    expect(handedOff(await json("/login/passkey/", { token, response: await auth.assert(options) }))).toBe("passkey");
  });

  it("waits for the second step, which hands on the first step's method", async () => {
    const email = fresh();
    const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    const id = (await env.DB.prepare("INSERT INTO users (display_name) VALUES ('Two') RETURNING id").first<number>("id"))!;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(id, email).run();
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, ?, datetime('now'))").bind(id, secret).run();
    const first = await linkSignIn(email);
    expect(first.headers.get("location")).toBe("/login/second-step/");
    expect(setCookie(first, "eelsdb_last_method")).toMatch(/Max-Age=600/);
    const cookies = `${cookieOf(first, "eelsdb_second_step")}; ${cookieOf(first, "eelsdb_last_method")}`;
    // The second-step page has no session, so it must not copy the method yet.
    expect(await (await go("/login/second-step/", { headers: { Cookie: cookies } })).text()).not.toContain("eelsdb_last_method");
    const done = await post("/login/second-step/", { code: await totpCode(secret, stepAt(Date.now())) }, cookies);
    expect(cookieOf(done, "eelsdb_session")).toBeTruthy();
    expect(handedOff(done)).toBe("email_link");
  });

  it("is cleared when the second step is given up", async () => {
    const email = fresh();
    const id = (await env.DB.prepare("INSERT INTO users (display_name) VALUES ('Two') RETURNING id").first<number>("id"))!;
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(id, email).run();
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, 'JBSWY3DPEHPK3PXP', datetime('now'))").bind(id).run();
    const first = await linkSignIn(email);
    const cookies = `${cookieOf(first, "eelsdb_second_step")}; ${cookieOf(first, "eelsdb_last_method")}`;
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) last = await post("/login/second-step/", { code: "000000" }, cookies);
    expect(last!.headers.get("location")).toBe("/login/?error=second-step");
    expect(setCookie(last!, "eelsdb_last_method")).toMatch(/Max-Age=0/);
  });

  it("is copied into localStorage by signed-in pages only", async () => {
    const cookie = await sessionFor({ id: 9930102, display_name: "Copy" });
    expect(await (await go("/account/", { headers: { Cookie: cookie } })).text()).toContain('localStorage.setItem("signin-method"');
    expect(await (await go("/login/")).text()).not.toContain('localStorage.setItem("signin-method"');
  });
});
