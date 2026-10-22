import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0019_profile_visibility.sql?raw";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const get = async (path: string, cookie = "") => (await exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: { Cookie: cookie } })).text();
const post = (path: string, cookie: string, body: Record<string, string>) =>
  exports.default.fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: SITE }, body: new URLSearchParams(body) });

let next = 7400001;
async function person(flags: { use_gravatar?: number; show_details?: number; show_links?: number; linked?: boolean }) {
  const id = next++;
  const slug = `vis-${id}`;
  const orcid = `0000-0002-${String(id).slice(-4)}-0000`;
  await env.DB.prepare(
    `INSERT INTO users (id, display_name, slug, job_title, affiliation, orcid, links_json, use_gravatar, show_details, show_links)
     VALUES (?, 'Vis Person', ?, 'Visible Title', 'Visible Lab', '0000-0002-1825-0097', '{"github":"visgithub"}', ?, ?, ?)`,
  ).bind(id, slug, flags.use_gravatar ?? 0, flags.show_details ?? 0, flags.show_links ?? 0).run();
  if (flags.linked !== false) await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'orcid', ?)").bind(id, orcid).run();
  await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)").bind(id, `${slug}@example.invalid`).run();
  return { id, slug, orcid };
}

describe("profile visibility switches", () => {
  it("look up a Gravatar only with its switch, and always show an uploaded picture", async () => {
    const off = await person({ show_details: 1, show_links: 1 });
    const on = await person({ use_gravatar: 1, show_details: 1 });
    expect(await get(`/author/${off.slug}/`)).not.toContain("gravatar.com/avatar/");
    expect(await get(`/author/${on.slug}/`)).toContain("gravatar.com/avatar/");
    await env.DB.prepare("UPDATE users SET avatar_key = ? WHERE id = ?").bind(`${off.id}/pic.png`, off.id).run();
    const uploaded = await get(`/author/${off.slug}/`);
    expect(uploaded).toContain(`/avatars/${off.id}/pic.png`);
    expect(uploaded).not.toContain("gravatar.com/avatar/");
  });

  it("show a signed-in user the same picture others see", async () => {
    const id = next++;
    const cookie = await sessionFor({ id, display_name: "Own Header" });
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)").bind(id, `own-${id}@example.invalid`).run();
    expect(await get("/account/", cookie)).not.toContain("gravatar.com/avatar/");
    await post("/account/settings/profile/", cookie, { display_name: "Own Header", picture: "gravatar" });
    expect(await get("/account/", cookie)).toContain("gravatar.com/avatar/");
  });

  it("show job title and affiliation only with the details switch", async () => {
    const off = await person({ use_gravatar: 1, show_links: 1 });
    const on = await person({ show_details: 1 });
    for (const ext of ["/", ".md"]) {
      const base = (p: { slug: string }) => `/author/${p.slug}${ext}`;
      const hidden = await get(base(off));
      expect(hidden).not.toContain("Visible Title");
      expect(hidden).not.toContain("Visible Lab");
      const shown = await get(base(on));
      expect(shown).toContain("Visible Title");
      expect(shown).toContain("Visible Lab");
    }
  });

  it("show the ORCID iD and links only with the links switch", async () => {
    const off = await person({ use_gravatar: 1, show_details: 1 });
    const on = await person({ show_links: 1 });
    for (const ext of ["/", ".md"]) {
      const hidden = await get(`/author/${off.slug}${ext}`);
      expect(hidden).not.toContain(off.orcid);
      const shown = await get(`/author/${on.slug}${ext}`);
      expect(shown).toContain(on.orcid);
    }
    expect(await get(`/author/${on.slug}/`)).toContain("github.com/visgithub");
    expect(await get(`/author/${off.slug}/`)).not.toContain("github.com/visgithub");
  });

  it("show web pages by host name, only with the links switch", async () => {
    const id = next++;
    const cookie = await sessionFor({ id, display_name: "Web User", slug: `web-${id}` });
    const save = (extra: Record<string, string>) =>
      post("/account/settings/profile/", cookie, { display_name: "Web User", username: `web-${id}`, link_website: "https://me.example.org/home", link_institution: "https://lab.example.org", ...extra });
    expect((await save({ link_website: "http://me.example.org" })).status).toBe(422);
    expect((await save({ link_institution: "javascript:alert(1)" })).status).toBe(422);
    expect((await save({})).status).toBe(302);
    const stored = await env.DB.prepare("SELECT links_json FROM users WHERE id = ?").bind(id).first<string>("links_json");
    expect(JSON.parse(stored!)).toEqual({ website: "https://me.example.org/home", institution: "https://lab.example.org/" });
    expect(await get(`/author/web-${id}/`)).not.toContain("lab.example.org");
    await save({ show_links: "1" });
    const shown = await get(`/author/web-${id}/`);
    expect(shown).toContain('href="https://lab.example.org/" rel="me noopener"');
    expect(shown).toContain("me.example.org</a>");
    const form = await get("/account/settings/profile/", cookie);
    expect(form).toContain('<label for="f-link_website">Personal web page</label>');
    expect(form).toContain('<label for="f-link_institution">Institutional web page</label>');
    expect(form).not.toContain('name="orcid"');
  });

  it("show only an ORCID iD from a linked ORCID sign-in, not a typed or old-site one", async () => {
    const unlinked = await person({ show_links: 1, linked: false });
    for (const ext of ["/", ".md"]) expect(await get(`/author/${unlinked.slug}${ext}`)).not.toContain("0000-0002-1825-0097");
    const linked = await person({ show_links: 1 });
    expect(await get(`/author/${linked.slug}/`)).toContain(`https://orcid.org/${linked.orcid}`);
  });

  it("give a page when any one is on, and none when all are off", async () => {
    for (const flag of ["show_details", "show_links"] as const) {
      expect((await exports.default.fetch(`${SITE}/author/${(await person({ [flag]: 1 })).slug}/`)).status, flag).toBe(200);
    }
    expect((await exports.default.fetch(`${SITE}/author/${(await person({})).slug}/`)).status).toBe(404);
  });

  it("save each switch from its own place and link the username to the page", async () => {
    const id = next++;
    const cookie = await sessionFor({ id, display_name: "Switch User", slug: `switch-${id}` });
    const flags = () => env.DB.prepare("SELECT use_gravatar, show_details, show_links FROM users WHERE id = ?").bind(id).first();
    expect(await flags()).toEqual({ use_gravatar: 0, show_details: 0, show_links: 0 });

    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)").bind(id, `switch-${id}@example.invalid`).run();
    await post("/account/settings/profile/", cookie, { display_name: "Switch User", username: `switch-${id}`, picture: "gravatar" });
    expect(await flags()).toEqual({ use_gravatar: 1, show_details: 0, show_links: 0 });

    await post("/account/settings/profile/", cookie, { display_name: "Switch User", username: `switch-${id}`, show_links: "1" });
    expect(await flags()).toEqual({ use_gravatar: 1, show_details: 0, show_links: 1 });

    const page = await get("/account/settings/profile/", cookie);
    expect(page).toContain(`<a href="${SITE}/author/switch-${id}/">${SITE}/author/switch-${id}/</a>`);
    expect(page).toContain('name="picture" id="f-picture-gravatar" value="gravatar" checked=""');
    expect(page).toContain("Show my job title and affiliation on my author page");
    expect(page).toContain("Show my web pages, ORCID iD and social accounts on my author page");
  });

  it("keeps the field hints after a save and after an error, and offers the public page only when there is one", async () => {
    const id = next++;
    const cookie = await sessionFor({ id, display_name: "Hint User", slug: `hint-${id}` });
    const hints = (html: string) => {
      expect(html).toContain("Shown as the author of your spectra.");
      expect(html).toContain(`Your page: <a href="${SITE}/author/hint-${id}/">`);
    };
    const first = await get("/account/settings/profile/", cookie);
    hints(first);
    expect(first).not.toContain("View public profile");
    expect(first).toContain("How you appear on EELSdb");

    const saved = await post("/account/settings/profile/", cookie, { display_name: "Hint User", username: `hint-${id}`, show_details: "1" });
    expect(saved.status).toBe(302);
    const after = await get(saved.headers.get("location")!, cookie);
    expect(after).toContain("Profile saved.");
    hints(after);
    expect(after).toContain(`href="/author/hint-${id}/">View public profile`);

    const failed = await post("/account/settings/profile/", cookie, { display_name: "Hint User", username: `hint-${id}`, link_github: "not a handle!" });
    expect(failed.status).toBe(422);
    hints(await failed.text());
  });

  it("migration 0019 copies profile_public into all three switches", async () => {
    await env.DB.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, profile_public INTEGER NOT NULL DEFAULT 0)".replace("users", "mig_users"));
    await env.DB.exec("INSERT INTO mig_users (id, profile_public) VALUES (1, 1), (2, 0)");
    // D1 exec wants one statement per line.
    for (const statement of migration.replaceAll("users", "mig_users").split(";").map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean)) {
      await env.DB.prepare(statement).run();
    }
    const { results } = await env.DB.prepare("SELECT id, use_gravatar, show_details, show_links FROM mig_users ORDER BY id").all();
    expect(results).toEqual([
      { id: 1, use_gravatar: 1, show_details: 1, show_links: 1 },
      { id: 2, use_gravatar: 0, show_details: 0, show_links: 0 },
    ]);
    await env.DB.exec("DROP TABLE mig_users");
  });
});
