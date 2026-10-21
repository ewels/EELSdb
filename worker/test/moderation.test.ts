import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sent } from "../src/email";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const API = "https://api.eelsdb.eu";
const MSA = "#FORMAT : EMSA/MAS Spectral Data File\n#SPECTRUM : x\n280.0, 1\n280.1, 2\n280.2, 3\n";
const page = (path: string, cookie?: string) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
const form = (path: string, cookie: string, body: Record<string, string> = {}) =>
  exports.default.fetch(`${SITE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
const api = (path: string, token: string, init: RequestInit = {}) =>
  exports.default.fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

async function tokenFor(cookie: string) {
  const html = await (await form("/account/tokens/", cookie, { label: "test" })).text();
  return html.match(/eelsdb_[0-9a-f]{48}/)![0];
}

function submission(title: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ title, type: "coreloss", formula: "C", beam_energy_choice: "300", convergence: "20", collection: "40", edges: "C_K" })) fd.append(k, v);
  fd.append("file", new File([MSA], "c.msa"));
  return fd;
}

describe("API tokens", () => {
  it("are shown once, authenticate the CLI API, and can be revoked", async () => {
    const cookie = await sessionFor({ id: 6300001, display_name: "Token User" });
    const token = await tokenFor(cookie);
    expect(await (await api("/cli/me", token)).json()).toMatchObject({ id: 6300001 });
    expect((await api("/cli/me", "eelsdb_nope")).status).toBe(401);
    expect(await (await page("/account/tokens/", cookie)).text()).not.toContain(token);
    const id = await env.DB.prepare("SELECT id FROM api_tokens WHERE user_id = 6300001").first<number>("id");
    await form(`/account/tokens/${id}/revoke/`, cookie);
    expect((await api("/cli/me", token)).status).toBe(401);
  });
});

describe("review", () => {
  it("runs from CLI submission to publication", async () => {
    const submitterCookie = await sessionFor({ id: 6300002, display_name: "Cli Submitter" });
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject, email, email_verified) VALUES (6300002, 'github', 'cli-1', 'cli@lab.org', 1)").run();
    const modCookie = await sessionFor({ id: 6300003, display_name: "Mod Reviewer", role: "moderator" });
    const submitter = await tokenFor(submitterCookie);
    const mod = await tokenFor(modCookie);

    const created = await api("/cli/submissions", submitter, { method: "POST", body: submission("CLI carbon") });
    expect(created.status).toBe(201);
    const { id: spectrumId, slug } = await created.json<any>();

    // Not public yet, but the submitter can preview it.
    expect((await page(`/spectra/${slug}/`)).status).toBe(404);
    expect(await (await page(`/spectra/${slug}/`, submitterCookie)).text()).toContain("Not published yet");

    expect((await api("/cli/queue", submitter)).status).toBe(403);
    const queue = await (await api("/cli/queue", mod)).json<any[]>();
    const sub = queue.find((q) => q.spectrum_id === spectrumId);
    expect(sub).toBeTruthy();
    expect(await (await api(`/cli/queue/${sub.id}/files/original`, mod)).text()).toBe(MSA);

    const put = await api(`/cli/queue/${sub.id}/files/msa?filename=cli-carbon.msa`, mod, { method: "PUT", body: MSA });
    expect(put.status).toBe(201);
    await api(`/cli/queue/${sub.id}/processing`, mod, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tools: [{ tool: "rosettasciio", version: "0.15.0" }, { tool: "exspy", version: "0.3.2" }], warnings: [], values: { min_energy_ev: 280, max_energy_ev: 280.2, step_ev: 0.1 } }),
    });
    const before = sent.length;
    expect((await api(`/cli/queue/${sub.id}/approve`, mod, { method: "POST" })).status).toBe(200);
    expect(sent.slice(before).map((e) => e.to)).toEqual(["cli@lab.org"]);
    expect((await api(`/cli/queue/${sub.id}/approve`, mod, { method: "POST" })).status).toBe(409);

    const v1 = await (await exports.default.fetch(`${API}/spectra/${slug}/`)).json<any>();
    expect(v1.download_link).toBe(`${SITE}/files/${spectrumId}/s${sub.id}/cli-carbon.msa`);
    expect(v1.min_energy).toBe("280 eV");
    expect(v1.beamenergy).toBe("300 kV");
    expect(await (await page(`/files/${spectrumId}/s${sub.id}/cli-carbon.msa`)).text()).toBe(MSA);
  });

  it("keeps processed versions and the file's metadata", async () => {
    const submitter = await tokenFor(await sessionFor({ id: 6300020, display_name: "Variant Submitter" }));
    const mod = await tokenFor(await sessionFor({ id: 6300021, display_name: "Variant Mod", role: "moderator" }));
    const bad = submission("Bad variant");
    bad.append("variant_os_file", new File(["<html>"], "os.msa"));
    expect(await (await api("/cli/submissions", submitter, { method: "POST", body: bad })).json()).toMatchObject({ errors: { variant_os_file: expect.any(String) } });

    const fd = submission("Gas NO");
    fd.append("variant_os_file", new File([MSA], "no-os.msa"));
    fd.append("variant_smoothed_file", new File([MSA], "no-smoothed.msa"));
    const { id: spectrumId, slug } = await (await api("/cli/submissions", submitter, { method: "POST", body: fd })).json<any>();
    const sub = (await (await api("/cli/queue", mod)).json<any[]>()).find((q) => q.spectrum_id === spectrumId);
    const metadata = JSON.stringify({ ImageList: { Voltage: 200000 } });
    expect((await api(`/cli/queue/${sub.id}/files/metadata?filename=gas-no.metadata.json`, mod, { method: "PUT", body: metadata })).status).toBe(201);
    await api(`/cli/queue/${sub.id}/processing`, mod, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tools: [{ tool: "rosettasciio", version: "0.15.0" }] }),
    });
    await api(`/cli/queue/${sub.id}/approve`, mod, { method: "POST" });

    const v2 = await (await exports.default.fetch(`${API}/v2/spectra/${spectrumId}`)).json<any>();
    expect(v2.files.filter((f: any) => f.role !== "original").map((f: any) => [f.role, f.variant, f.intensity_units])).toEqual([
      ["variant", "os", "oscillator_strength"],
      ["variant", "smoothed", null],
      ["metadata", null, null],
    ]);
    const html = await (await page(`/spectra/${slug}/`)).text();
    expect(html).toMatch(/<select id="plot-version">.*Oscillator strength.*Smoothed/s);
    expect(html).toContain("Processed versions");
    expect(html).toContain("Metadata from the file");
    const os = v2.files.find((f: any) => f.variant === "os");
    expect(await (await exports.default.fetch(os.url)).text()).toBe(MSA);
  });

  it("uses the admin pages to request changes, reject and apply edits", async () => {
    const owner = await sessionFor({ id: 6300004, display_name: "Page Submitter" });
    const mod = await sessionFor({ id: 6300005, display_name: "Page Mod", role: "moderator" });
    const fd = submission("Admin carbon");
    fd.append("agreement", "1");
    const res = await exports.default.fetch(`${SITE}/submit-data/`, { method: "POST", redirect: "manual", headers: { Cookie: owner, Origin: SITE }, body: fd });
    const spectrumId = Number(new URL(res.headers.get("location")!, SITE).searchParams.get("submitted"));
    const subId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(spectrumId).first<number>("id");

    expect((await page("/admin/", owner)).status).toBe(403);
    expect(await (await page("/admin/", mod)).text()).toContain("Admin carbon");
    expect(await (await page(`/admin/submissions/${subId}/`, mod)).text()).toContain("c.msa");

    expect((await form(`/admin/submissions/${subId}/`, mod, { decision: "request_changes" })).status).toBe(400);
    await form(`/admin/submissions/${subId}/`, mod, { decision: "request_changes", notes: "Please add the reference." });
    expect(await (await page("/account/submissions/", owner)).text()).toContain("Please add the reference.");
    await form(`/admin/submissions/${subId}/`, mod, { decision: "approve" });
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(spectrumId).first("status")).toBe("published");

    // An edit of the measurement waits for review, then applies.
    const slug = await env.DB.prepare("SELECT slug FROM spectra WHERE id = ?").bind(spectrumId).first<string>("slug");
    const editForm = await (await page(`/spectra/${slug}/edit/`, owner)).text();
    expect(editForm).toContain("Save changes");
    const edit = new FormData();
    for (const [k, v] of Object.entries({ title: "Admin carbon", type: "coreloss", formula: "C", beam_energy_choice: "200", convergence: "20", collection: "40", edges: "C_K" })) edit.append(k, v);
    await exports.default.fetch(`${SITE}/spectra/${slug}/edit/`, { method: "POST", redirect: "manual", headers: { Cookie: owner, Origin: SITE }, body: edit });
    const editId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ? AND kind = 'edit'").bind(spectrumId).first<number>("id");
    await form(`/admin/submissions/${editId}/`, mod, { decision: "approve" });
    expect(await env.DB.prepare("SELECT beam_energy_kv FROM eels_acquisition WHERE spectrum_id = ?").bind(spectrumId).first("beam_energy_kv")).toBe(200);
    expect(await (await page(`/spectra/${slug}/history/`)).text()).toContain("edit approved");
  });

  it("rejecting a new submission keeps it unpublished", async () => {
    const owner = await sessionFor({ id: 6300006, display_name: "Rejected Person" });
    const mod = await sessionFor({ id: 6300007, display_name: "Mod Three", role: "admin" });
    const token = await tokenFor(owner);
    const { id: spectrumId, slug } = await (await api("/cli/submissions", token, { method: "POST", body: submission("Spam carbon") })).json<any>();
    const subId = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(spectrumId).first<number>("id");
    await form(`/admin/submissions/${subId}/`, mod, { decision: "reject", notes: "Not a spectrum." });
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(spectrumId).first("status")).toBe("rejected");
    expect((await page(`/spectra/${slug}/`, owner)).status).toBe(404);
  });
});

describe("roles", () => {
  it("only admins change roles, and not their own admin role", async () => {
    const adminCookie = await sessionFor({ id: 6300008, display_name: "The Admin", role: "admin" });
    const modCookie = await sessionFor({ id: 6300009, display_name: "A Mod", role: "moderator" });
    expect((await page("/admin/users/", modCookie)).status).toBe(403);
    expect((await page("/admin/users/", adminCookie)).status).toBe(200);
    await form("/admin/users/6300009/", adminCookie, { role: "user" });
    expect(await env.DB.prepare("SELECT role FROM users WHERE id = 6300009").first("role")).toBe("user");
    expect((await form("/admin/users/6300008/", adminCookie, { role: "user" })).status).toBe(400);
  });
});

describe("bulk export", () => {
  it("is uploaded by admins and offered on the Downloads page", async () => {
    expect(await (await page("/downloads/")).text()).toContain("has not been made yet");
    const adminCookie = await sessionFor({ id: 6300010, display_name: "Export Admin", role: "admin" });
    const modCookie = await sessionFor({ id: 6300011, display_name: "Export Mod", role: "moderator" });
    const zip = new Uint8Array(64).fill(1);
    expect((await api("/cli/exports/eelsdb-spectra.zip", await tokenFor(modCookie), { method: "PUT", body: zip })).status).toBe(403);
    expect((await api("/cli/exports/other.zip", await tokenFor(adminCookie), { method: "PUT", body: zip })).status).toBe(404);
    expect((await api("/cli/exports/eelsdb-spectra.zip", await tokenFor(adminCookie), { method: "PUT", body: zip })).status).toBe(201);
    expect(await (await page("/downloads/")).text()).toContain("Download eelsdb-spectra.zip");
    const file = await page("/exports/eelsdb-spectra.zip");
    expect(file.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(zip);
  });
});
