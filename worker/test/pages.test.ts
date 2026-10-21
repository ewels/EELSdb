import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const page = async (path: string) => {
  const res = await exports.default.fetch(`https://eelsdb.eu${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text(), res };
};
const rows = (html: string) => (html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g) ?? []).length;

describe("pages", () => {
  it("logo page links to every download, and /brand/ redirects to it", async () => {
    const { status, html } = await page("/logo/");
    expect(status).toBe(200);
    for (const base of ["eelsdb-logo", "eelsdb-logo-compact"])
      for (const v of ["light-bg", "dark-bg", "black", "white"])
        for (const ext of ["svg", "png"]) expect(html).toContain(`href="/logo/${base}-${v}.${ext}"`);
    expect(html).toContain('href="/logo/eelsdb-mark.png"');
    expect(html).toContain('data-copy="#a21e16"');
    expect(html).toContain('href="/citation/"');
    expect((await page("/brand/")).res.headers.get("location")).toBe("/logo/");
  });

  it("header has a burger button that controls the menu panel", async () => {
    const { html } = await page("/about/");
    const button = html.match(/<button class="menu-toggle"[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    const id = button.match(/aria-controls="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div class="menu" id="${id}">[\\s\\S]*?class="nav-search"[\\s\\S]*?href="/about/"`));
  });

  it("home shows live counts", async () => {
    const { status, html } = await page("/");
    expect(status).toBe(200);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<span class="tl">Core loss</span><span class="tn">188</span>');
    expect(html).toContain("290 spectra from 41 microscopists, shared since 2005.");
    expect(html).toContain('aria-label="Oxygen: 171 spectra"');
  });

  it("browse filters, sorts and pages through the query string", async () => {
    const all = await page("/spectra/");
    expect(all.html).toContain("290 spectra");
    expect(rows(all.html)).toBe(50);
    expect(all.html).toContain('href="/spectra/?page=2"');

    const lowloss = await page("/spectra/?type=lowloss&element[]=Al");
    expect(lowloss.html).toMatch(/\d+ spectra|1 spectrum/);
    expect(lowloss.html).toContain('<input type="checkbox" name="element[]" value="Al" checked=""/>');

    const count = async (q: string) => Number((await page(`/spectra/?${q}`)).html.match(/(\d+) spectr/)?.[1]);
    const oLow = await count("element[]=O&type=lowloss");
    const oXas = await count("element[]=O&type[]=xrayabs");
    expect(oLow).toBeGreaterThan(0);
    expect(oXas).toBeGreaterThan(0);
    const both = await page("/spectra/?element[]=O&type[]=lowloss&type[]=xrayabs");
    expect(both.html).toContain(`${oLow + oXas} spectra`);
    expect(both.html).toContain('name="type[]" value="lowloss" checked=""');
    expect(both.html).toContain('name="type[]" value="xrayabs" checked=""');
    expect(both.html).not.toContain('name="type[]" value="coreloss" checked=""');
    expect(lowloss.html).toContain('name="type[]" value="lowloss" checked=""');

    const sorted = await page("/spectra/?order=title&order_direction=DESC");
    expect(sorted.html).toContain('aria-sort="descending"');

    const none = await page("/spectra/?formula=NoSuchFormula");
    expect(none.html).toContain("No spectra match these filters");
  });

  it("browse compares energies exactly, unlike API v1", async () => {
    const { html } = await page("/spectra/?resolution=0.5&resolution_compare=lt");
    expect(html).toContain(">0.3 eV<");
    expect(html).not.toContain(">0.9 eV<");
  });

  it("spectrum page has the plot, metadata and a citation-first download", async () => {
    const { status, html } = await page("/spectra/mlc-nanotube-ylas-tas2/");
    expect(status).toBe(200);
    expect(html).toContain('data-src="/wp-content/uploads/2023/10/Y20.txt"');
    expect(html).toContain("Thermo Fisher Scientific Titan Low-Base");
    expect(html).toContain('<dialog id="download-dialog"');
    expect(html).toContain("10.1017/S1431927616000179");
    expect(html).toContain("@misc{");
    expect(html).toContain('href="/spectra/mlc-nanotube-ys-tas2/"');
  });

  it("spectrum pages work for non-ASCII slugs and redirect without the slash", async () => {
    expect((await page("/spectra/%ce%b1-moo3/")).status).toBe(200);
    const r = await page("/spectra/mlc-nanotube-ylas-tas2");
    expect(r.status).toBe(301);
    expect((await page("/spectra/not-a-spectrum/")).status).toBe(404);
  });

  it("contributor, news and info pages", async () => {
    expect((await page("/author/simon/")).html).toContain("3 spectra");
    expect((await page("/author/nobody/")).status).toBe(404);
    const news = (await page("/news/")).html;
    expect(news).toContain('href="/hyperspy/"');
    expect(news).not.toMatch(/&amp;(#\d+|hellip);/);
    const post = await page("/hyperspy/");
    expect(post.status).toBe(200);
    expect(post.html).toContain('<a href="http://hyperspy.org/hyperspy-doc/current/api/hyperspy.misc.eels.eelsdb.html">');
    for (const path of ["/about/", "/citation/", "/contact/"]) expect((await page(path)).status).toBe(200);
    expect((await page("/submit-data/")).res.headers.get("location")).toBe("/login/?next=%2Fsubmit-data%2F");
    const api = await page("/api/");
    expect(api.html).toContain("min_energy_compare");
    expect((await page("/api/openapi-v1.json")).res.headers.get("content-type")).toContain("application/json");
  });

  it("closed sections return 410", async () => {
    for (const path of ["/forum/", "/forum/topic/x/", "/jobs/", "/registered-users/"]) {
      expect((await page(path)).status, path).toBe(410);
    }
  });
});
