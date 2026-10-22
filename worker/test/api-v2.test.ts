import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { openapiV2 } from "../src/api/v2";
import { Spectrum, SpectrumPage } from "../src/api/v2-schema";

const get = (path: string) => exports.default.fetch(`https://api.eelsdb.eu/v2${path}`);
const json = async (path: string) => (await get(path)).json<any>();

describe("API v2", () => {
  it("lists with a total and paging links", async () => {
    const page = await json("/spectra?per_page=100");
    expect(page.total).toBe(956);
    expect(page.results).toHaveLength(100);
    expect(page.next).toBe("https://api.eelsdb.eu/v2/spectra?per_page=100&page=2");
    expect(page.previous).toBeNull();
    const last = await json("/spectra?per_page=100&page=10");
    expect(last.results).toHaveLength(56);
    expect(last.next).toBeNull();
  });

  it("filters", async () => {
    const fe = await json("/spectra?element=Fe&element=O&type=coreloss&per_page=500");
    expect(fe.total).toBeGreaterThan(0);
    expect(fe.results.every((s: any) => s.elements.includes("Fe") && s.elements.includes("O"))).toBe(true);
    const covers = await json("/spectra?covers_ev=708&per_page=500");
    expect(covers.results.every((s: any) => s.energy.min_ev <= 708 && s.energy.max_ev >= 708)).toBe(true);
    const edge = await json("/spectra?edge=Fe_L2,3&per_page=500");
    expect(edge.results.every((s: any) => s.edges.some((e: any) => e.element === "Fe" && e.edge === "L2,3"))).toBe(true);
    expect((await json("/spectra?complete=true")).total).toBe(245);
    const sorted = await json("/spectra?sort=min_energy_ev&order=desc&per_page=3");
    expect(sorted.results[0].energy.min_ev).toBeGreaterThanOrEqual(sorted.results[1].energy.min_ev);
  });

  it("reports bad parameters", async () => {
    const unknown = await get("/spectra?per_page=1&foo=1");
    expect(unknown.status).toBe(400);
    expect((await unknown.json<any>()).error.code).toBe("unknown_parameter");
    expect((await get("/spectra?covers_ev=abc")).status).toBe(400);
    expect((await get("/spectra?element=Xx")).status).toBe(400);
    expect((await get("/spectra?sort=nope")).status).toBe(400);
    expect((await get("/nothing")).status).toBe(404);
  });

  it("returns one spectrum by id or slug, with typed values and provenance", async () => {
    const s = await json("/spectra/22236");
    expect(await json("/spectra/mlc-nanotube-ylas-tas2")).toEqual(s);
    expect(s.acquisition.beam_energy).toEqual({ value_kv: 300, source: "user", uncertainty_kv: null });
    expect(s.acquisition.monochromated).toBe(false);
    expect(s.energy).toEqual({ min_ev: 1700, max_ev: 2574, step_ev: 0.5 });
    expect(s.reference).toMatchObject({ doi: "10.1021/acsnano.9b09284", doi_url: "https://doi.org/10.1021/acsnano.9b09284", year: 2020 });
    expect(s.download_url).toBe("https://eelsdb.eu/wp-content/uploads/2023/10/Y20.txt");
    expect(s.associated[0]).toMatchObject({ title: "MLC Nanotube YS-TaS2", type: "coreloss" });
    expect((await get("/spectra/999999")).status).toBe(404);
  });

  it("matches the response schemas", async () => {
    const page = await json("/spectra?per_page=500&phase=solid");
    // parse() throws with the path of any field that the schema does not describe.
    SpectrumPage.parse(page);
    for (const id of [22236, 21751]) Spectrum.parse(await json(`/spectra/${id}`));
  });

  it("serves the OpenAPI file generated from the routes", async () => {
    const res = await exports.default.fetch("https://eelsdb.eu/api/openapi-v2.json");
    const doc = await res.json<any>();
    expect(doc).toEqual(JSON.parse(JSON.stringify(openapiV2())));
    expect(Object.keys(doc.paths)).toEqual(["/spectra", "/spectra/{id}", "/drafts"]);
    const params = doc.paths["/spectra"].get.parameters.map((p: any) => p.name);
    expect(params).toContain("covers_ev");
    expect(doc.components.schemas.Spectrum.properties.acquisition).toBeDefined();
  });

  it("validates parameters with the schema", async () => {
    const bad = await get("/spectra?type=nope");
    expect(bad.status).toBe(400);
    expect((await bad.json<any>()).error.code).toBe("invalid_parameter");
    expect((await json("/spectra?element=Fe&per_page=2")).results).toHaveLength(2);
    expect((await json("/spectra?per_page=9999")).per_page).toBe(500);
    expect((await get("/spectra?element=Fe&element=O&element=Ti&element=C&element=N&element=H&element=S&element=Si&element=Al&element=Mg&element=Ca&element=Na&element=K&element=Cl&element=P&element=B&element=Li&element=Be&element=F&element=Ne&element=Ar")).status).toBe(400);
  });

  it("lists gas-phase spectra with the rest, and filters on phase", async () => {
    expect((await json("/spectra")).total).toBe(956);
    expect((await json("/spectra?phase=gas")).total).toBe(666);
    expect((await json("/spectra?phase=solid")).total).toBe(290);
  });
});
