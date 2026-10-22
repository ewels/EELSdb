import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/auth";
import { sent } from "../src/email";
import { SoftwareAuthenticator } from "./helpers/authenticator";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const go = (path: string, init: RequestInit = {}) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init });
const form = (path: string, body: Record<string, string>, cookie = "") =>
  go(path, {
    method: "POST",
    headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(body).toString(),
  });
const json = (path: string, body: unknown = {}, cookie = "") =>
  go(path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);

let nextId = 9103000;
const unique = () => crypto.randomUUID().slice(0, 8);

async function staleSession(userId: number) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'))")
    .bind(await sha256(token), userId).run();
  return `eelsdb_session=${token}`;
}

/** Registers a passkey for the signed-in user through the real routes. */
async function register(cookie: string, name = "Laptop", auth = new SoftwareAuthenticator()) {
  const { options, token } = await (await json("/account/settings/passkeys/options/", {}, cookie)).json<any>();
  const res = await json("/account/settings/passkeys/", { token, name, response: await auth.register(options) }, cookie);
  return { auth, res, options, token };
}

async function mkUser(opts: { role?: string } = {}) {
  const id = nextId++;
  const cookie = await sessionFor({ id, display_name: "Passkey User", role: opts.role }, { totp: false });
  const email = `pk-${unique()}@example.invalid`;
  await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(id, email).run();
  return { id, cookie, email };
}

async function emailLinkSignIn(email: string) {
  await form("/login/email/", { email });
  const token = sent[sent.length - 1].text.match(/\/login\/email\/([^/\s]+)\//)![1];
  return form(`/login/email/${token}/`, {});
}

const signInOptions = async () => (await json("/login/passkey/options/")).json<any>();
const passkeyCount = (id: number) => env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(id).first<number>("n");
const withChallenge = (res: Response) => `eelsdb_second_step=${cookieOf(res, "eelsdb_second_step")!.split("=")[1]}`;

describe("registration", () => {
  it("adds a passkey from a real attestation and lists it in settings", async () => {
    const u = await mkUser();
    const { auth, res } = await register(u.cookie, "Work laptop");
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT name, counter, transports FROM passkeys WHERE credential_id = ?").bind(auth.id).first<any>();
    expect(row).toMatchObject({ name: "Work laptop", counter: 0 });
    const page = await (await go("/account/settings/", { headers: { Cookie: u.cookie } })).text();
    expect(page).toContain("Work laptop");
    expect(page).toContain("never used");
  });

  it("needs a signed-in user and a sign-in in the last 15 minutes", async () => {
    expect((await json("/account/settings/passkeys/options/")).status).toBe(302);
    const u = await mkUser();
    const stale = await staleSession(u.id);
    expect((await json("/account/settings/passkeys/options/", {}, stale)).status).toBe(403);
    // A challenge made while fresh does not let a stale session finish.
    const { options, token } = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    const auth = new SoftwareAuthenticator();
    expect((await json("/account/settings/passkeys/", { token, name: "x", response: await auth.register(options) }, stale)).status).toBe(403);
    expect(await passkeyCount(u.id)).toBe(0);
  });

  it("uses the request's host as the relying party and asks for a resident key with user verification", async () => {
    const u = await mkUser();
    const { options } = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    expect(options.rp).toEqual({ id: "eelsdb.eu", name: "EELS Data Base" });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
  });

  it("rejects an expired challenge, a replay, a wrong origin and a challenge made for another user", async () => {
    const u = await mkUser();
    const { options, token } = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    const auth = new SoftwareAuthenticator();
    const response = await auth.register(options);
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?").bind(await sha256(token)).run();
    expect((await json("/account/settings/passkeys/", { token, name: "x", response }, u.cookie)).status).toBe(400);

    const ok = await register(u.cookie);
    expect(ok.res.status).toBe(200);
    expect((await json("/account/settings/passkeys/", { token: ok.token, name: "x", response: await ok.auth.register(ok.options) }, u.cookie)).status).toBe(400);

    const again = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    const wrongOrigin = await new SoftwareAuthenticator().register(again.options, { origin: "https://evil.example" });
    expect((await json("/account/settings/passkeys/", { token: again.token, name: "x", response: wrongOrigin }, u.cookie)).status).toBe(400);

    const other = await mkUser();
    const mine = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    expect((await json("/account/settings/passkeys/", { token: mine.token, name: "x", response: await new SoftwareAuthenticator().register(mine.options) }, other.cookie)).status).toBe(400);
    expect(await passkeyCount(other.id)).toBe(0);
    expect(await passkeyCount(u.id)).toBe(1);
  });

  it("rejects a passkey made without user verification", async () => {
    const u = await mkUser();
    const { options, token } = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    const auth = new SoftwareAuthenticator("eelsdb.eu", "https://eelsdb.eu", false);
    expect((await json("/account/settings/passkeys/", { token, name: "x", response: await auth.register(options) }, u.cookie)).status).toBe(400);
  });
});

describe("signing in with a passkey", () => {
  it("signs in from a real assertion, updates the counter and last use, and needs no second step", async () => {
    const u = await mkUser({ role: "moderator" });
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, 'JBSWY3DPEHPK3PXP', datetime('now'))").bind(u.id).run();
    const { auth } = await register(u.cookie);
    const { options, token } = await signInOptions();
    expect(options.allowCredentials ?? []).toEqual([]);
    const res = await json("/login/passkey/", { token, response: await auth.assert(options, { counter: 5 }), next: "/submit-data/" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/submit-data/");
    expect(cookieOf(res, "eelsdb_session")).toBeTruthy();
    expect(cookieOf(res, "eelsdb_second_step")).toBeUndefined();
    const row = await env.DB.prepare("SELECT counter, last_used_at FROM passkeys WHERE credential_id = ?").bind(auth.id).first<any>();
    expect(row.counter).toBe(5);
    expect(row.last_used_at).toBeTruthy();
    const me = await go("/account/", { headers: { Cookie: cookieOf(res, "eelsdb_session")! } });
    expect(me.status).toBe(200);
  });

  it("limits next to same-site paths", async () => {
    const u = await mkUser();
    const { auth } = await register(u.cookie);
    const { options, token } = await signInOptions();
    const res = await json("/login/passkey/", { token, response: await auth.assert(options), next: "https://evil.example/" });
    expect(res.headers.get("Location")).toBe("/account/");
  });

  it("refuses an expired challenge, a replay, a counter that did not go up and an unknown passkey", async () => {
    const u = await mkUser();
    const { auth } = await register(u.cookie);

    const a = await signInOptions();
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?").bind(await sha256(a.token)).run();
    expect((await json("/login/passkey/", { token: a.token, response: await auth.assert(a.options) })).status).toBe(400);

    const b = await signInOptions();
    const good = await auth.assert(b.options, { counter: 10 });
    expect((await json("/login/passkey/", { token: b.token, response: good })).status).toBe(302);
    expect((await json("/login/passkey/", { token: b.token, response: good })).status).toBe(400);

    const c = await signInOptions();
    expect((await json("/login/passkey/", { token: c.token, response: await auth.assert(c.options, { counter: 10 }) })).status).toBe(400);

    const d = await signInOptions();
    const stranger = new SoftwareAuthenticator();
    await stranger.register({ challenge: "x" });
    expect((await json("/login/passkey/", { token: d.token, response: await stranger.assert(d.options) })).status).toBe(400);
  });

  it("does not accept a second-step challenge, or a registration challenge, as a sign-in", async () => {
    const u = await mkUser();
    const { auth } = await register(u.cookie);
    const reg = await (await json("/account/settings/passkeys/options/", {}, u.cookie)).json<any>();
    expect((await json("/login/passkey/", { token: reg.token, response: await auth.assert(reg.options) })).status).toBe(400);
  });
});

describe("second step", () => {
  it("offers only a passkey to an account with passkeys and no authenticator app, and a passkey finishes the sign-in", async () => {
    const u = await mkUser();
    const { auth } = await register(u.cookie);
    const first = await emailLinkSignIn(u.email);
    expect(first.headers.get("Location")).toBe("/login/second-step/");
    expect(cookieOf(first, "eelsdb_session")).toBeUndefined();
    const challenge = withChallenge(first);
    const page = await (await go("/login/second-step/", { headers: { Cookie: challenge } })).text();
    expect(page).toContain("Use a passkey");
    expect(page).not.toContain("authenticator app");

    const { options, token } = await (await json("/login/second-step/passkey/options/", {}, challenge)).json<any>();
    expect(options.allowCredentials.map((c: any) => c.id)).toEqual([auth.id]);
    const res = await json("/login/second-step/passkey/", { token, response: await auth.assert(options) }, challenge);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/account/");
    expect(cookieOf(res, "eelsdb_session")).toBeTruthy();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM login_challenges WHERE user_id = ?").bind(u.id).first<number>("n")).toBe(0);
  });

  it("shows both a code form and a passkey button when the account has both", async () => {
    const u = await mkUser();
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, 'JBSWY3DPEHPK3PXP', datetime('now'))").bind(u.id).run();
    await register(u.cookie);
    const first = await emailLinkSignIn(u.email);
    const page = await (await go("/login/second-step/", { headers: { Cookie: withChallenge(first) } })).text();
    expect(page).toContain("authenticator app");
    expect(page).toContain("Use a passkey");
  });

  it("does not accept another account's passkey, and a challenge allows five tries", async () => {
    const u = await mkUser();
    await register(u.cookie);
    const other = await mkUser();
    const theirs = (await register(other.cookie)).auth;
    const first = await emailLinkSignIn(u.email);
    const challenge = withChallenge(first);
    for (let i = 0; i < 4; i++) {
      const { options, token } = await (await json("/login/second-step/passkey/options/", {}, challenge)).json<any>();
      const res = await json("/login/second-step/passkey/", { token, response: await theirs.assert(options) }, challenge);
      expect(res.status).toBe(422);
    }
    const last = await (await json("/login/second-step/passkey/options/", {}, challenge)).json<any>();
    const ended = await json("/login/second-step/passkey/", { token: last.token, response: await theirs.assert(last.options) }, challenge);
    expect(ended.headers.get("Location")).toBe("/login/?error=second-step");
    const gone = await json("/login/second-step/passkey/options/", {}, challenge);
    expect(gone.status).toBe(400);
  });

  it("does not accept a first-step sign-in challenge as a second step", async () => {
    const u = await mkUser();
    const { auth } = await register(u.cookie);
    const challenge = withChallenge(await emailLinkSignIn(u.email));
    const { options, token } = await signInOptions();
    const res = await json("/login/second-step/passkey/", { token, response: await auth.assert(options) }, challenge);
    expect(res.status).toBe(422);
  });

  it("needs a live challenge cookie", async () => {
    expect((await json("/login/second-step/passkey/options/")).status).toBe(400);
    expect((await json("/login/second-step/passkey/", {})).headers.get("Location")).toBe("/login/?error=second-step");
  });
});

describe("removing a passkey", () => {
  it("removes it with a fresh sign-in, not with a stale one, and not another account's", async () => {
    const u = await mkUser();
    const { auth } = await register(u.cookie);
    const other = await mkUser();

    expect((await form("/account/settings/passkeys/remove/", { id: auth.id }, other.cookie)).status).toBe(302);
    expect(await passkeyCount(u.id)).toBe(1);

    const stale = await staleSession(u.id);
    const refused = await form("/account/settings/passkeys/remove/", { id: auth.id }, stale);
    expect(refused.headers.get("Location")).toContain("notice=passkey-stale");
    expect(await passkeyCount(u.id)).toBe(1);

    const done = await form("/account/settings/passkeys/remove/", { id: auth.id }, u.cookie);
    expect(done.headers.get("Location")).toContain("notice=passkey-removed");
    expect(await passkeyCount(u.id)).toBe(0);
    const { options, token } = await signInOptions();
    expect((await json("/login/passkey/", { token, response: await auth.assert(options) })).status).toBe(400);
  });
});

describe("the moderator rule", () => {
  it("counts a passkey as two-step sign-in, and ends the role again when the last passkey goes", async () => {
    const id = nextId++;
    const cookie = await sessionFor({ id, display_name: "Mod Passkey", role: "moderator" }, { totp: false });
    expect((await go("/admin/", { headers: { Cookie: cookie } })).status).toBe(302);
    const { auth } = await register(cookie);
    expect((await go("/admin/", { headers: { Cookie: cookie } })).status).toBe(200);
    await form("/account/settings/passkeys/remove/", { id: auth.id }, cookie);
    const res = await go("/admin/", { headers: { Cookie: cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("two-step-required");
  });

  it("keeps the role when an authenticator app is turned off but a passkey remains", async () => {
    const id = nextId++;
    const cookie = await sessionFor({ id, display_name: "Mod Both", role: "moderator" });
    await register(cookie);
    await env.DB.prepare("DELETE FROM user_totp WHERE user_id = ?").bind(id).run();
    expect((await go("/admin/", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("ends the role when the last passkey is removed and there is no authenticator app", async () => {
    const id = nextId++;
    const cookie = await sessionFor({ id, display_name: "Mod Gone", role: "admin" }, { totp: false });
    const { auth } = await register(cookie);
    await env.DB.prepare("DELETE FROM passkeys WHERE credential_id = ?").bind(auth.id).run();
    expect((await go("/admin/", { headers: { Cookie: cookie } })).status).toBe(302);
  });

  it("asks a moderator with only a passkey for it after an email link", async () => {
    const u = await mkUser({ role: "moderator" });
    await register(u.cookie);
    expect((await emailLinkSignIn(u.email)).headers.get("Location")).toBe("/login/second-step/");
  });
});

describe("pages", () => {
  it("login page has the passkey button and its script", async () => {
    const page = await (await go("/login/")).text();
    expect(page).toContain("Sign in with a passkey");
    expect(page).toContain("/passkeys.js");
  });

  it("lets a passkey-only account ask for its passkey after ORCID, Google and GitHub, after a fresh sign-in", async () => {
    const { id, cookie } = await mkUser();
    await register(cookie);
    expect(await (await go("/account/settings/", { headers: { Cookie: cookie } })).text()).toContain("Also ask for a passkey after ORCID");
    const stale = await staleSession(id);
    expect((await form("/account/settings/two-step/all-methods/", { all_methods: "1" }, stale)).headers.get("location")).toContain("passkey-stale");
    expect(await env.DB.prepare("SELECT mfa_all_methods FROM users WHERE id = ?").bind(id).first("mfa_all_methods")).toBe(0);
    expect((await form("/account/settings/two-step/all-methods/", { all_methods: "1" }, cookie)).headers.get("location")).toContain("two-step-all-on");
    expect(await env.DB.prepare("SELECT mfa_all_methods FROM users WHERE id = ?").bind(id).first("mfa_all_methods")).toBe(1);
  });
});
