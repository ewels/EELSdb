import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/api/format";
import { valuesFromBundle } from "../src/submit/edit";
import { parseForm } from "../src/submit/form";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const get = (path: string, cookie?: string) => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
const postForm = (path: string, cookie: string, values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return exports.default.fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: SITE }, body: fd });
};

describe("edit form round trip", () => {
  it("reproduces every migrated spectrum without errors or changes", async () => {
    const { results } = await env.DB.prepare("SELECT id FROM spectra WHERE legacy_v1 IS NOT NULL").all<{ id: number }>();
    const problems: string[] = [];
    for (const { id } of results) {
      const values = valuesFromBundle((await loadBundle(env.DB, id))!);
      const { form, errors } = parseForm(values);
      if (Object.keys(errors).length) problems.push(`${id}: ${JSON.stringify(errors)}`);
      const again = parseForm(valuesFromBundle({ ...(await loadBundle(env.DB, id))! })).form;
      if (JSON.stringify(form) !== JSON.stringify(again)) problems.push(`${id}: not stable`);
    }
    expect(problems).toEqual([]);
  });
});

describe("editing a spectrum", () => {
  const SLUG = "mlc-nanotube-ylas-tas2";

  it("publishes text changes straight away, with history", async () => {
    const owner = await sessionFor({ id: 6200001, display_name: "Simon Hettler" });
    await env.DB.prepare("UPDATE spectra SET owner_id = 6200001 WHERE slug = ?").bind(SLUG).run();
    const form = await get(`/spectra/${SLUG}/edit/`, owner);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain('value="Thermo Fisher Scientific Titan Low-Base"');

    const id = (await env.DB.prepare("SELECT id FROM spectra WHERE slug = ?").bind(SLUG).first<number>("id"))!;
    const values = valuesFromBundle((await loadBundle(env.DB, id))!);
    const res = await postForm(`/spectra/${SLUG}/edit/`, owner, { ...values, description: "Now with a description.", keywords: "nanotube, misfit" });
    expect(res.headers.get("location")).toBe(`/spectra/${SLUG}/`);

    const api = await (await exports.default.fetch(`https://api.eelsdb.eu/spectra/${SLUG}/`)).json<any>();
    expect(api.description).toBe("Now with a description.");
    expect(api.keywords).toEqual(["nanotube", "misfit"]);
    expect(api.beamenergy).toBe("300 kV");
    expect(await (await get(`/spectra/${SLUG}/history/`)).text()).toContain("edited (description, keywords)");
  });

  it("sends changes to the measurement to a moderator", async () => {
    const owner = await sessionFor({ id: 6200001, display_name: "Simon Hettler" });
    const id = (await env.DB.prepare("SELECT id FROM spectra WHERE slug = ?").bind(SLUG).first<number>("id"))!;
    const values = valuesFromBundle((await loadBundle(env.DB, id))!);
    const res = await postForm(`/spectra/${SLUG}/edit/`, owner, { ...values, beam_energy_choice: "200", title: "Renamed" });
    expect(res.headers.get("location")).toBe(`/account/submissions/?edited=${id}`);
    expect(await env.DB.prepare("SELECT beam_energy_kv FROM eels_acquisition WHERE spectrum_id = ?").bind(id).first("beam_energy_kv")).toBe(300);
    expect(await env.DB.prepare("SELECT title FROM spectra WHERE id = ?").bind(id).first("title")).not.toBe("Renamed");
    const sub = await env.DB.prepare("SELECT kind, status, change_json FROM submissions WHERE spectrum_id = ? AND kind = 'edit'").bind(id).first<any>();
    expect(sub.status).toBe("pending");
    expect(JSON.parse(sub.change_json).form.acquisition.beam_energy_kv).toBe(200);
  });

  it("is only for the owner or a moderator", async () => {
    const other = await sessionFor({ id: 6200002, display_name: "Some One" });
    expect((await get(`/spectra/${SLUG}/edit/`, other)).status).toBe(404);
    const mod = await sessionFor({ id: 6200003, display_name: "Mod", role: "moderator" });
    expect((await get(`/spectra/${SLUG}/edit/`, mod)).status).toBe(200);
  });
});
