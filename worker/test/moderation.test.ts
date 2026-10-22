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
const api = (path: string) => exports.default.fetch(`${API}${path}`);
const post = (path: string, cookie: string, body: FormData) =>
  exports.default.fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: SITE }, body });

/** A submission from the web form; returns the spectrum's id, slug and submission id. */
async function submit(cookie: string, fd: FormData) {
  fd.append("agreement", "1");
  const res = await post("/submit-data/", cookie, fd);
  const id = Number(new URL(res.headers.get("location")!, SITE).searchParams.get("submitted"));
  const spectrum = await env.DB.prepare("SELECT slug FROM spectra WHERE id = ?").bind(id).first<string>("slug");
  const sub = await env.DB.prepare("SELECT id FROM submissions WHERE spectrum_id = ?").bind(id).first<number>("id");
  return { id, slug: spectrum!, subId: sub! };
}

/** What public/review.js sends after reprocessing in the moderator's browser. */
function processed(record: object, files: Record<string, File> = {}) {
  const fd = new FormData();
  fd.append("record", JSON.stringify(record));
  for (const [role, f] of Object.entries(files)) fd.append(role, f);
  return fd;
}

function submission(title: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ title, type: "coreloss", formula: "C", beam_energy_choice: "300", convergence: "20", collection: "40", edges: "C_K" })) fd.append(k, v);
  fd.append("file", new File([MSA], "c.msa"));
  return fd;
}

describe("review", () => {
  it("runs from submission through review in the browser to publication", async () => {
    const submitterCookie = await sessionFor({ id: 6300002, display_name: "Web Submitter" });
    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject, email, email_verified) VALUES (6300002, 'github', 'web-1', 'web@lab.org', 1)").run();
    const modCookie = await sessionFor({ id: 6300003, display_name: "Mod Reviewer", role: "moderator" });
    const { id: spectrumId, slug, subId } = await submit(submitterCookie, submission("Web carbon"));

    // Not public yet, but the submitter can preview it.
    expect((await page(`/spectra/${slug}/`)).status).toBe(404);
    expect(await (await page(`/spectra/${slug}/`, submitterCookie)).text()).toContain("Not published yet");

    const review = await (await page(`/admin/submissions/${subId}/`, modCookie)).text();
    const input = JSON.parse(review.match(/<script type="application\/json" id="review-input">(.*?)<\/script>/s)![1]);
    expect(input).toMatchObject({ spectrum: { slug, type: "coreloss" }, acquisition: { beam_energy_kv: 300 }, edges: ["C_K"], file: { role: "original" } });
    expect(review).toContain(`data-file="/admin/submissions/${subId}/files/original/"`);
    expect(await (await page(`/admin/submissions/${subId}/files/original/`, modCookie)).text()).toBe(MSA);

    const record = { tools: [{ tool: "rosettasciio", version: "0.15.0" }], warnings: [], values: { min_energy_ev: 280, max_energy_ev: 280.2, step_ev: 0.1 } };
    expect((await post(`/admin/submissions/${subId}/processed/`, submitterCookie, processed(record))).status).toBe(403);
    expect((await post(`/admin/submissions/${subId}/processed/`, modCookie, processed({}))).status).toBe(400);
    const done = await post(`/admin/submissions/${subId}/processed/`, modCookie, processed(record, { msa: new File([MSA], "web-carbon.msa") }));
    expect(done.status).toBe(200);
    const before = sent.length;
    expect((await form(`/admin/submissions/${subId}/`, modCookie, { decision: "approve" })).status).toBe(302);
    expect(sent.slice(before).map((e) => e.to)).toEqual(["web@lab.org"]);
    expect((await form(`/admin/submissions/${subId}/`, modCookie, { decision: "approve" })).status).toBe(409);
    expect((await post(`/admin/submissions/${subId}/processed/`, modCookie, processed(record))).status).toBe(409);

    const v1 = await (await api(`/spectra/${slug}/`)).json<any>();
    expect(v1.download_link).toBe(`${SITE}/files/${spectrumId}/s${subId}/web-carbon.msa`);
    expect(v1.min_energy).toBe("280 eV");
    expect(v1.beamenergy).toBe("300 kV");
    expect(await (await page(`/files/${spectrumId}/s${subId}/web-carbon.msa`)).text()).toBe(MSA);
    expect(await env.DB.prepare("SELECT tool FROM processing WHERE spectrum_id = ?").bind(spectrumId).first("tool")).toBe("rosettasciio");
  });

  it("keeps processed versions and the file's metadata", async () => {
    const submitter = await sessionFor({ id: 6300020, display_name: "Variant Submitter" });
    const mod = await sessionFor({ id: 6300021, display_name: "Variant Mod", role: "moderator" });
    const fd = submission("Gas NO");
    fd.append("variant_os_file", new File([MSA], "no-os.msa"));
    fd.append("variant_smoothed_file", new File([MSA], "no-smoothed.msa"));
    const { id: spectrumId, slug, subId } = await submit(submitter, fd);
    const metadata = new File([JSON.stringify({ ImageList: { Voltage: 200000 } })], "gas-no.metadata.json");
    await post(`/admin/submissions/${subId}/processed/`, mod, processed({ tools: [{ tool: "rosettasciio", version: "0.15.0" }] }, { metadata }));
    await form(`/admin/submissions/${subId}/`, mod, { decision: "approve" });

    const v2 = await (await api(`/v2/spectra/${spectrumId}`)).json<any>();
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
    const history = await (await page(`/spectra/${slug}/history/`)).text();
    expect(history).toContain("edit approved");
    expect(history).toContain("published");
    expect(history).not.toContain("new approved");
    expect(history.indexOf("edit approved")).toBeLessThan(history.indexOf(">published<"));
  });

  it("rejecting a new submission keeps it unpublished", async () => {
    const owner = await sessionFor({ id: 6300006, display_name: "Rejected Person" });
    const mod = await sessionFor({ id: 6300007, display_name: "Mod Three", role: "admin" });
    const { id: spectrumId, slug, subId } = await submit(owner, submission("Spam carbon"));
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
    zip.set([0x50, 0x4b, 3, 4]);
    const upload = (cookie: string, bytes: Uint8Array) => {
      const fd = new FormData();
      fd.append("file", new File([bytes], "eelsdb-spectra.zip"));
      return post("/admin/exports/", cookie, fd);
    };
    expect(await (await page("/admin/", adminCookie)).text()).toContain('action="/admin/exports/"');
    expect(await (await page("/admin/", modCookie)).text()).not.toContain('action="/admin/exports/"');
    expect((await upload(modCookie, zip)).status).toBe(403);
    expect((await upload(adminCookie, new Uint8Array(64))).status).toBe(400);
    expect((await upload(adminCookie, zip)).headers.get("location")).toBe("/downloads/");
    expect(await (await page("/downloads/")).text()).toContain("Download eelsdb-spectra.zip");
    const file = await page("/exports/eelsdb-spectra.zip");
    expect(file.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(zip);
  });
});
