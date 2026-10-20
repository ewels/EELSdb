// Regression tests for problems found in code review.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { safeNext } from "../src/auth";
import { cleanBrowserChecks, parseForm } from "../src/submit/form";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const page = (path: string, cookie?: string) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
const post = (path: string, cookie: string, fd: FormData | Record<string, string>) =>
  exports.default.fetch(`${SITE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, Origin: SITE, ...(fd instanceof FormData ? {} : { "Content-Type": "application/x-www-form-urlencoded" }) },
    body: fd instanceof FormData ? fd : new URLSearchParams(fd).toString(),
  });
const BASE = { type: "coreloss", formula: "C", edges: "C_K", beam_energy_choice: "200", convergence: "20", collection: "30", agreement: "1" };
function submission(values: Record<string, string>, file = new File(["280.0 1\n280.1 2\n280.2 3\n"], "c.txt")) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...BASE, ...values })) fd.append(k, v);
  if (file) fd.append("file", file);
  return fd;
}
const submittedId = (res: Response) => Number(new URL(res.headers.get("location")!, SITE).searchParams.get("submitted"));

describe("code review fixes", () => {
  it("never serves an upload with the type its uploader claimed", async () => {
    const owner = await sessionFor({ id: 6400001, display_name: "Html Uploader" });
    const evil = new File(["1 2\n<script>alert(1)</script>"], "x.txt", { type: "text/html" });
    const id = submittedId(await post("/submit-data/", owner, submission({ title: "Evil text" }, evil)));
    const key = await env.DB.prepare("SELECT r2_key FROM files WHERE spectrum_id = ?").bind(id).first<string>("r2_key");
    const res = await page(`/${key}`, owner);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("rejects javascript: reference links", () => {
    expect(parseForm({ ...BASE, title: "x", ref_url: "javascript:alert(1)" }).errors).toHaveProperty("ref_url");
  });

  it("only redirects to same-site paths", () => {
    for (const bad of ["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com", "/%5Cevil.com"]) {
      expect(new URL(safeNext(bad), SITE).origin, bad).toBe(SITE);
    }
    expect(safeNext("/spectra/?type=coreloss")).toBe("/spectra/?type=coreloss");
  });

  it("keeps only well-formed browser check results", () => {
    expect(cleanBrowserChecks("{not json")).toBeNull();
    expect(JSON.parse(cleanBrowserChecks('{"energy_min":"x","findings":"nope"}')!)).toMatchObject({ energy_min: null, findings: [] });
  });

  it("returns a corrected submission to the queue", async () => {
    const owner = await sessionFor({ id: 6400002, display_name: "Fixer" });
    const mod = await sessionFor({ id: 6400003, display_name: "Mod", role: "moderator" });
    const id = submittedId(await post("/submit-data/", owner, submission({ title: "Needs work" })));
    const subId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(id).first<number>("id");
    await post(`/admin/submissions/${subId}/`, mod, { decision: "request_changes", notes: "Add a description." });
    await post("/spectra/needs-work/edit/", owner, submission({ title: "Needs work", description: "Added." }, null as any));
    expect(await env.DB.prepare("SELECT status FROM submissions WHERE id = ?").bind(subId).first("status")).toBe("pending");
    expect(await (await page("/admin/", mod)).text()).toContain("Needs work");
  });

  it("lets someone who has already submitted claim their old account", async () => {
    await env.DB.prepare("INSERT INTO users (id, display_name, legacy_email) VALUES (7400001, 'Old Me', 'oldme@lab.org')").run();
    const cookie = await sessionFor({ id: 6400004, display_name: "New Me" });
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (6400004, 'orcid', '0000-0000-0000-0004')").run();
    await post("/submit-data/", cookie, submission({ title: "Before claiming" }));
    await post("/account/tokens/", cookie, { label: "x" });
    await post("/account/claim/", cookie, { email: "oldme@lab.org" });
    const { sent } = await import("../src/email");
    const path = new URL(sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).pathname;
    const done = await post(path, cookie, {});
    expect(done.headers.get("location")).toBe("/account/?claim=done");
    expect(await env.DB.prepare("SELECT submitted_by FROM submissions s JOIN spectra p ON p.id = s.spectrum_id WHERE p.title = 'Before claiming'").first("submitted_by")).toBe(7400001);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = 7400001").first("n")).toBe(1);
  });

  it("applies only the measurement when an edit is approved, and allows one waiting at a time", async () => {
    const owner = await sessionFor({ id: 6400005, display_name: "Editor" });
    const mod = await sessionFor({ id: 6400006, display_name: "Mod Two", role: "moderator" });
    const id = submittedId(await post("/submit-data/", owner, submission({ title: "Edited twice" })));
    const subId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(id).first<number>("id");
    await post(`/admin/submissions/${subId}/`, mod, { decision: "approve" });

    await post("/spectra/edited-twice/edit/", owner, submission({ title: "Edited twice", beam_energy_choice: "300" }, null as any));
    expect((await post("/spectra/edited-twice/edit/", owner, submission({ title: "Edited twice", beam_energy_choice: "80" }, null as any))).status).toBe(409);
    await post("/spectra/edited-twice/edit/", owner, submission({ title: "Edited twice", description: "Newer text" }, null as any));
    const editId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ? AND kind = 'edit'").bind(id).first<number>("id");
    await post(`/admin/submissions/${editId}/`, mod, { decision: "approve" });
    expect(await env.DB.prepare("SELECT description FROM spectra WHERE id = ?").bind(id).first("description")).toBe("Newer text");
    expect(await env.DB.prepare("SELECT beam_energy_kv FROM eels_acquisition WHERE spectrum_id = ?").bind(id).first("beam_energy_kv")).toBe(300);
  });

  it("shows reviewers the new file in an edit, and stages processed files until approval", async () => {
    const owner = await sessionFor({ id: 6400007, display_name: "File Editor" });
    const modCookie = await sessionFor({ id: 6400008, display_name: "Mod Three", role: "moderator" });
    const id = submittedId(await post("/submit-data/", owner, submission({ title: "New data" })));
    const subId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(id).first<number>("id");
    await post(`/admin/submissions/${subId}/`, modCookie, { decision: "approve" });

    await post("/spectra/new-data/edit/", owner, submission({ title: "New data" }, new File(["300 1\n300.1 2\n300.2 3\n"], "α-new.txt")));
    const editId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ? AND kind = 'edit'").bind(id).first<number>("id");
    const download = await page(`/admin/submissions/${editId}/files/edit/`, modCookie);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("filename*=UTF-8''%CE%B1-new.txt");
    expect(await download.text()).toContain("300.1");

    const html = await post("/account/tokens/", modCookie, { label: "t" });
    const token = (await html.text()).match(/eelsdb_[0-9a-f]{48}/)![0];
    const api = (path: string, init: RequestInit) =>
      exports.default.fetch(`https://api.eelsdb.eu/cli${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    expect((await api(`/queue/${editId}`, { method: "GET" }).then((r) => r.json<any>())).proposed.spectrum.title).toBe("New data");
    await api(`/queue/${editId}/files/msa?filename=new.msa`, { method: "PUT", body: "#FORMAT : x\n" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE spectrum_id = ? AND role = 'msa'").bind(id).first("n")).toBe(0);
    await api(`/queue/${editId}/approve`, { method: "POST" });
    expect(await env.DB.prepare("SELECT r2_key FROM files WHERE spectrum_id = ? AND role = 'msa'").bind(id).first("r2_key")).toBe(`files/${id}/s${editId}/new.msa`);
    expect(await env.DB.prepare("SELECT filename FROM files WHERE spectrum_id = ? AND role = 'original'").bind(id).first("filename")).toBe("α-new.txt");
  });

  it("survives malformed stored browser checks on the review page", async () => {
    const owner = await sessionFor({ id: 6400009, display_name: "Bad Checks" });
    const mod = await sessionFor({ id: 6400010, display_name: "Mod Four", role: "moderator" });
    const id = submittedId(await post("/submit-data/", owner, submission({ title: "Bad checks" })));
    await env.DB.prepare("UPDATE submissions SET browser_checks_json = '{broken' WHERE spectrum_id = ?").bind(id).run();
    const subId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(id).first<number>("id");
    expect((await page(`/admin/submissions/${subId}/`, mod)).status).toBe(200);
  });

  it("locks old-password sign-in after repeated failures", async () => {
    await env.DB.prepare("INSERT INTO users (id, display_name, legacy_login, legacy_password_hash) VALUES (7400002, 'Locked', 'lockme', '$P$BabcdefghKfdE7H4Uy7ajxpijsjAJW0')").run();
    const attempt = (password: string) =>
      exports.default.fetch(`${SITE}/login/password/`, {
        method: "POST",
        redirect: "manual",
        headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ login: "lockme", password }).toString(),
      });
    for (let i = 0; i < 10; i++) await attempt("wrong");
    expect((await attempt("correct horse")).headers.get("location")).toBe("/login/?error=locked");
  });

  it("links other people's spectra one way only", async () => {
    const owner = await sessionFor({ id: 6400011, display_name: "Linker" });
    await post("/submit-data/", owner, submission({ title: "Linking", associated: "mlc-nanotube-ylas-tas2" }));
    const target = await env.DB.prepare("SELECT id FROM spectra WHERE slug = 'mlc-nanotube-ylas-tas2'").first<number>("id");
    const mine = await env.DB.prepare("SELECT id FROM spectra WHERE slug = 'linking'").first<number>("id");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM spectrum_links WHERE spectrum_id = ? AND related_id = ?").bind(mine, target).first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM spectrum_links WHERE spectrum_id = ? AND related_id = ?").bind(target, mine).first("n")).toBe(0);
  });

  it("rejects an unapproved instrument profile without leaving a half-made spectrum", async () => {
    const owner = await sessionFor({ id: 6400012, display_name: "Profile Faker" });
    const res = await post("/submit-data/", owner, submission({ title: "Fake profile", instrument: "999:1" }));
    expect(res.status).toBe(422);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE slug = 'fake-profile'").first("n")).toBe(0);
  });

  it("does not roll an instrument back when an older version is approved late", async () => {
    const staff = await sessionFor({ id: 6400013, display_name: "Staff" });
    const mod = await sessionFor({ id: 6400014, display_name: "Mod Five", role: "moderator" });
    const created = await post("/instruments/new/", staff, { name: "Scope v1" });
    const id = Number(created.headers.get("location")!.split("/")[2]);
    await post(`/instruments/${id}/edit/`, staff, { name: "Scope v2" });
    await post(`/instruments/${id}/versions/2/approve/`, mod, {});
    await post(`/instruments/${id}/versions/1/approve/`, mod, {});
    expect(await env.DB.prepare("SELECT current_version FROM instruments WHERE id = ?").bind(id).first("current_version")).toBe(2);
  });
});
