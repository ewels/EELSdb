import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { htmlToMarkdown } from "../src/pages/markdown";
import { sessionFor } from "./helpers/session";

const page = async (path: string) => {
  const res = await exports.default.fetch(`https://eelsdb.eu${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text(), res };
};
const rows = (html: string) => (html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g) ?? []).length;

describe("pages", () => {
  it("old addresses of pages on the docs site redirect there", async () => {
    const moved: Record<string, string> = {
      "/about/": "/docs/about/",
      "/citation/": "/docs/about/citation/",
      "/contact/": "/docs/about/contact/",
      "/logo/": "/docs/about/logo/",
      "/logo": "/docs/about/logo/",
      "/brand/": "/docs/about/logo/",
      "/api/": "/docs/api/v1/",
      "/api/v2/": "/docs/api/v2/",
    };
    for (const [from, to] of Object.entries(moved)) {
      const r = await page(from);
      expect(r.status, from).toBe(301);
      expect(r.res.headers.get("location")).toBe(to);
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
    expect(html).toContain('href="/docs/about/contact/"');
    expect(html).toMatch(/<a class="by" href="\/author\/public-mod\/">[\s\S]*?Public Mod<\/span><\/a><span class="muted">Moderator</);
    expect(html).toMatch(/<span class="by">[\s\S]*?Quiet Admin<\/span><\/span><span class="muted">Administrator</);
    expect(html).toContain("gravatar.com/avatar/");
    expect(html).not.toContain("Plain User");
    expect(html).not.toContain("example.org");
  });

  it("header has a burger button that controls the menu panel", async () => {
    const { html } = await page("/moderators/");
    const button = html.match(/<button class="menu-toggle"[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    const id = button.match(/aria-controls="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div class="menu" id="${id}">[\\s\\S]*?class="nav-search"[\\s\\S]*?class="theme-toggle wide"[\\s\\S]*?href="/docs/about/"[\\s\\S]*?Sign in[\\s\\S]*?class="theme-toggle narrow"`));
  });

  it("About is a disclosure menu, marked current on the Moderators page", async () => {
    for (const path of ["/moderators/"]) {
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
    expect((await page("/submit-data/")).res.headers.get("location")).toBe("/login/?next=%2Fsubmit-data%2F");
    expect((await page("/api/openapi-v1.json")).res.headers.get("content-type")).toContain("application/json");
  });

  it("spectrum, author and news pages have Markdown versions, linked from the HTML", async () => {
    const md = await page("/spectra/mlc-nanotube-ylas-tas2.md");
    expect(md.status).toBe(200);
    expect(md.res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.html).toMatch(/^# MLC Nanotube \(Y,La\)S-TaS2\n/);
    expect(md.html).toContain("- Beam energy: 300 kV (typed by the contributor)");
    expect(md.html).toContain("- API v2 record (JSON): https://api.eelsdb.eu/v2/spectra/22236");
    expect(md.html).toContain("@article{ewels2016eelsdb,");
    const html = (await page("/spectra/mlc-nanotube-ylas-tas2/")).html;
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="/spectra/mlc-nanotube-ylas-tas2.md"/>');
    expect(html).toContain('<link rel="alternate" type="application/json" href="https://api.eelsdb.eu/v2/spectra/22236"/>');

    const author = await page("/author/simon.md");
    expect(author.html).toContain("## Contributed spectra (3)");
    expect(author.html).toContain("(https://eelsdb.eu/spectra/mlc-nanotube-ys-tas2.md)");
    expect((await page("/author/simon/")).html).toContain('href="/author/simon.md"');

    const news = await page("/hyperspy.md");
    expect(news.html).toMatch(/^# Hyperspy\n/);
    expect(news.html).not.toContain("<p>");
    for (const missing of ["/spectra/nope.md", "/author/nobody.md", "/nope.md"]) expect((await page(missing)).status, missing).toBe(404);
  });

  it("tells the static docs who is signed in, and every page saves it for the docs header", async () => {
    const out = await exports.default.fetch("https://eelsdb.eu/account/me.json");
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(await out.json()).toEqual({ signed_in: false });
    expect((await page("/news/")).html).toContain('localStorage.setItem("account",JSON.stringify(Object.assign({"signed_in":false}');

    const cookie = await sessionFor({ id: 7300001, display_name: "Ada </script> Lovelace", slug: "ada" });
    const me = await (await exports.default.fetch("https://eelsdb.eu/account/me.json", { headers: { cookie } })).json<any>();
    expect(me).toMatchObject({ signed_in: true, name: "Ada </script> Lovelace", initials: "AL", theme: "system" });
    expect(me.hue).toMatch(/^av-[a-e]$/);
    const html = await (await exports.default.fetch("https://eelsdb.eu/news/", { headers: { cookie } })).text();
    expect(html).toContain('"name":"Ada \\u003c/script> Lovelace"');
    expect(html).not.toContain("Ada </script>");
  });

  it("turns the news archive's HTML into Markdown", () => {
    expect(htmlToMarkdown('<p>See <a href="https://x.org">this</a>, <strong>now</strong>.<br>Next&#8217;s</p><blockquote><p>Quote</p></blockquote>')).toBe(
      "See [this](https://x.org), **now**.  \nNext\u2019s\n\n> Quote",
    );
  });

  it("closed sections return 410", async () => {
    for (const path of ["/forum/", "/forum/topic/x/", "/jobs/", "/registered-users/"]) {
      expect((await page(path)).status, path).toBe(410);
    }
  });
});
