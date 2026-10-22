import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBundle } from "../src/api/format";
import { sha256 } from "../src/auth";
import { valuesFromBundle } from "../src/submit/edit";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const API = "https://api.eelsdb.eu";
const MSA = "#FORMAT : EMSA/MAS Spectral Data File\n#SPECTRUM : x\n280.0, 1\n280.1, 2\n280.2, 3\n";
const go = (path: string, cookie = "", init: RequestInit = {}) =>
  exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as object) } });
const postForm = (path: string, cookie: string, body: Record<string, string | string[]> = {}) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) params.append(k, x);
  return go(path, cookie, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
};
const multipart = (path: string, cookie: string, fields: Record<string, string>, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...fields, ...extra })) fd.append(k, v);
  return go(path, cookie, { method: "POST", headers: { Origin: SITE }, body: fd });
};
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
const count = (sql: string, ...args: unknown[]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).bind(...args).first<number>("n").then((n) => n ?? 0);
const setRequired = (on: boolean) => env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('require_orcid', ?)").bind(on ? "1" : "0").run();
const config = env as { ORCID_CLIENT_ID?: string };
const configured = config.ORCID_CLIENT_ID;

let nextId = 9940100;
const user = (name = "Orcid Person") => sessionFor({ id: ++nextId, display_name: name }, { email: true }).then((cookie) => ({ id: nextId, cookie }));
const linkOrcid = (id: number, subject = `0000-0001-0000-${id}`) =>
  env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', ?)").bind(id, subject).run();

beforeEach(() => setRequired(false));
afterEach(() => {
  vi.unstubAllGlobals();
  config.ORCID_CLIENT_ID = configured;
});

/** Stubs the provider endpoints and runs the link flow for a signed-in user; returns the callback response. */
async function link(cookie: string, provider: "github" | "google" | "orcid", profile: Record<string, any>, next = "/spectra/") {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("token")) return Response.json({ access_token: "tok", orcid: profile.orcid, name: profile.name });
    if (u.endsWith("/user/emails")) return Response.json(profile.emails ?? []);
    return Response.json(profile);
  });
  const start = await go(`/auth/${provider}/link?next=${encodeURIComponent(next)}`, cookie);
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  return go(`/auth/${provider}/callback?code=abc&state=${state}`, cookie, { headers: { Cookie: `${cookie}; ${cookieOf(start, "eelsdb_oauth")!}` } });
}

describe("linking a service", () => {
  it("adds ORCID, Google and GitHub to the signed-in account without a new account, session or method", async () => {
    const u = await user();
    const users = await count("SELECT id FROM users");
    const sessions = await count("SELECT id FROM sessions");
    const cases = [
      ["orcid", { orcid: "0000-0002-1825-0097", name: "Josiah Carberry" }],
      ["google", { sub: "link-g-1", name: "Gee", email: "gee@example.invalid", email_verified: true }],
      ["github", { id: 7770001, login: "octo", name: "Octo" }],
    ] as const;
    for (const [provider, profile] of cases) {
      const res = await link(u.cookie, provider, profile);
      expect(res.headers.get("location"), provider).toBe("/spectra/");
      expect(cookieOf(res, "eelsdb_session"), provider).toBeUndefined();
      expect(cookieOf(res, "eelsdb_last_method"), provider).toBeUndefined();
      expect(await count("SELECT 1 FROM identities WHERE user_id = ? AND provider = ?", u.id, provider), provider).toBe(1);
    }
    expect(await count("SELECT id FROM users")).toBe(users);
    expect(await count("SELECT id FROM sessions")).toBe(sessions);
    expect(await env.DB.prepare("SELECT orcid FROM users WHERE id = ?").bind(u.id).first("orcid")).toBe("0000-0002-1825-0097");
  });

  it("replaces an ORCID iD typed in before with the verified one", async () => {
    const u = await user();
    await env.DB.prepare("UPDATE users SET orcid = '0000-0000-0000-0001' WHERE id = ?").bind(u.id).run();
    await link(u.cookie, "orcid", { orcid: "0000-0002-1694-233X", name: "X" });
    expect(await env.DB.prepare("SELECT orcid FROM users WHERE id = ?").bind(u.id).first("orcid")).toBe("0000-0002-1694-233X");
  });

  it("changes nothing and says so when the account is linked to someone else", async () => {
    const owner = await user();
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', '0000-0003-0000-0001')").bind(owner.id).run();
    const u = await user();
    const res = await link(u.cookie, "orcid", { orcid: "0000-0003-0000-0001", name: "Taken" });
    expect(res.headers.get("location")).toBe("/account/settings/sign-in/?notice=link-taken#h-signin");
    expect(await count("SELECT 1 FROM identities WHERE user_id = ?", u.id)).toBe(0);
    expect(await env.DB.prepare("SELECT orcid FROM users WHERE id = ?").bind(u.id).first("orcid")).toBeNull();
    const page = await (await go("/account/settings/sign-in/?notice=link-taken", u.cookie)).text();
    expect(page).toContain("already linked to a different EELSdb account");
  });

  it("refuses a second account of the same kind and linking again is harmless", async () => {
    const u = await user();
    await link(u.cookie, "orcid", { orcid: "0000-0004-0000-0001", name: "One" });
    expect((await link(u.cookie, "orcid", { orcid: "0000-0004-0000-0002", name: "Two" })).headers.get("location")).toBe("/account/settings/sign-in/?notice=link-has#h-signin");
    expect((await link(u.cookie, "orcid", { orcid: "0000-0004-0000-0001", name: "One" })).headers.get("location")).toBe("/spectra/");
    expect(await count("SELECT 1 FROM identities WHERE user_id = ?", u.id)).toBe(1);
  });

  it("needs a signed-in user, a good state and a safe return address", async () => {
    expect((await go("/auth/orcid/link")).headers.get("location")).toMatch(/^\/login\/\?next=/);
    const u = await user();
    const start = await go("/auth/orcid/link?next=//evil.example/", u.cookie);
    expect(decodeURIComponent(cookieOf(start, "eelsdb_oauth")!)).toMatch(/\|\/account\/\|link$/);
    const bad = await go("/auth/orcid/callback?code=abc&state=wrong", u.cookie, { headers: { Cookie: `${u.cookie}; ${cookieOf(start, "eelsdb_oauth")!}` } });
    expect(bad.headers.get("location")).toBe("/account/settings/sign-in/?notice=link-failed#h-signin");
    expect(await count("SELECT 1 FROM identities WHERE user_id = ?", u.id)).toBe(0);
  });

  it("shows the ORCID row on the profile page, greyed out when ORCID sign-in is off", async () => {
    const u = await user();
    const on = await (await go("/account/settings/profile/", u.cookie)).text();
    expect(on).toContain("/auth/orcid/link?next=");
    config.ORCID_CLIENT_ID = "";
    const off = await (await go("/account/settings/profile/", u.cookie)).text();
    expect(off).not.toContain("/auth/orcid/link");
    expect(off).toMatch(/<button class="button secondary" type="button" disabled="">Link ORCID<\/button>/);
    expect(off).toContain("ORCID sign-in is not available at the moment.");
  });

  it("offers a button for each service not yet linked", async () => {
    const u = await user();
    await linkOrcid(u.id);
    const page = await (await go("/account/settings/sign-in/", u.cookie)).text();
    expect(page).toContain("Link Google");
    expect(page).toContain("Link GitHub");
    expect(page).not.toContain("Link ORCID");
    expect(page).not.toContain("Sign in once with ORCID");
  });
});

describe("banner", () => {
  const banner = async (path: string, cookie = "") => (await (await go(path, cookie)).text()).includes('class="orcid-banner"');

  it("shows to signed-in people without a linked ORCID, on every page", async () => {
    const u = await user();
    expect(await banner("/", u.cookie)).toBe(true);
    expect(await banner("/spectra/", u.cookie)).toBe(true);
    const html = await (await go("/", u.cookie)).text();
    expect(html).toContain('role="region" aria-label="Link your ORCID iD"');
    expect(html).toContain("/auth/orcid/link?next=");
  });

  it("is not shown signed out, with an ORCID linked, or when ORCID is not set up", async () => {
    const u = await user();
    expect(await banner("/")).toBe(false);
    await linkOrcid(u.id);
    expect(await banner("/", u.cookie)).toBe(false);
    const v = await user();
    config.ORCID_CLIENT_ID = "";
    expect(await banner("/", v.cookie)).toBe(false);
  });

  it("does not count an ORCID iD on the profile that no ORCID sign-in confirmed", async () => {
    const u = await user();
    await env.DB.prepare("UPDATE users SET orcid = '0000-0002-1825-0097' WHERE id = ?").bind(u.id).run();
    expect(await banner("/", u.cookie)).toBe(true);
  });

  it("is not on the sign-in pages", async () => {
    const u = await user();
    expect(await banner("/login/", u.cookie)).toBe(false);
    expect(await banner("/login/second-step/", u.cookie)).toBe(false);
  });

  it("can be hidden for 30 days, and gives way to the submit page's own notice while ORCID is required", async () => {
    const u = await user();
    const home = await (await go("/", u.cookie)).text();
    expect(home).toContain("Hide for 30 days");
    expect(home).toContain("orcid-banner-hidden");
    expect(await banner("/submit-data/", u.cookie)).toBe(true);
    await setRequired(true);
    expect(await banner("/submit-data/", u.cookie)).toBe(false);
    expect(await (await go("/submit-data/", u.cookie)).text()).toContain("/auth/orcid/link");
    expect(await banner("/spectra/", u.cookie)).toBe(true);
  });
});

describe("site settings page", () => {
  it("is for admins with a recent sign-in", async () => {
    const mod = await sessionFor({ id: ++nextId, display_name: "A Moderator", role: "moderator" });
    const admin = await sessionFor({ id: ++nextId, display_name: "An Admin", role: "admin" });
    const adminId = nextId;
    expect((await go("/admin/settings/")).status).toBe(302);
    expect((await go("/admin/settings/", mod)).status).toBe(403);
    expect((await postForm("/admin/settings/", mod, { require_orcid: "1" })).status).toBe(403);
    expect(await (await go("/admin/", admin)).text()).toContain("/admin/settings/");
    expect(await (await go("/admin/", mod)).text()).not.toContain("/admin/settings/");

    const page = await (await go("/admin/settings/", admin)).text();
    expect(page).toContain("Require a linked ORCID iD to submit spectra");

    const stale = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'))")
      .bind(await sha256(stale), adminId).run();
    expect((await postForm("/admin/settings/", `eelsdb_session=${stale}`, {})).headers.get("location")).toBe("/admin/settings/?notice=stale");
    expect(await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'require_orcid'").first("value")).toBe("0");

    expect((await postForm("/admin/settings/", admin, {})).headers.get("location")).toBe("/admin/settings/?notice=saved");
    expect(await env.DB.prepare("SELECT value, updated_by FROM site_settings WHERE key = 'require_orcid'").first()).toEqual({ value: "0", updated_by: adminId });
    await postForm("/admin/settings/", admin, { require_orcid: "1" });
    expect(await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'require_orcid'").first("value")).toBe("1");
    const after = await (await go("/admin/settings/", admin)).text();
    expect(after).toMatch(/checked/);
    expect(after).toContain("by An Admin");
  });

  it("is on when nothing was ever saved, and says when ORCID is not set up", async () => {
    await env.DB.prepare("DELETE FROM site_settings WHERE key = 'require_orcid'").run();
    const admin = await sessionFor({ id: ++nextId, display_name: "Default Admin", role: "admin" });
    expect(await (await go("/admin/settings/", admin)).text()).toMatch(/name="require_orcid"[^>]*checked/);
    const u = await user();
    expect(await (await go("/submit-data/", u.cookie)).text()).toContain("needs an ORCID iD");
    config.ORCID_CLIENT_ID = "";
    expect(await (await go("/admin/settings/", admin)).text()).toContain("ORCID sign-in is not set up");
    expect(await (await go("/submit-data/", u.cookie)).text()).not.toContain("needs an ORCID iD");
  });
});

describe("the requirement", () => {
  const fields = (title: string) => ({ title, type: "coreloss", formula: "C", beam_energy_choice: "300", convergence: "20", collection: "40", edges: "C_K", agreement: "1" });
  const send = (cookie: string, title: string) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields(title))) fd.append(k, v);
    fd.append("file", new File([MSA], `${title}.msa`));
    return go("/submit-data/", cookie, { method: "POST", headers: { Origin: SITE }, body: fd });
  };
  const makeDraft = async (cookie: string, name: string) => {
    const html = await (await postForm("/account/settings/tokens/", cookie, { label: "t" })).text();
    const token = html.match(/eelsdb_draft_[0-9a-f]{48}/)![0];
    const fd = new FormData();
    fd.append("type", "coreloss");
    fd.append("formula", "C");
    fd.append("file", new File([MSA], `${name}.msa`));
    const res = await exports.default.fetch(`${API}/v2/drafts`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { res, token };
  };

  it("refuses new submissions, and the form says so before it starts", async () => {
    await setRequired(true);
    const u = await user();
    const form = await go("/submit-data/", u.cookie);
    const html = await form.text();
    expect(html).toContain("needs an ORCID iD");
    expect(html).toContain("Link ORCID");
    expect(html).not.toContain('id="submit-form"');
    const before = await count("SELECT id FROM spectra");
    const res = await send(u.cookie, "orcid-refused");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("needs an ORCID iD");
    const json = await go("/submit-data/", u.cookie, { method: "POST", headers: { Origin: SITE, Accept: "application/json" }, body: new FormData() });
    expect(json.status).toBe(403);
    expect((await json.json<any>()).errors.orcid).toContain("ORCID iD");
    expect(await count("SELECT id FROM spectra")).toBe(before);
  });

  it("allows them with a linked ORCID, with the setting off, or when ORCID is not set up", async () => {
    const linked = await user();
    await linkOrcid(linked.id);
    await setRequired(true);
    expect((await send(linked.cookie, "orcid-linked")).headers.get("location")).toMatch(/^\/account\/submissions\/\?submitted=/);
    expect(await (await go("/submit-data/", linked.cookie)).text()).toContain('id="submit-form"');

    const u = await user();
    await setRequired(false);
    expect((await send(u.cookie, "orcid-off")).status).toBe(302);
    await setRequired(true);
    config.ORCID_CLIENT_ID = "";
    expect((await send(u.cookie, "orcid-unconfigured")).status).toBe(302);
  });

  it("refuses drafts being submitted, from the list and from the check page, but not making them", async () => {
    const u = await user();
    const { res } = await makeDraft(u.cookie, "orcid-draft-a");
    expect(res.status).toBe(201);
    const id = (await res.json<any>()).id;
    await setRequired(true);
    expect((await makeDraft(u.cookie, "orcid-draft-b")).res.status).toBe(201);

    const list = await go("/account/drafts/", u.cookie);
    expect(await list.text()).toContain("needs an ORCID iD");
    const bulk = await postForm("/account/drafts/", u.cookie, { action: "submit", id: String(id), agreement: "1" });
    expect(bulk.status).toBe(403);
    expect(await bulk.text()).toContain("needs an ORCID iD");
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(id).first("status")).toBe("draft");

    const check = await go("/spectra/orcid-draft-a/edit/", u.cookie);
    expect(await check.text()).toContain("needs an ORCID iD");
    const sent = await multipart("/spectra/orcid-draft-a/edit/", u.cookie, { ...fields("orcid-draft-a") });
    expect(sent.status).toBe(403);
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(id).first("status")).toBe("draft");

    await linkOrcid(u.id);
    const ok = await postForm("/account/drafts/", u.cookie, { action: "submit", id: String(id), agreement: "1" });
    expect(ok.headers.get("location")).toBe("/account/submissions/?submitted=1");
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(id).first("status")).toBe("pending");
  });

  it("does not touch edits of published spectra", async () => {
    await setRequired(true);
    const u = await user();
    const slug = "mlc-nanotube-ylas-tas2";
    await env.DB.prepare("UPDATE spectra SET owner_id = ? WHERE slug = ?").bind(u.id, slug).run();
    const id = (await env.DB.prepare("SELECT id FROM spectra WHERE slug = ?").bind(slug).first<number>("id"))!;
    const form = await go(`/spectra/${slug}/edit/`, u.cookie);
    expect(form.status).toBe(200);
    expect(await form.text()).not.toContain("needs an ORCID iD");
    const values = valuesFromBundle((await loadBundle(env.DB, id))!);
    const res = await multipart(`/spectra/${slug}/edit/`, u.cookie, { ...values, description: "Edited without an ORCID." });
    expect(res.headers.get("location")).toBe(`/spectra/${slug}/`);
  });
});
