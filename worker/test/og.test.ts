import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { spectrumCard, ticks, wrap } from "../src/og/cards";

const get = (path: string) => exports.default.fetch(`https://eelsdb.eu${path}`);
const PNG = [0x89, 0x50, 0x4e, 0x47];

describe("share cards", () => {
  it("draws a 1200×630 PNG for a published spectrum", async () => {
    const res = await get("/og/spectra/ti-ferrite-spinel.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(PNG);
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
  });

  it("draws cards for the site, fixed pages, authors, news and docs", async () => {
    for (const path of ["/og/site.png", "/og/page/browse.png", "/og/author/magnus.png", "/og/news/the-eels-database-recognized-by-re3data-as-open-access.png"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe("image/png");
    }
  });

  it("has no card for unknown or unpublished things, or paths outside the docs", async () => {
    for (const path of ["/og/spectra/no-such-spectrum.png", "/og/page/admin.png", "/og/author/no-such-person.png", "/og/news/nope.png", "/og/docs/../style.png"]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("pages point og:image at their own card", async () => {
    const meta = async (path: string) => (await (await get(path)).text()).match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    expect(await meta("/spectra/ti-ferrite-spinel/")).toBe("https://eelsdb.eu/og/spectra/ti-ferrite-spinel.png");
    expect(await meta("/author/magnus/")).toBe("https://eelsdb.eu/og/author/magnus.png");
    expect(await meta("/spectra/")).toBe("https://eelsdb.eu/og/page/browse.png");
    expect(await meta("/")).toBe("https://eelsdb.eu/og/site.png");
  });

  it("labels every major edge in range, lowest energy first", () => {
    const x = Array.from({ length: 200 }, (_, i) => 420 + i);
    const svg = spectrumCard({ title: "Ti-ferrite", formula: "Fe2TiO5", type: "coreloss", author: null, year: null, slug: "t", elements: ["O", "Fe", "Ti"], data: [x, x.map(() => 1)] });
    expect(svg.indexOf(">Ti L<")).toBeGreaterThan(0);
    expect(svg.indexOf(">Ti L<")).toBeLessThan(svg.indexOf(">O K<"));
  });

  it("wraps and truncates text to the width given", () => {
    expect(wrap("short", 40, 700, 1000, 2)).toEqual(["short"]);
    const lines = wrap("La0.7Sr0.3MnO3/SrTiO3-(001) heterostructure, brown millerite oxygen vacancies", 64, 700, 1072, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(ticks(424, 579)).toEqual([450, 500, 550]);
  });
});
