import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_DRAFTS_PER_HOUR, deleteOldDrafts } from "../src/submit/drafts";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const API = "https://api.eelsdb.eu";
const MSA = "#FORMAT : EMSA/MAS Spectral Data File\n#SPECTRUM : x\n280.0, 1\n280.1, 2\n280.2, 3\n";
const page = (path: string, cookie?: string) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
const post = (path: string, cookie: string, body: Record<string, string | string[]>) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) params.append(k, x);
  return exports.default.fetch(`${SITE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
};
const createDraft = (token: string | null, fields: Record<string, string>, file: File | null = new File([MSA], "carbon.msa")) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", file);
  return exports.default.fetch(`${API}/v2/drafts`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
};

async function tokenFor(cookie: string) {
  const html = await (await post("/account/settings/tokens/", cookie, { label: "laptop" })).text();
  return html.match(/eelsdb_draft_[0-9a-f]{48}/)![0];
}

describe("drafts", () => {
  it("are made with a drafts token and stay private until the owner submits them", async () => {
    const owner = await sessionFor({ id: 6500001, display_name: "Draft Owner" });
    const other = await sessionFor({ id: 6500002, display_name: "Someone Else" });
    const mod = await sessionFor({ id: 6500003, display_name: "Draft Mod", role: "moderator" });
    const token = await tokenFor(owner);

    expect((await createDraft(null, { type: "coreloss", formula: "C" })).status).toBe(401);
    expect((await createDraft("eelsdb_draft_nope", { type: "coreloss", formula: "C" })).status).toBe(401);
    const bad = await createDraft(token, { type: "coreloss", edges: "C K-edge" }, null);
    expect(bad.status).toBe(400);
    expect((await bad.json<any>()).error.fields).toMatchObject({ formula: expect.any(String), file: expect.any(String), edges: expect.any(String) });

    const res = await createDraft(token, { type: "coreloss", formula: "C", edges: "C_K", beam_energy: "200", beam_energy_source: "file" });
    expect(res.status).toBe(201);
    const draft = await res.json<any>();
    expect(draft).toEqual({ id: expect.any(Number), slug: "carbon", status: "draft", review_url: `${SITE}/spectra/carbon/edit/` });
    const acq = await env.DB.prepare("SELECT * FROM eels_acquisition WHERE spectrum_id = ?").bind(draft.id).first<any>();
    expect(acq).toMatchObject({ beam_energy_kv: 200, beam_energy_source: "file", convergence_source: "unknown", collection_source: "unknown" });

    // Nobody else sees it: not the public, not other users, not the moderators' queue.
    expect((await exports.default.fetch(`${API}/v2/spectra/carbon`)).status).toBe(404);
    expect((await page("/spectra/carbon/", owner)).status).toBe(404);
    expect((await page("/spectra/carbon/edit/", other)).status).toBe(404);
    expect((await page("/spectra/carbon/edit/", mod)).status).toBe(404);
    expect(await (await page("/admin/", mod)).text()).not.toContain(">carbon<");
    expect(await (await page("/account/drafts/", other)).text()).not.toContain("carbon.msa");

    const list = await (await page("/account/drafts/", owner)).text();
    expect(list).toContain("carbon.msa");
    expect(list).toContain("200 kV (from the file)");
    const check = await (await page("/spectra/carbon/edit/", owner)).text();
    expect(check).toContain("<h1>Check carbon</h1>");
    expect(check).toContain('name="agreement"');

    // Submitting from the check page needs the licence agreement, then joins the queue.
    const fields = { title: "carbon", type: "coreloss", formula: "C", edges: "C_K", beam_energy_choice: "200", convergence_unknown: "1", collection: "30" };
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const form = (body: FormData) => exports.default.fetch(`${SITE}/spectra/carbon/edit/`, { method: "POST", redirect: "manual", headers: { Cookie: owner, Origin: SITE }, body });
    expect((await form(fd)).status).toBe(422);
    fd.append("agreement", "1");
    expect((await form(fd)).headers.get("location")).toBe(`/account/submissions/?submitted=${draft.id}`);
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(draft.id).first("status")).toBe("pending");
    expect(await env.DB.prepare("SELECT collection_mrad FROM eels_acquisition WHERE spectrum_id = ?").bind(draft.id).first("collection_mrad")).toBe(30);
    expect(await (await page("/admin/", mod)).text()).toContain(">carbon<");
  });

  it("can be submitted or deleted several at a time", async () => {
    const owner = await sessionFor({ id: 6500004, display_name: "Bulk Owner" });
    const token = await tokenFor(owner);
    const ids: number[] = [];
    for (const title of ["Bulk one", "Bulk two", "Bulk three"]) {
      ids.push((await (await createDraft(token, { title, type: "lowloss", formula: "BN" })).json<any>()).id);
    }
    const keys = (await env.DB.prepare(`SELECT r2_key FROM files WHERE spectrum_id = ?`).bind(ids[2]).all<any>()).results.map((r) => r.r2_key);

    expect(await (await post("/account/drafts/", owner, { action: "submit", id: [String(ids[0]), String(ids[1])] })).text()).toContain("agree to the licence");
    const sent = await post("/account/drafts/", owner, { action: "submit", agreement: "1", id: [String(ids[0]), String(ids[1])] });
    expect(sent.headers.get("location")).toBe("/account/submissions/?submitted=2");
    const statuses = await env.DB.prepare(`SELECT status FROM spectra WHERE id IN (${ids.join(",")}) ORDER BY id`).all<any>();
    expect(statuses.results.map((r) => r.status)).toEqual(["pending", "pending", "draft"]);

    // Another user cannot delete or submit them.
    const stranger = await sessionFor({ id: 6500005, display_name: "Stranger" });
    await post("/account/drafts/", stranger, { action: "delete", id: String(ids[2]) });
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(ids[2]).first("status")).toBe("draft");

    await post("/account/drafts/", owner, { action: "delete", id: String(ids[2]) });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE id = ?").bind(ids[2]).first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM eels_acquisition WHERE spectrum_id = ?").bind(ids[2]).first("n")).toBe(0);
    expect(await env.FILES.get(keys[0])).toBeNull();
    // Deleting only ever touches drafts.
    await post("/account/drafts/", owner, { action: "delete", id: String(ids[0]) });
    expect(await env.DB.prepare("SELECT status FROM spectra WHERE id = ?").bind(ids[0]).first("status")).toBe("pending");
  });

  it("are deleted after 30 days, and limited per hour", async () => {
    const owner = await sessionFor({ id: 6500006, display_name: "Old Drafts" });
    const token = await tokenFor(owner);
    const old = (await (await createDraft(token, { title: "Old draft", type: "coreloss", formula: "C" })).json<any>()).id;
    const fresh = (await (await createDraft(token, { title: "Fresh draft", type: "coreloss", formula: "C" })).json<any>()).id;
    await env.DB.prepare("UPDATE spectra SET created_at = datetime('now', '-31 days') WHERE id = ?").bind(old).run();
    await deleteOldDrafts(env);
    expect(await env.DB.prepare(`SELECT id FROM spectra WHERE id IN (${old}, ${fresh})`).all<any>().then((r) => r.results.map((x) => x.id))).toEqual([fresh]);

    await env.DB.batch(Array.from({ length: MAX_DRAFTS_PER_HOUR }, () => env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('draft', '6500006')")));
    const limited = await createDraft(token, { title: "One too many", type: "coreloss", formula: "C" });
    expect(limited.status).toBe(429);

    await post(`/account/settings/tokens/${await env.DB.prepare("SELECT id FROM draft_tokens WHERE user_id = 6500006").first("id")}/revoke/`, owner, {});
    expect((await createDraft(token, { title: "Revoked", type: "coreloss", formula: "C" })).status).toBe(401);
  });

  it("are documented in the API v2 OpenAPI file", async () => {
    const doc = await (await exports.default.fetch(`${SITE}/api/openapi-v2.json`)).json<any>();
    expect(doc.paths["/drafts"].post.operationId).toBe("createDraft");
    expect(doc.components.securitySchemes.apiToken).toMatchObject({ type: "http", scheme: "bearer" });
  });
});
