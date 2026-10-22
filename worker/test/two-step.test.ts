import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/auth";
import { sent } from "../src/email";
import { base32Decode, base32Encode, matchingStep, stepAt, totpCode } from "../src/totp";
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
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);

const SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));
let n = 0;
const unique = () => `${++n}-${crypto.randomUUID().slice(0, 6)}`;
const currentCode = (secret = SECRET, offset = 0) => totpCode(secret, stepAt(Date.now()) + offset);

/** A user with two-step sign-in on (its own secret, so tests do not share a last_step), a password and a verified address. */
async function mkUser(opts: { role?: string; allMethods?: boolean; password?: string; totp?: boolean } = {}) {
  const email = `two-${unique()}@example.invalid`;
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const id = (await env.DB.prepare("INSERT INTO users (display_name, role, mfa_all_methods, password_hash) VALUES ('Two Step', ?, ?, ?) RETURNING id")
    .bind(opts.role ?? "user", opts.allMethods ? 1 : 0, opts.password ? await (await import("../src/legacy-password")).pbkdf2Hash(opts.password) : null).first<number>("id"))!;
  await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1)").bind(id, email).run();
  if (opts.totp !== false) await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, ?, datetime('now'))").bind(id, secret).run();
  return { id, email, secret };
}

async function emailLinkSignIn(email: string) {
  await post("/login/email/", { email });
  const token = sent[sent.length - 1].text.match(/\/login\/email\/([^/\s]+)\//)![1];
  return post(`/login/email/${token}/`, {});
}

const withChallenge = (res: Response) => `eelsdb_second_step=${cookieOf(res, "eelsdb_second_step")!.split("=")[1]}`;
const secondStep = (res: Response, code: string) => post("/login/second-step/", { code }, withChallenge(res));
const sessionCount = (id: number) => env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(id).first<number>("n");

async function staleSession(userId: number) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'))")
    .bind(await sha256(token), userId).run();
  return `eelsdb_session=${token}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vectors", async () => {
    const vectors: [number, string][] = [
      [59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"],
      [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"],
    ];
    for (const [seconds, code] of vectors) expect(await totpCode(SECRET, Math.floor(seconds / 30), 8)).toBe(code);
  });

  it("round-trips base32", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode("jbsw y3dp-ehpk 3pxp")).toEqual(base32Decode("JBSWY3DPEHPK3PXP"));
  });

  it("accepts one step either side, not two, and never a step already used", async () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const at = (s: number) => totpCode(SECRET, s);
    expect(await matchingStep(SECRET, await at(step), 0, now)).toBe(step);
    expect(await matchingStep(SECRET, await at(step - 1), 0, now)).toBe(step - 1);
    expect(await matchingStep(SECRET, await at(step + 1), 0, now)).toBe(step + 1);
    expect(await matchingStep(SECRET, await at(step - 2), 0, now)).toBeNull();
    expect(await matchingStep(SECRET, await at(step + 2), 0, now)).toBeNull();
    expect(await matchingStep(SECRET, await at(step), step, now)).toBeNull();
    expect(await matchingStep(SECRET, "12345", 0, now)).toBeNull();
  });
});

describe("set-up in settings", () => {
  it("is off until a valid code is entered, then shows 10 recovery codes once", async () => {
    const u = await mkUser({ totp: false });
    const cookie = await sessionFor({ id: u.id, display_name: "Two Step" });
    expect(await (await go("/account/settings/", { headers: { Cookie: cookie } })).text()).toContain("Set up two-step sign-in");

    expect((await post("/account/settings/two-step/start/", {}, cookie)).status).toBe(302);
    const row = await env.DB.prepare("SELECT secret, enabled_at FROM user_totp WHERE user_id = ?").bind(u.id).first<{ secret: string; enabled_at: string | null }>();
    expect(row!.enabled_at).toBeNull();
    const page = await (await go("/account/settings/", { headers: { Cookie: cookie } })).text();
    expect(page).toContain("otpauth://totp/");
    expect(page).toContain(`secret=${row!.secret}`);
    expect(page).toContain('id="totp-qr"');

    const bad = await post("/account/settings/two-step/confirm/", { code: "000000" }, cookie);
    expect(bad.headers.get("location")).toContain("two-step-bad-code");
    expect((await env.DB.prepare("SELECT enabled_at FROM user_totp WHERE user_id = ?").bind(u.id).first<any>())!.enabled_at).toBeNull();

    const ok = await post("/account/settings/two-step/confirm/", { code: await currentCode(row!.secret) }, cookie);
    expect(ok.status).toBe(200);
    const html = await ok.text();
    const codes = [...html.matchAll(/<code>([a-z0-9]{5}-[a-z0-9]{5})<\/code>/g)].map((m) => m[1]);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const stored = await env.DB.prepare("SELECT code_hash FROM recovery_codes WHERE user_id = ?").bind(u.id).all<{ code_hash: string }>();
    expect(stored.results).toHaveLength(10);
    expect(stored.results.map((r) => r.code_hash)).toContain(await sha256(codes[0].replace("-", "")));
    expect(html).not.toContain("Set up two-step sign-in");
    expect(await (await go("/account/settings/", { headers: { Cookie: cookie } })).text()).not.toMatch(/<code>[a-z0-9]{5}-[a-z0-9]{5}<\/code>/);
  });

  it("needs a recent sign-in to start", async () => {
    const u = await mkUser({ totp: false });
    const cookie = await staleSession(u.id);
    expect(await (await go("/account/settings/", { headers: { Cookie: cookie } })).text()).not.toContain("Set up two-step sign-in</button>");
    const res = await post("/account/settings/two-step/start/", {}, cookie);
    expect(res.headers.get("location")).toContain("two-step-stale");
    expect(await env.DB.prepare("SELECT 1 FROM user_totp WHERE user_id = ?").bind(u.id).first()).toBeNull();
  });

  it("makes new recovery codes and turns off only with a code", async () => {
    const u = await mkUser();
    const cookie = await sessionFor({ id: u.id, display_name: "Two Step" });
    const off = (code: string) => post("/account/settings/two-step/off/", { code }, cookie);
    expect((await off("123456")).headers.get("location")).toContain("two-step-bad-code");
    expect(await env.DB.prepare("SELECT 1 FROM user_totp WHERE user_id = ?").bind(u.id).first()).not.toBeNull();

    const fresh = await post("/account/settings/two-step/recovery/", { code: await currentCode(u.secret) }, cookie);
    const codes = [...(await fresh.text()).matchAll(/<code>([a-z0-9]{5}-[a-z0-9]{5})<\/code>/g)].map((m) => m[1]);
    expect(codes).toHaveLength(10);

    // The authenticator code was just used, so a recovery code turns it off.
    expect((await off(codes[0])).headers.get("location")).toContain("two-step-off");
    expect(await env.DB.prepare("SELECT 1 FROM user_totp WHERE user_id = ?").bind(u.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?").bind(u.id).first("n")).toBe(0);
  });
});

describe("second step", () => {
  it("is asked after an email link, and a code then starts the session", async () => {
    const u = await mkUser();
    const first = await emailLinkSignIn(u.email);
    expect(first.headers.get("location")).toBe("/login/second-step/");
    expect(cookieOf(first, "eelsdb_session")).toBeUndefined();
    expect(await sessionCount(u.id)).toBe(0);
    expect(await (await go("/login/second-step/", { headers: { Cookie: withChallenge(first) } })).text()).toContain("Code from your authenticator app");

    const done = await secondStep(first, await currentCode(u.secret));
    expect(done.headers.get("location")).toBe("/account/");
    const cookie = cookieOf(done, "eelsdb_session")!;
    expect((await go("/account/", { headers: { Cookie: cookie } })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM login_challenges WHERE user_id = ?").bind(u.id).first("n")).toBe(0);
  });

  it("is asked after a password and keeps next", async () => {
    const u = await mkUser({ password: "a long password" });
    const first = await post("/login/password/", { login: u.email, password: "a long password", next: "/spectra/" });
    expect(first.headers.get("location")).toBe("/login/second-step/");
    expect(cookieOf(first, "eelsdb_session")).toBeUndefined();
    const done = await secondStep(first, await currentCode(u.secret));
    expect(done.headers.get("location")).toBe("/spectra/");
    expect(cookieOf(done, "eelsdb_session")).toBeDefined();
  });

  it("is not asked when two-step sign-in is off", async () => {
    const u = await mkUser({ totp: false });
    expect(cookieOf(await emailLinkSignIn(u.email), "eelsdb_session")).toBeDefined();
  });

  it("does not take the same code twice", async () => {
    const u = await mkUser();
    const code = await currentCode(u.secret);
    expect((await secondStep(await emailLinkSignIn(u.email), code)).headers.get("location")).toBe("/account/");
    const again = await secondStep(await emailLinkSignIn(u.email), code);
    expect(again.status).toBe(422);
    expect(cookieOf(again, "eelsdb_session")).toBeUndefined();
  });

  it("takes each recovery code once", async () => {
    const u = await mkUser();
    const cookie = await sessionFor({ id: u.id, display_name: "Two Step" });
    const codes = [...(await (await post("/account/settings/two-step/recovery/", { code: await currentCode(u.secret) }, cookie)).text()).matchAll(/<code>([a-z0-9]{5}-[a-z0-9]{5})<\/code>/g)].map((m) => m[1]);
    const ok = await secondStep(await emailLinkSignIn(u.email), codes[3].toUpperCase());
    expect(cookieOf(ok, "eelsdb_session")).toBeDefined();
    const reused = await secondStep(await emailLinkSignIn(u.email), codes[3]);
    expect(reused.status).toBe(422);
    expect(cookieOf(await secondStep(await emailLinkSignIn(u.email), codes[4]), "eelsdb_session")).toBeDefined();
  });

  it("allows 5 tries per challenge, then the person starts again", async () => {
    const u = await mkUser();
    const first = await emailLinkSignIn(u.email);
    for (let i = 0; i < 4; i++) expect((await secondStep(first, "000000")).status).toBe(422);
    const fifth = await secondStep(first, "000000");
    expect(fifth.headers.get("location")).toBe("/login/?error=second-step");
    // The right code no longer helps with that challenge.
    const after = await secondStep(first, await currentCode(u.secret));
    expect(after.headers.get("location")).toBe("/login/?error=second-step");
    expect(await sessionCount(u.id)).toBe(0);
  });

  it("locks the account after 10 wrong codes in an hour, across challenges", async () => {
    const u = await mkUser();
    for (let i = 0; i < 2; i++) {
      const first = await emailLinkSignIn(u.email);
      for (let j = 0; j < 5; j++) await secondStep(first, "000000");
    }
    const first = await emailLinkSignIn(u.email);
    const locked = await secondStep(first, await currentCode(u.secret));
    expect(locked.headers.get("location")).toBe("/login/?error=second-step-locked");
    expect(await sessionCount(u.id)).toBe(0);
  });

  it("rejects an expired or missing challenge", async () => {
    const u = await mkUser();
    const first = await emailLinkSignIn(u.email);
    await env.DB.prepare("UPDATE login_challenges SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?").bind(u.id).run();
    expect((await secondStep(first, await currentCode(u.secret))).headers.get("location")).toBe("/login/?error=second-step");
    expect((await post("/login/second-step/", { code: "123456" })).headers.get("location")).toBe("/login/?error=second-step");
    expect((await go("/login/second-step/")).headers.get("location")).toBe("/login/?error=second-step");
  });
});

describe("after ORCID, Google and GitHub", () => {
  async function github(id: number, name: string) {
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("token")) return Response.json({ access_token: "tok" });
      if (u.endsWith("/user/emails")) return Response.json([]);
      return Response.json({ id, login: name, name });
    });
    const start = await go("/auth/github/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    return createIfWelcomed(await go(`/auth/github/callback?code=abc&state=${state}`, { headers: { Cookie: cookieOf(start, "eelsdb_oauth")! } }));
  }
  const userOf = (subject: string) => env.DB.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND subject = ?").bind(subject).first<number>("user_id");

  it("is asked only if the account chose it, or is a moderator or admin", async () => {
    const id = 9100000 + (++n % 1000);
    expect(cookieOf(await github(id, "gh-two"), "eelsdb_session")).toBeDefined();
    const userId = (await userOf(String(id)))!;
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, ?, datetime('now'))").bind(userId, SECRET).run();

    const plain = await github(id, "gh-two");
    expect(cookieOf(plain, "eelsdb_session")).toBeDefined();

    await env.DB.prepare("UPDATE users SET mfa_all_methods = 1 WHERE id = ?").bind(userId).run();
    const chosen = await github(id, "gh-two");
    expect(chosen.headers.get("location")).toBe("/login/second-step/");
    expect(cookieOf(chosen, "eelsdb_session")).toBeUndefined();

    await env.DB.prepare("UPDATE users SET mfa_all_methods = 0, role = 'moderator' WHERE id = ?").bind(userId).run();
    expect((await github(id, "gh-two")).headers.get("location")).toBe("/login/second-step/");
  });

  it("is not asked for an account without two-step sign-in, even with the setting or a role", async () => {
    const id = 9101000 + (++n % 1000);
    await github(id, "gh-none");
    await env.DB.prepare("UPDATE users SET mfa_all_methods = 1 WHERE id = ?").bind((await userOf(String(id)))!).run();
    expect(cookieOf(await github(id, "gh-none"), "eelsdb_session")).toBeDefined();
  });

  it("can be switched on in settings with a code", async () => {
    const u = await mkUser();
    const cookie = await sessionFor({ id: u.id, display_name: "Two Step" });
    const refused = await post("/account/settings/two-step/all-methods/", { all_methods: "1", code: "000000" }, cookie);
    expect(refused.headers.get("location")).toContain("two-step-bad-code");
    await post("/account/settings/two-step/all-methods/", { all_methods: "1", code: await currentCode(u.secret) }, cookie);
    expect(await env.DB.prepare("SELECT mfa_all_methods AS v FROM users WHERE id = ?").bind(u.id).first("v")).toBe(1);
  });
});

describe("moderators and admins", () => {
  it("are sent to settings from /admin/ until two-step sign-in is on", async () => {
    const cookie = await sessionFor({ id: 9102001, display_name: "Mod No Two", role: "moderator" }, { totp: false });
    for (const path of ["/admin/", "/admin/submissions/1/", "/admin/users/"]) {
      const res = await go(path, { headers: { Cookie: cookie } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/account/settings/?notice=two-step-required#h-two-step");
    }
    const page = await (await go("/account/settings/?notice=two-step-required", { headers: { Cookie: cookie } })).text();
    expect(page).toContain("Until you set it up, your role does nothing");
  });

  it("have no role in other checks either without it", async () => {
    const bare = await sessionFor({ id: 9102002, display_name: "Admin No Two", role: "admin" }, { totp: false });
    const withTwo = await sessionFor({ id: 9102003, display_name: "Admin Two", role: "admin" });
    expect((await go("/admin/", { headers: { Cookie: withTwo } })).status).toBe(200);
    const approve = (cookie: string) => go("/instruments/1/versions/1/approve/", { method: "POST", headers: { Cookie: cookie, Origin: SITE } });
    expect((await approve(bare)).status).toBe(403);
    expect((await approve(withTwo)).status).not.toBe(403);
  });

  it("get their role back when two-step sign-in is on", async () => {
    const cookie = await sessionFor({ id: 9102004, display_name: "Mod Later", role: "moderator" }, { totp: false });
    expect((await go("/admin/", { headers: { Cookie: cookie } })).status).toBe(302);
    await env.DB.prepare("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (9102004, ?, datetime('now'))").bind(SECRET).run();
    expect((await go("/admin/", { headers: { Cookie: cookie } })).status).toBe(200);
  });
});

describe("drafts tokens", () => {
  it("need a sign-in in the last 15 minutes to make or revoke", async () => {
    const id = (await env.DB.prepare("INSERT INTO users (display_name) VALUES ('Draft Fresh') RETURNING id").first<number>("id"))!;
    const stale = await staleSession(id);
    const made = await post("/account/drafts/tokens/", { label: "x" }, stale);
    expect(made.status).toBe(403);
    expect(await made.text()).toContain("sign in again, then do it within 15 minutes");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM draft_tokens WHERE user_id = ?").bind(id).first("n")).toBe(0);

    await env.DB.prepare("INSERT INTO draft_tokens (user_id, hash, label) VALUES (?, 'h', 'keep')").bind(id).run();
    const tokenId = await env.DB.prepare("SELECT id FROM draft_tokens WHERE user_id = ?").bind(id).first<number>("id");
    expect((await post(`/account/drafts/tokens/${tokenId}/revoke/`, {}, stale)).status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM draft_tokens WHERE user_id = ?").bind(id).first("n")).toBe(1);

    const fresh = await sessionFor({ id, display_name: "Draft Fresh" });
    expect((await post(`/account/drafts/tokens/${tokenId}/revoke/`, {}, fresh)).status).toBe(302);
    expect((await post("/account/drafts/tokens/", { label: "y" }, fresh)).status).toBe(200);
  });
});
