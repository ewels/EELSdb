import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/auth";
import { sent } from "../src/email";
import { pbkdf2Hash } from "../src/legacy-password";
import { base32Encode, stepAt, totpCode } from "../src/totp";
import { SoftwareAuthenticator } from "./helpers/authenticator";
import { sessionFor } from "./helpers/session";

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
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
const count = (sql: string, ...args: unknown[]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).bind(...args).first<number>("n").then((n) => n ?? 0);

let n = 0;
const uniq = () => `${++n}${crypto.randomUUID().slice(0, 6)}`;
const orcidId = () => `0000-0003-${String(9000 + ++n).padStart(4, "0")}-${String(1000 + n)}`;

type Orcid = { emails?: unknown; status?: number; throws?: boolean };
let emailCalls: { url: string; auth: string | null; accept: string | null }[] = [];

/** Runs a provider sign-in with mocked endpoints; returns the callback response. */
async function providerSignIn(provider: "github" | "google" | "orcid", profile: Record<string, any>, orcid: Orcid = {}, extraCookie = "") {
  emailCalls = [];
  vi.stubGlobal("fetch", async (input: string | Request, init?: RequestInit) => {
    const u = String(input);
    if (u.includes("pub.") && u.endsWith("/email")) {
      emailCalls.push({ url: u, auth: new Headers(init?.headers).get("Authorization"), accept: new Headers(init?.headers).get("Accept") });
      if (orcid.throws) throw new Error("network");
      return Response.json({ email: orcid.emails ?? [] }, { status: orcid.status ?? 200 });
    }
    if (u.includes("token")) return Response.json({ access_token: "tok", orcid: profile.orcid, name: profile.name });
    if (u.endsWith("/user/emails")) return Response.json(profile.emails ?? []);
    return Response.json(profile);
  });
  const start = await go(`/auth/${provider}/start?next=/spectra/`);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const cookie = [cookieOf(start, "eelsdb_oauth")!, extraCookie].filter(Boolean).join("; ");
  return go(`/auth/${provider}/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } });
}
const orcidProfile = () => ({ orcid: orcidId(), name: "Ori Cid" });

async function user(opts: { password?: string; totp?: string; role?: string } = {}) {
  const email = `w-${uniq()}@example.invalid`;
  const id = (await env.DB.prepare("INSERT INTO users (display_name, role, password_hash) VALUES ('Existing Person', ?, ?) RETURNING id")
    .bind(opts.role ?? "user", opts.password ? await pbkdf2Hash(opts.password) : null).first<number>("id"))!;
  await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)").bind(id, email).run();
  if (opts.totp) await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, ?, datetime('now'))").bind(id, opts.totp).run();
  return { id, email };
}
const identityOwner = (provider: string, subject: string) =>
  env.DB.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").bind(provider, subject).first<number>("user_id");

async function emailLink(email: string, cookie: string) {
  await post("/login/email/", { email });
  const token = sent[sent.length - 1].text.match(/\/login\/email\/([^/\s]+)\//)![1];
  return post(`/login/email/${token}/`, {}, cookie);
}

/** The provider sign-in ends on the welcome page; returns the cookie that keeps the pending identity. */
async function welcomed(provider: "github" | "google" | "orcid", profile: Record<string, any>, orcid?: Orcid) {
  const res = await providerSignIn(provider, profile, orcid);
  expect(res.headers.get("location")).toBe("/login/welcome/");
  return cookieOf(res, "eelsdb_pending")!;
}

afterEach(() => vi.unstubAllGlobals());

describe("the welcome page", () => {
  it("replaces creating an account when a provider matches none, and makes no user or session", async () => {
    const [users, sessions] = [await count("SELECT id FROM users"), await count("SELECT id FROM sessions")];
    const profile = orcidProfile();
    const res = await providerSignIn("orcid", profile);
    expect(res.headers.get("location")).toBe("/login/welcome/");
    expect(cookieOf(res, "eelsdb_session")).toBeUndefined();
    expect(await count("SELECT id FROM users")).toBe(users);
    expect(await count("SELECT id FROM sessions")).toBe(sessions);
    expect(await identityOwner("orcid", profile.orcid)).toBeNull();
    const pending = cookieOf(res, "eelsdb_pending")!;
    const page = await (await go("/login/welcome/", { headers: { Cookie: pending } })).text();
    expect(page).toContain("Welcome to EELSdb");
    expect(page).toContain("Have you signed in here before");
    expect(page).toContain("Yes, sign in to my account");
    expect(page).toContain("No, create a new account");
    expect(page).toContain("Ori Cid");
  });

  it("sends the page to sign-in when nothing is pending", async () => {
    expect((await go("/login/welcome/")).headers.get("location")).toBe("/login/?error=state");
    expect((await post("/login/welcome/", {})).headers.get("location")).toBe("/login/?error=state");
  });

  it("is not shown for a provider that matches a linked identity", async () => {
    const u = await user();
    const profile = orcidProfile();
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', ?)").bind(u.id, profile.orcid).run();
    const res = await providerSignIn("orcid", profile);
    expect(res.headers.get("location")).toBe("/spectra/");
    expect(cookieOf(res, "eelsdb_session")).toBeDefined();
    expect(cookieOf(res, "eelsdb_pending")).toBeUndefined();
  });

  it("does not appear in the link flow of a signed-in user", async () => {
    const id = 9950001;
    const cookie = await sessionFor({ id, display_name: "Signed In" });
    vi.stubGlobal("fetch", async (input: string) => (String(input).includes("token") ? Response.json({ access_token: "t", orcid: orcidId(), name: "N" }) : Response.json({})));
    const start = await go("/auth/orcid/link?next=/spectra/", { headers: { Cookie: cookie } });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await go(`/auth/orcid/callback?code=a&state=${state}`, { headers: { Cookie: `${cookie}; ${cookieOf(start, "eelsdb_oauth")!}` } });
    expect(res.headers.get("location")).toBe("/spectra/");
    expect(cookieOf(res, "eelsdb_pending")).toBeUndefined();
  });

  it("makes the account, with the provider's method and next, when the answer is No", async () => {
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    const res = await post("/login/welcome/", {}, pending);
    expect(res.headers.get("location")).toBe("/account/welcome/email/?next=%2Fspectra%2F");
    expect(cookieOf(res, "eelsdb_session")).toBeDefined();
    expect(cookieOf(res, "eelsdb_last_method")).toBe("eelsdb_last_method=orcid");
    const id = (await identityOwner("orcid", profile.orcid))!;
    expect(await env.DB.prepare("SELECT display_name, orcid FROM users WHERE id = ?").bind(id).first()).toEqual({ display_name: "Ori Cid", orcid: profile.orcid });
    expect(await count("SELECT 1 FROM pending_identities WHERE provider = 'orcid' AND subject = ?", profile.orcid)).toBe(0);
    expect((await post("/login/welcome/", {}, pending)).headers.get("location")).toBe("/login/?error=state");
  });

  it("signs a new account in without a second step after No", async () => {
    const pending = await welcomed("github", { id: 880000 + ++n, login: "gh", name: "Gh" });
    expect(cookieOf(await post("/login/welcome/", {}, pending), "eelsdb_second_step")).toBeUndefined();
  });

  it("shows the Yes notice on the sign-in page only while an identity is pending", async () => {
    const pending = await welcomed("orcid", orcidProfile());
    const page = await (await go("/login/?notice=link", { headers: { Cookie: pending } })).text();
    expect(page).toContain("we will link your ORCID account to that account");
    expect(await (await go("/login/?notice=link")).text()).not.toContain("we will link your");
  });

  it("forgets an identity after 15 minutes: nothing is linked and no account is made", async () => {
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    await env.DB.prepare("UPDATE pending_identities SET expires_at = datetime('now', '-1 minute') WHERE subject = ?").bind(profile.orcid).run();
    expect((await go("/login/welcome/", { headers: { Cookie: pending } })).headers.get("location")).toBe("/login/?error=state");
    expect((await post("/login/welcome/", {}, pending)).headers.get("location")).toBe("/login/?error=state");
    const u = await user();
    const res = await emailLink(u.email, pending);
    expect(res.headers.get("location")).toBe("/account/");
    expect(await identityOwner("orcid", profile.orcid)).toBeNull();
  });
});

describe("Yes: the next sign-in links the pending identity", () => {
  it("after an email link", async () => {
    const u = await user();
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    const res = await emailLink(u.email, pending);
    expect(res.headers.get("location")).toBe("/account/settings/sign-in/?notice=linked-orcid#h-signin");
    expect(cookieOf(res, "eelsdb_session")).toBeDefined();
    expect(await identityOwner("orcid", profile.orcid)).toBe(u.id);
    expect(await env.DB.prepare("SELECT orcid FROM users WHERE id = ?").bind(u.id).first("orcid")).toBe(profile.orcid);
    expect(await count("SELECT 1 FROM pending_identities WHERE subject = ?", profile.orcid)).toBe(0);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("eelsdb_pending=;"))).toBe(true);
    const page = await (await go("/account/settings/sign-in/?notice=linked-orcid", { headers: { Cookie: cookieOf(res, "eelsdb_session")! } })).text();
    expect(page).toContain("ORCID linked");
  });

  it("after a password", async () => {
    const u = await user({ password: "correct horse battery" });
    const profile = { id: 770000 + ++n, login: "ghp", name: "G" };
    const pending = await welcomed("github", profile);
    const res = await post("/login/password/", { login: u.email, password: "correct horse battery" }, pending);
    expect(res.headers.get("location")).toBe("/account/settings/sign-in/?notice=linked-github#h-signin");
    expect(await identityOwner("github", String(profile.id))).toBe(u.id);
  });

  it("after a passkey", async () => {
    const id = 9950100 + ++n;
    const cookie = await sessionFor({ id, display_name: "Pk" }, { totp: false });
    const auth = new SoftwareAuthenticator();
    const reg = await (await json("/account/settings/passkeys/options/", {}, cookie)).json<any>();
    expect((await json("/account/settings/passkeys/", { token: reg.token, name: "K", response: await auth.register(reg.options) }, cookie)).status).toBe(200);
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    const o = await (await json("/login/passkey/options/")).json<any>();
    const res = await json("/login/passkey/", { token: o.token, response: await auth.assert(o.options, { counter: 3 }) }, pending);
    expect(res.status).toBe(302);
    expect(await identityOwner("orcid", profile.orcid)).toBe(id);
  });

  it("after a different provider that matches an account", async () => {
    const u = await user();
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'github', ?)").bind(u.id, `gh-${u.id}`).run();
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    const res = await providerSignIn("github", { id: `gh-${u.id}`, login: "x", name: "X" }, {}, pending);
    expect(res.headers.get("location")).toBe("/account/settings/sign-in/?notice=linked-orcid#h-signin");
    expect(await identityOwner("orcid", profile.orcid)).toBe(u.id);
  });

  it("only after the second step when the account has one", async () => {
    const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
    const u = await user({ totp: secret });
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    const first = await emailLink(u.email, pending);
    expect(first.headers.get("location")).toBe("/login/second-step/");
    expect(cookieOf(first, "eelsdb_session")).toBeUndefined();
    expect(await identityOwner("orcid", profile.orcid)).toBeNull();
    const challenge = `${cookieOf(first, "eelsdb_second_step")!}; ${pending}`;
    const wrong = await post("/login/second-step/", { code: "000000" }, challenge);
    expect(wrong.status).toBe(422);
    expect(await identityOwner("orcid", profile.orcid)).toBeNull();
    const done = await post("/login/second-step/", { code: await totpCode(secret, stepAt(Date.now())) }, challenge);
    expect(done.headers.get("location")).toBe("/account/settings/sign-in/?notice=linked-orcid#h-signin");
    expect(cookieOf(done, "eelsdb_session")).toBeDefined();
    expect(await identityOwner("orcid", profile.orcid)).toBe(u.id);
  });

  it("refuses, with the settings notice, when the identity is linked elsewhere by then", async () => {
    const [a, b] = [await user(), await user()];
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', ?)").bind(b.id, profile.orcid).run();
    const res = await emailLink(a.email, pending);
    expect(res.headers.get("location")).toBe("/account/settings/sign-in/?notice=link-taken#h-signin");
    expect(cookieOf(res, "eelsdb_session")).toBeDefined();
    expect(await identityOwner("orcid", profile.orcid)).toBe(b.id);
    expect(await count("SELECT 1 FROM pending_identities WHERE subject = ?", profile.orcid)).toBe(0);
  });

  it("refuses when the account already has a different ORCID", async () => {
    const u = await user();
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', '0000-0000-0000-0001')").bind(u.id).run();
    const profile = orcidProfile();
    const res = await emailLink(u.email, await welcomed("orcid", profile));
    expect(res.headers.get("location")).toBe("/account/settings/sign-in/?notice=link-has#h-signin");
    expect(await identityOwner("orcid", profile.orcid)).toBeNull();
  });
});

describe("ORCID public email", () => {
  const record = (email: string, over: Record<string, unknown> = {}) => ({ email, verified: true, primary: true, visibility: "public", ...over });

  it("calls the public API with the token and JSON, and matches an account by a verified address", async () => {
    const u = await user();
    const profile = orcidProfile();
    const res = await providerSignIn("orcid", profile, { emails: [record(u.email.toUpperCase())] });
    expect(res.headers.get("location")).toBe("/spectra/");
    expect(emailCalls).toEqual([{ url: `https://pub.orcid.org/v3.0/${profile.orcid}/email`, auth: "Bearer tok", accept: "application/json" }]);
    expect(await identityOwner("orcid", profile.orcid)).toBe(u.id);
    expect(await env.DB.prepare("SELECT email, email_verified FROM identities WHERE provider = 'orcid' AND subject = ?").bind(profile.orcid).first())
      .toEqual({ email: u.email, email_verified: 1 });
  });

  it("matches an unclaimed old account by its legacy address", async () => {
    const legacy = `old-${uniq()}@example.invalid`;
    const id = (await env.DB.prepare("INSERT INTO users (display_name, legacy_email) VALUES ('Old One', ?) RETURNING id").bind(legacy).first<number>("id"))!;
    const profile = orcidProfile();
    expect((await providerSignIn("orcid", profile, { emails: [record(legacy)] })).headers.get("location")).toBe("/spectra/");
    expect(await identityOwner("orcid", profile.orcid)).toBe(id);
  });

  it("takes the first verified address and ignores unverified ones", async () => {
    const u = await user();
    const profile = orcidProfile();
    const res = await providerSignIn("orcid", profile, { emails: [record(u.email, { verified: false, primary: false }), record(`other-${uniq()}@example.invalid`, { primary: false })] });
    expect(res.headers.get("location")).toBe("/login/welcome/");
    expect(await identityOwner("orcid", profile.orcid)).toBeNull();
    const pending = await env.DB.prepare("SELECT email FROM pending_identities WHERE subject = ?").bind(profile.orcid).first<{ email: string }>();
    expect(pending!.email).toMatch(/^other-/);
  });

  it("goes on without an address when the call is empty, fails, errors or times out", async () => {
    for (const orcid of [{ emails: [] }, { status: 500 }, { status: 404 }, { throws: true }] as Orcid[]) {
      const res = await providerSignIn("orcid", orcidProfile(), orcid);
      expect(res.headers.get("location"), JSON.stringify(orcid)).toBe("/login/welcome/");
    }
  });

  it("goes on when the response is not what ORCID documents", async () => {
    expect((await providerSignIn("orcid", orcidProfile(), { emails: "nope" })).headers.get("location")).toBe("/login/welcome/");
  });
});

describe("the pending identity", () => {
  it("is stored by hash, so the table does not reveal the cookie", async () => {
    const profile = orcidProfile();
    const pending = await welcomed("orcid", profile);
    const token = pending.split("=")[1];
    expect(await count("SELECT 1 FROM pending_identities WHERE token_hash = ?", await sha256(token))).toBe(1);
    expect(await count("SELECT 1 FROM pending_identities WHERE token_hash = ?", token)).toBe(0);
  });
});

describe("the email step after a provider sign-up", () => {
  const STEP = "/account/welcome/email/?next=%2Fspectra%2F";
  const record = (email: string) => ({ email, verified: true, primary: true });

  async function signedUp(provider: "github" | "orcid" | "google", profile: Record<string, any>, orcid?: Orcid) {
    const res = await post("/login/welcome/", {}, await welcomed(provider, profile, orcid));
    return { res, cookie: cookieOf(res, "eelsdb_session")!, id: (await identityOwner(provider, profile.orcid ?? String(profile.id)))! };
  }

  it("follows the account being made, for ORCID and the other services, with a form and no way to skip", async () => {
    for (const [provider, profile] of [["orcid", orcidProfile()], ["github", { id: 870000 + ++n, login: "gh", name: "Gh" }]] as const) {
      const { res, cookie } = await signedUp(provider, profile);
      expect(res.headers.get("location")).toBe(STEP);
      const page = await (await go(STEP, { headers: { Cookie: cookie } })).text();
      expect(page).toContain("One more step: add your email address");
      expect(page).toContain("Send confirmation link");
      expect(page).not.toMatch(/skip for now/i);
    }
  });

  it("is not asked when the service shared a confirmed address, nor of an existing account", async () => {
    const mail = `s-${uniq()}@example.invalid`;
    const { res } = await signedUp("orcid", orcidProfile(), { emails: [record(mail)] });
    expect(res.headers.get("location")).toBe("/spectra/");
    const u = await user();
    const profile = orcidProfile();
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', ?)").bind(u.id, profile.orcid).run();
    expect((await providerSignIn("orcid", profile)).headers.get("location")).toBe("/spectra/");
  });

  it("sends the link, makes the address primary and unconfirmed, then offers Continue to next; the page can be left", async () => {
    const { cookie, id } = await signedUp("orcid", orcidProfile());
    const address = `Step-${uniq()}@Example.invalid`;
    const before = sent.length;
    const res = await post("/account/welcome/email/", { email: address, next: "/spectra/" }, cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Check your email");
    expect(page).toContain(address.toLowerCase());
    expect(page).toContain('href="/spectra/"');
    expect(sent.length).toBe(before + 1);
    expect(sent[sent.length - 1].to).toBe(address.toLowerCase());
    expect(await env.DB.prepare("SELECT verified, is_primary FROM user_emails WHERE user_id = ?").bind(id).first()).toEqual({ verified: 0, is_primary: 1 });
    expect((await go("/spectra/", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("refuses a bad address and keeps the form", async () => {
    const { cookie } = await signedUp("orcid", orcidProfile());
    const res = await post("/account/welcome/email/", { email: "nope", next: "/spectra/" }, cookie);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Send confirmation link");
  });

  it("keeps its place before the two-step set-up that new accounts must do", async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('require_2fa_user', '1')").run();
    try {
      const { res, cookie } = await signedUp("orcid", orcidProfile());
      expect(res.headers.get("location")).toBe(STEP);
      expect((await go(STEP, { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await go("/spectra/", { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await go("/account/", { headers: { Cookie: cookie } })).headers.get("location")).toContain("/account/settings/two-step/");
    } finally {
      await env.DB.prepare("DELETE FROM site_settings WHERE key = 'require_2fa_user'").run();
    }
  });
});

describe("the email banner", () => {
  const go2 = (path: string, cookie: string) => go(path, { headers: { Cookie: cookie } });
  const text = async (path: string, cookie: string) => (await go2(path, cookie)).text();

  it("asks for an address when there is none, with a link to the emails page", async () => {
    const cookie = await sessionFor({ id: 9990081, display_name: "No Address" });
    const page = await text("/spectra/", cookie);
    expect(page).toContain("Add an email address so we can send you sign-in links and news about your submissions.");
    expect(page).toContain('href="/account/settings/emails/"');
    expect(page).toContain("Hide for 7 days");
  });

  it("asks to confirm an unconfirmed address, and the resend button returns to the page", async () => {
    const cookie = await sessionFor({ id: 9990082, display_name: "Unconfirmed" });
    const row = (await env.DB.prepare("INSERT INTO user_emails (user_id, email, is_primary) VALUES (9990082, 'unc@example.invalid', 1) RETURNING id").first<number>("id"))!;
    const page = await text("/spectra/", cookie);
    expect(page).toContain("Confirm your email address: we sent a link to unc@example.invalid.");
    expect(page).toContain(`action="/account/settings/emails/${row}/send/"`);
    const before = sent.length;
    const res = await post(`/account/settings/emails/${row}/send/`, { next: "/spectra/?x=1" }, cookie);
    expect(res.headers.get("location")).toBe("/spectra/?x=1");
    expect(sent.length).toBe(before + 1);
    expect((await post(`/account/settings/emails/${row}/send/`, { next: "https://evil.example/" }, cookie)).headers.get("location")).toBe("/account/");

    // The banner's script asks for JSON, so it can say whether a link went out (the daily limit is 5).
    const ask = () => go(`/account/settings/emails/${row}/send/`, {
      method: "POST",
      headers: { Origin: SITE, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ next: "/spectra/" }).toString(),
    }).then((r) => r.json<{ sent: boolean }>());
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push((await ask()).sent);
    expect(answers.at(0)).toBe(true);
    expect(answers.at(-1)).toBe(false);
  });

  it("is not shown with a confirmed address, on sign-in pages, the email step or the emails page; and gives way to nothing but itself", async () => {
    const cookie = await sessionFor({ id: 9990083, display_name: "Hidden Places" });
    for (const path of ["/account/welcome/email/", "/account/settings/emails/", "/login/"]) {
      expect(await text(path, cookie)).not.toContain('class="email-banner"');
    }
    const confirmed = await sessionFor({ id: 9990084, display_name: "Confirmed" }, { email: true });
    expect(await text("/spectra/", confirmed)).not.toContain('class="email-banner"');
  });

  it("takes priority over the ORCID banner", async () => {
    const cookie = await sessionFor({ id: 9990085, display_name: "Both" });
    const page = await text("/spectra/", cookie);
    expect(page).toContain('class="email-banner"');
    expect(page).not.toContain('class="orcid-banner"');
    const confirmed = await sessionFor({ id: 9990086, display_name: "Orcid Only" }, { email: true });
    expect(await text("/spectra/", confirmed)).toContain('class="orcid-banner"');
  });
});
