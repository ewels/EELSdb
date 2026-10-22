import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const get = (path: string, cookie?: string) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
const post = (path: string, cookie: string, body: Record<string, string> = {}) =>
  exports.default.fetch(`${SITE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

const PROFILE = {
  name: "Titan Themis (Test lab)",
  facility: "Test lab",
  voltages: "80, 300",
  cal_kind_0: "convergence", cal_kv_0: "300", cal_mode_0: "STEM", cal_aperture_0: "50 µm", cal_value_0: "21.4", cal_uncertainty_0: "0.5",
  cal_kind_1: "collection", cal_camera_length_1: "29 mm", cal_value_1: "62",
};

describe("instrument profiles", () => {
  it("are created pending, approved by a moderator, and versioned", async () => {
    const staff = await sessionFor({ id: 6100001, display_name: "Facility Staff" });
    const mod = await sessionFor({ id: 6100002, display_name: "Mod Erator", role: "moderator" });
    const visitor = await sessionFor({ id: 6100003, display_name: "Visitor" });

    const created = await post("/instruments/new/", staff, PROFILE);
    expect(created.status).toBe(302);
    const path = created.headers.get("location")!;
    const id = Number(path.split("/")[2]);

    expect((await get(path)).status).toBe(404); // not public until approved
    expect(await (await get(path, staff)).text()).toContain("waiting for a moderator");
    expect((await post(`/instruments/${id}/versions/1/approve/`, visitor)).status).toBe(403);
    expect((await post(`/instruments/${id}/versions/1/approve/`, mod)).status).toBe(302);

    const page = await (await get(path)).text();
    expect(page).toContain("21.4 mrad ± 0.5");
    expect(page).toContain("29 mm");

    // An edit is a new version; the approved one stays current until the edit is approved.
    await post(`/instruments/${id}/edit/`, visitor, { ...PROFILE, cal_value_0: "22" });
    expect(await env.DB.prepare("SELECT current_version FROM instruments WHERE id = ?").bind(id).first("current_version")).toBe(1);
    expect(await (await get(`/instruments/${id}/`)).text()).toContain("21.4 mrad");
    await post(`/instruments/${id}/versions/2/approve/`, mod);
    expect(await (await get(`/instruments/${id}/`)).text()).toContain("22 mrad");
    expect(await (await get(`/instruments/${id}/?version=1`)).text()).toContain("21.4 mrad");

    // The submit form offers the approved profile with its current calibrations.
    const form = await (await get("/submit-data/", visitor)).text();
    expect(form).toContain(`value="${id}:2"`);
    expect(form).toContain("Titan Themis (Test lab)");
  });

  it("validates the profile form", async () => {
    const staff = await sessionFor({ id: 6100004, display_name: "Staff Two" });
    const res = await post("/instruments/new/", staff, { name: "", voltages: "lots", cal_value_0: "abc" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Enter the microscope name.");
    expect(html).toContain("Voltages are numbers");
    expect(html).toContain("Row 1:");
  });
});

describe("completeness", () => {
  it("can be filtered on", async () => {
    const all = await (await get("/spectra/")).text();
    const complete = await (await get("/spectra/?complete=1")).text();
    expect(all).toContain("956 spectra");
    expect(complete).toContain("245 spectra");
  });
});
