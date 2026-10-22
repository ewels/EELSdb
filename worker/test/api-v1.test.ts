import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const get = (path: string, init?: RequestInit) => exports.default.fetch(`https://api.eelsdb.eu${path}`, init);
const getJson = async (path: string) => (await get(path)).json<any>();

describe("API v1 deliberate changes", () => {
  it("monochromated=0 returns only non-monochromated spectra", async () => {
    const body = await getJson("/spectra?monochromated=0&per_page=-1");
    expect(body.length).toBeGreaterThan(0);
    expect(new Set(body.map((s: any) => s.monochromated))).toEqual(new Set(["No"]));
  });

  it("matches whole edge names", async () => {
    const k = await getJson("/spectra/?edge=K&per_page=-1");
    expect(k.every((s: any) => s.edges.some((e: string) => e.endsWith("_K")))).toBe(true);
    expect(await getJson("/spectra/?edge=L2&per_page=-1")).toEqual([]);
    const l23 = await getJson("/spectra/?edge=L2,3&per_page=-1");
    expect(l23.every((s: any) => s.edges.some((e: string) => e.endsWith("_L2,3")))).toBe(true);
  });

  it("matches authors by name or profile slug, and returns nothing for an unknown author", async () => {
    expect((await getJson("/spectra/?author=Hettler&per_page=-1")).length).toBe(3);
    expect((await getJson("/spectra/?author=simon&per_page=-1")).length).toBe(3);
    expect(await getJson("/spectra/?author=nobody-at-all&per_page=-1")).toEqual([]);
  });

  it("sends CORS headers and accepts any User-Agent", async () => {
    const res = await get("/spectra/?per_page=1", { headers: { "User-Agent": "python-requests/2.32" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await get("/nope/")).headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("lists gas-phase spectra only when asked for", async () => {
    await env.DB.prepare(
      "INSERT INTO spectra (id, slug, status, title, type, phase, formula, author_display, author_slug) VALUES (8800002, 'gas-n2', 'published', 'N2 gas', 'coreloss', 'gas', 'N2', 'Corex', 'corex')",
    ).run();
    expect((await getJson("/spectra/?formula=N2&per_page=-1")).map((s: any) => s.id)).not.toContain(8800002);
    const gas = await getJson("/spectra/?phase=gas&formula=N2&per_page=-1");
    expect(gas.map((s: any) => s.id)).toContain(8800002);
    expect(gas.every((s: any) => s.id >= 30001)).toBe(true);
  });

  it("serves the route index at the root", async () => {
    const body = await getJson("/");
    expect(body.browse_spectra.arguments.order).toContain("spectrumFormula");
  });
});

describe("API v1 never shows unpublished spectra", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      "INSERT INTO spectra (id, slug, status, title, type, formula, author_display, author_slug) VALUES (1, 'secret', 'private', 'Secret', 'coreloss', 'Xx', 'Someone', 'someone')",
    ).run();
  });

  it("in lists, single objects or contributors", async () => {
    const all = await getJson("/spectra/?per_page=-1");
    expect(all.find((s: any) => s.id === 1)).toBeUndefined();
    expect((await get("/spectra/secret/")).status).toBe(404);
    expect((await get("/author/someone/")).status).toBe(404);
  });
});

describe("API v1 formats new spectra", () => {
  beforeAll(async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO spectra (id, slug, status, title, type, formula, description, min_energy_ev, max_energy_ev, step_ev,
           author_display, author_slug, published_at)
         VALUES (900001, 'new-bn', 'published', 'BN - new', 'coreloss', 'BN', 'A test', 180.123, 420, 0.1, 'Test Person', 'test', '2026-10-20 10:00:00')`,
      ),
      env.DB.prepare("INSERT INTO spectrum_elements VALUES (900001, 'B', 0), (900001, 'N', 1)"),
      env.DB.prepare("INSERT INTO spectrum_edges VALUES (900001, 'B', 'K', 0)"),
      env.DB.prepare("INSERT INTO eels_acquisition (spectrum_id, microscope, beam_energy_kv, convergence_mrad, monochromated) VALUES (900001, 'Titan', 300, 21.5, 1)"),
      env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename) VALUES (900001, 'original', 'spectra/900001/bn.msa', 'bn.msa')"),
    ]);
  });

  it("with the v1 field formats", async () => {
    expect(await getJson("/spectra/new-bn/")).toEqual({
      id: 900001,
      title: "BN &#8211; new",
      permalink: "https://eelsdb.eu/spectra/new-bn/",
      author: { name: "Test Person", profile_url: "https://eelsdb.eu/author/test/", profile_api_url: "https://api.eelsdb.eu/author/test/" },
      published: "2026-10-20 10:00:00",
      description: "A test",
      comment_count: 0,
      api_permalink: "https://api.eelsdb.eu/spectra/new-bn/",
      download_link: "https://eelsdb.eu/spectra/900001/bn.msa",
      type: "Core Loss",
      formula: "BN",
      elements: ["B", "N"],
      microscope: "Titan",
      max_energy: "420 eV",
      min_energy: "180.12 eV",
      edges: ["B_K"],
      beamenergy: "300 kV",
      monochromated: "Yes",
      stepSize: "0.1 eV/pixel",
      convergence: "21.5 mrad",
    });
  });
});

describe("API v1 users", () => {
  it("lists contributors without personal fields", async () => {
    const users = await getJson("/registered-users/");
    expect(users.length).toBeGreaterThan(20);
    const keys = new Set(users.flatMap((u: any) => Object.keys(u)));
    for (const k of ["email", "laboratory", "city", "country", "skype", "twitter", "linkedin", "facebook"]) {
      expect(keys.has(k)).toBe(false);
    }
    const published = await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE status = 'published' AND phase != 'gas'").first("n");
    expect(users.reduce((n: number, u: any) => n + u.num_spectra, 0)).toBe(published);
  });

  it("returns one contributor, or 404", async () => {
    const u = await getJson("/author/simon/");
    expect(u).toMatchObject({ name: "Simon Hettler", num_spectra: 3, spectra_api_url: "https://api.eelsdb.eu/spectra/?author=simon" });
    expect((await get("/author/not-a-user/")).status).toBe(404);
  });
});

describe("legacy download URLs", () => {
  it("are served from R2 with a content type", async () => {
    await env.FILES.put("wp-content/uploads/2015/09/test.msa", "#FORMAT : EMSA/MAS Spectral Data File\n");
    const res = await exports.default.fetch("https://eelsdb.eu/wp-content/uploads/2015/09/test.msa");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toContain("EMSA");
    expect((await exports.default.fetch("https://eelsdb.eu/wp-content/uploads/nope.msa")).status).toBe(404);
  });
});
