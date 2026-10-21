import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

const page = async (path: string) => {
  const res = await exports.default.fetch(`https://eelsdb.eu${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text(), res };
};
const rows = (html: string) => (html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g) ?? []).length;

describe("pages", () => {
  it("about, citation and logo pages, and the old addresses", async () => {
    const { status, html } = await page("/about/");
    expect(status).toBe(200);
    expect(html).toContain("<title>About EELSdb · EELS Data Base</title>");
    expect(html).toContain("<h1>About EELSdb</h1>");
    for (const id of ["share", "licence", "support", "contact"]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('id="cite"');
    expect(html).not.toContain("@article{");
    expect(html).toContain('"#cite":"/citation/","#logo":"/logo/"');

    const cite = await page("/citation/");
    expect(cite.status).toBe(200);
    expect(cite.html).toContain("<h1>How to cite</h1>");
    expect(cite.html).toContain("@article{");
    expect(cite.html).toContain("Copy BibTeX");

    const logo = await page("/logo/");
    expect(logo.status).toBe(200);
    expect(logo.html).toContain("<h1>Logo and colours</h1>");
    for (const base of ["eelsdb-logo", "eelsdb-logo-compact"])
      for (const v of ["light-bg", "dark-bg", "black", "white"])
        for (const ext of ["svg", "png"]) expect(logo.html).toContain(`href="/logo/${base}-${v}.${ext}"`);
    expect(logo.html).toContain('href="/logo/eelsdb-mark.png"');
    expect(logo.html).toContain('data-copy="#a21e16"');
    expect(logo.html).toContain('href="/citation/"');
    for (const path of ["/logo", "/brand/", "/brand"]) {
      const r = await page(path);
      expect(r.status).toBe(301);
      expect(r.res.headers.get("location")).toBe("/logo/");
    }
  });

  it("moderators page lists moderators and admins without private details", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, display_name, role, slug, profile_public) VALUES (6400001, 'Public Mod', 'moderator', 'public-mod', 1)"),
      env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (6400001, 'public-mod@example.org', 1, 1)"),
      env.DB.prepare("INSERT INTO users (id, display_name, role, profile_public) VALUES (6400002, 'Quiet Admin', 'admin', 0)"),
      env.DB.prepare("INSERT INTO users (id, display_name, role, slug, profile_public) VALUES (6400003, 'Plain User', 'user', 'plain-user', 1)"),
    ]);
    const { status, html } = await page("/moderators/");
    expect(status).toBe(200);
    expect(html).toContain('href="/contact/"');
    expect(html).toMatch(/<a class="by" href="\/author\/public-mod\/">[\s\S]*?Public Mod<\/span><\/a><span class="muted">Moderator</);
    expect(html).toMatch(/<span class="by">[\s\S]*?Quiet Admin<\/span><\/span><span class="muted">Administrator</);
    expect(html).toContain("gravatar.com/avatar/");
    expect(html).not.toContain("Plain User");
    expect(html).not.toContain("example.org");
  });

  it("header has a burger button that controls the menu panel", async () => {
    const { html } = await page("/about/");
    const button = html.match(/<button class="menu-toggle"[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    const id = button.match(/aria-controls="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div class="menu" id="${id}">[\\s\\S]*?class="nav-search"[\\s\\S]*?class="theme-toggle wide"[\\s\\S]*?href="/about/"[\\s\\S]*?Sign in[\\s\\S]*?class="theme-toggle narrow"`));
  });

  it("About is a disclosure menu, marked current on each of its pages", async () => {
    for (const path of ["/about/", "/citation/", "/moderators/", "/logo/", "/contact/"]) {
      const { html } = await page(path);
      const button = html.match(/<button[^>]*class="drop-toggle[^"]*"[^>]*>/)?.[0] ?? "";
      expect(button, path).toContain("current");
      expect(button).toContain('aria-expanded="false"');
      const id = button.match(/aria-controls="([^"]+)"/)?.[1];
      expect(html).toMatch(new RegExp(`<ul class="drop-panel" id="${id}">(<li><a href="[^"]+"[^>]*>[^<]+</a></li>){5}</ul>`));
      expect(html).toContain(`<li><a href="${path}" aria-current="page">`);
    }
    const browse = (await page("/spectra/")).html;
    expect(browse).toMatch(/<button[^>]*class="drop-toggle"/);
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
    expect(lowloss.html).toContain('<select id="f-element" name="element[]" multiple=""');
    expect(lowloss.html).toMatch(/<option value="Al" selected="" data-name="Aluminium" data-count="\d+">Al · Aluminium \(\d+\)<\/option>/);
    expect(lowloss.html).toMatch(/<option value="O" data-name="Oxygen"/);

    const count = async (q: string) => Number((await page(`/spectra/?${q}`)).html.match(/role="status">(\d+) spectr/)?.[1]);
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

  it("browse rows lead with a thumbnail built from the spectrum file", async () => {
    const { id, key } = (await env.DB.prepare(
      "SELECT s.id, f.r2_key AS key FROM spectra s JOIN files f ON f.spectrum_id = s.id WHERE s.slug = 'graphite' LIMIT 1",
    ).first<{ id: number; key: string }>())!;
    await env.FILES.put(key, Array.from({ length: 400 }, (_, i) => `${270 + i * 0.5}\t${i < 30 ? 10 : 100 - i / 10}`).join("\n"));
    const { html } = await page("/spectra/?title=graphite");
    expect(html).toMatch(/<a href="\/spectra\/graphite\/" tabindex="-1" aria-hidden="true"><svg class="spark"[^>]*><line class="edge"/);
    expect(html).toContain('<span class="edge-chip">C\u00a0K</span>');
    expect(html).toMatch(/<span class="conditions">\d+ kV<\/span>/);
    await vi.waitFor(async () => expect(await env.DB.prepare("SELECT preview_key FROM spectra WHERE id = ?").bind(id).first("preview_key")).toBe(key));
  });

  it("browse keeps the author and energy fields filled from the URL", async () => {
    const { html } = await page("/spectra/?author=Sigle&min_energy=400&max_energy=800&max_energy_compare=gt&resolution=1&resolution_compare=eq");
    expect(html).toContain('<input type="text" id="f-author" name="author" value="Sigle" list="f-author-list"');
    expect(html).toMatch(/<datalist id="f-author-list"><option value="[^"]+" data-count="\d+" label="\d+ spectra">/);
    expect(html).toMatch(/<option value="Wilfried Sigle" data-count="(\d+)"/);
    for (const [name, value, compare] of [["min_energy", "400", "gt"], ["max_energy", "800", "gt"], ["resolution", "1", "eq"]]) {
      expect(html).toContain(`name="${name}" value="${value}"`);
      expect(html).toMatch(new RegExp(`name="${name}_compare"[^>]*>(<option[^>]*>[^<]*</option>)*?<option value="${compare}" selected=""`));
    }
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
    for (const path of ["/about/", "/contact/"]) expect((await page(path)).status).toBe(200);
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
