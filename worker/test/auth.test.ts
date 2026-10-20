import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sent } from "../src/email";

const SITE = "https://eelsdb.eu";
const go = (path: string, init: RequestInit = {}) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init });
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
const post = (path: string, cookie: string, body?: Record<string, string>) =>
  go(path, {
    method: "POST",
    headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body ?? {}).toString(),
  });

/** Stubs the provider's token and profile endpoints, runs the whole redirect flow, returns the session cookie. */
async function signIn(provider: "github" | "google" | "orcid", profile: Record<string, any>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("token")) return Response.json({ access_token: "tok", orcid: profile.orcid, name: profile.name });
    if (u.endsWith("/user/emails")) return Response.json(profile.emails ?? []);
    return Response.json(profile);
  });
  const start = await go(`/auth/${provider}/start?next=/spectra/`);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const state = authorize.searchParams.get("state")!;
  const callback = await go(`/auth/${provider}/callback?code=abc&state=${state}`, { headers: { Cookie: cookieOf(start, "eelsdb_oauth")! } });
  expect(callback.headers.get("location")).toBe("/spectra/");
  return cookieOf(callback, "eelsdb_session")!;
}

afterEach(() => vi.unstubAllGlobals());

describe("sign-in", () => {
  it("lists the configured providers", async () => {
    const html = await (await go("/login/")).text();
    for (const label of ["ORCID", "Google", "GitHub"]) expect(html).toContain(`Continue with ${label}`);
  });

  it("creates an account and a session with GitHub, then signs out", async () => {
    const cookie = await signIn("github", { id: 101, login: "octo", name: "Octo Cat", emails: [{ email: "o@x.org", primary: true, verified: true }] });
    const page = await go("/account/", { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Octo Cat");

    expect((await go("/logout/", { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example" } })).status).toBe(403);
    expect((await post("/logout/", cookie)).status).toBe(302);
    expect((await go("/account/", { headers: { Cookie: cookie } })).headers.get("location")).toBe("/login/?next=%2Faccount%2F");
  });

  it("signs in to the same account the second time", async () => {
    const profile = { sub: "g-1", name: "Gee", email: "gee@x.org", email_verified: true };
    await signIn("google", profile);
    await signIn("google", profile);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE subject = 'g-1'").first("n")).toBe(1);
  });

  it("links a migrated account by verified email only", async () => {
    await env.DB.prepare("INSERT INTO users (id, display_name, legacy_email) VALUES (9000001, 'Old User', 'Old@Lab.org')").run();
    await signIn("google", { sub: "g-unverified", name: "X", email: "old@lab.org", email_verified: false });
    expect(await env.DB.prepare("SELECT user_id FROM identities WHERE subject = 'g-unverified'").first("user_id")).not.toBe(9000001);
    await signIn("google", { sub: "g-verified", name: "X", email: "old@lab.org", email_verified: true });
    expect(await env.DB.prepare("SELECT user_id FROM identities WHERE subject = 'g-verified'").first("user_id")).toBe(9000001);
  });

  it("rejects a callback with the wrong state", async () => {
    const start = await go("/auth/orcid/start");
    const res = await go("/auth/orcid/callback?code=abc&state=wrong", { headers: { Cookie: cookieOf(start, "eelsdb_oauth")! } });
    expect(res.headers.get("location")).toBe("/login/?error=state");
  });

  it("only redirects to paths on this site after sign-in", async () => {
    const start = await go("/auth/github/start?next=//evil.example/");
    expect(decodeURIComponent(cookieOf(start, "eelsdb_oauth")!)).toMatch(/\|\/account\/$/);
  });
});

describe("favourites", () => {
  it("toggles from the spectrum page and shows on the account page", async () => {
    const cookie = await signIn("github", { id: 202, login: "fav", name: "Fav Person" });
    await post("/favourites/22236/", cookie);
    expect(await (await go("/account/", { headers: { Cookie: cookie } })).text()).toContain("MLC Nanotube (Y,La)S-TaS2");
    expect(await (await go("/spectra/mlc-nanotube-ylas-tas2/", { headers: { Cookie: cookie } })).text()).toContain('aria-pressed="true"');
    await post("/favourites/22236/", cookie);
    expect(await (await go("/account/", { headers: { Cookie: cookie } })).text()).not.toContain("MLC Nanotube (Y,La)S-TaS2");
  });

  it("needs a signed-in user", async () => {
    expect((await go("/favourites/22236/", { method: "POST", headers: { Origin: SITE } })).status).toBe(302);
  });
});

describe("claiming an old account", () => {
  it("emails a link to the old address and merges the accounts", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, display_name, legacy_email, slug) VALUES (8000002, 'Legacy Person', 'legacy@lab.org', 'legacy')"),
      env.DB.prepare("INSERT INTO favourites (user_id, spectrum_id) VALUES (8000002, 22237)"),
    ]);
    const cookie = await signIn("orcid", { orcid: "0000-0002-1825-0097", name: "Legacy Person" });
    const before = sent.length;
    expect((await post("/account/claim/", cookie, { email: "LEGACY@lab.org" })).headers.get("location")).toBe("/account/?claim=sent");
    expect(sent.length).toBe(before + 1);
    const link = sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
    expect(sent.at(-1)!.to).toBe("LEGACY@lab.org");

    const path = new URL(link).pathname;
    expect((await go(path, { headers: { Cookie: cookie } })).status).toBe(200);
    const done = await post(path, cookie);
    const merged = cookieOf(done, "eelsdb_session")!;
    const page = await (await go("/account/", { headers: { Cookie: merged } })).text();
    expect(page).toContain("Legacy Person");
    expect(page).toContain("MLC Nanotube (Y0.6La0.4)S-TaS2");
    expect(await env.DB.prepare("SELECT orcid FROM users WHERE id = 8000002").first("orcid")).toBe("0000-0002-1825-0097");
    expect((await go(path, { headers: { Cookie: merged } })).status).toBe(404);
  });

  it("answers the same for unknown addresses and sends nothing", async () => {
    const cookie = await signIn("github", { id: 303, login: "nobody", name: "Nobody" });
    const before = sent.length;
    expect((await post("/account/claim/", cookie, { email: "unknown@lab.org" })).headers.get("location")).toBe("/account/?claim=sent");
    expect(sent.length).toBe(before);
  });
});
