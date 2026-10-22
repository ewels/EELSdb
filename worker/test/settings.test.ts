import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sent } from "../src/email";
import { linkText, linkUrl, parseLink, parseUsername } from "../src/pages/profile";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const get = (path: string, cookie = "") => exports.default.fetch(`${SITE}${path}`, { redirect: "manual", headers: { Cookie: cookie } });
const post = (path: string, cookie: string, body: Record<string, string> | FormData = {}) =>
  exports.default.fetch(`${SITE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, Origin: SITE },
    body: body instanceof FormData ? body : new URLSearchParams(body),
  });

describe("profile links", () => {
  it("accepts handles and the service's own https links, and rejects others", () => {
    expect(parseLink("github", "@ewels")).toEqual({ value: "ewels" });
    expect(linkUrl("github", "ewels")).toBe("https://github.com/ewels");
    expect(linkUrl("mastodon", (parseLink("mastodon", "@phil@scholar.social") as any).value)).toBe("https://scholar.social/@phil");
    expect(parseLink("linkedin", "https://www.linkedin.com/in/someone")).toEqual({ value: "https://www.linkedin.com/in/someone" });
    expect("error" in parseLink("linkedin", "https://evil.example/in/someone")).toBe(true);
    expect("error" in parseLink("github", "javascript:alert(1)")).toBe(true);
    expect(parseLink("x", "")).toEqual({ value: null });
  });

  it("accepts full https addresses for web pages and nothing else", () => {
    expect(parseLink("website", "https://example.org/~me")).toEqual({ value: "https://example.org/~me" });
    expect(parseLink("institution", "https://lab.example.org")).toEqual({ value: "https://lab.example.org/" });
    for (const bad of ["http://example.org", "example.org", "javascript:alert(1)", "ftp://example.org", "https://localhost"]) {
      expect("error" in parseLink("website", bad), bad).toBe(true);
    }
    expect(linkText("institution", "https://lab.example.org/")).toBe("lab.example.org");
  });

  it("checks usernames", () => {
    expect(parseUsername("Phil-Ewels")).toEqual({ value: "phil-ewels" });
    expect("error" in parseUsername("-bad")).toBe(true);
    expect("error" in parseUsername("no spaces")).toBe(true);
  });
});

describe("settings", () => {
  it("saves the profile, renames the author everywhere, and redirects the old address", async () => {
    const cookie = await sessionFor({ id: 7100001, display_name: "Old Name", slug: "old-name" });
    await env.DB.prepare("INSERT INTO spectra (slug, status, title, type, owner_id, author_display, author_slug, published_at) VALUES ('profile-spectrum', 'published', 'Profile spectrum', 'coreloss', 7100001, 'Old Name', 'old-name', '2026-01-01')").run();

    await env.DB.prepare("INSERT INTO identities (user_id, provider, subject) VALUES (7100001, 'orcid', '0000-0002-1825-0097')").run();

    const res = await post("/account/settings/profile/", cookie, {
      display_name: "New Name",
      username: "new-name",
      job_title: "Postdoc",
      affiliation: "Lab of Spectra",
      orcid: "0000-0001-0000-0001",
      link_github: "@newname",
      show_details: "1", show_links: "1",
    });
    expect(res.status).toBe(302);
    expect(await env.DB.prepare("SELECT author_display || ' ' || author_slug FROM spectra WHERE slug = 'profile-spectrum'").first()).toEqual({
      "author_display || ' ' || author_slug": "New Name new-name",
    });

    const page = await (await get("/author/new-name/")).text();
    expect(page).toContain("Postdoc · Lab of Spectra");
    expect(page).toContain('href="https://github.com/newname"');
    expect(page).toContain("0000-0002-1825-0097");
    expect(page).not.toContain("0000-0001-0000-0001");
    expect(await env.DB.prepare("SELECT orcid FROM users WHERE id = 7100001").first("orcid")).toBeNull();
    expect(page).toContain("Profile spectrum");
    const old = await get("/author/old-name/");
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("/author/new-name/");

    await post("/account/settings/profile/", cookie, { display_name: "New Name", username: "new-name", job_title: "Postdoc" });
    const hidden = await (await get("/author/new-name/")).text();
    expect(hidden).not.toContain("Postdoc");
    expect(hidden).toContain("Profile spectrum");
  });

  it("keeps typed values and saves nothing when a field is wrong", async () => {
    const cookie = await sessionFor({ id: 7100002, display_name: "Careful", slug: "careful" });
    await sessionFor({ id: 7100003, display_name: "Taken", slug: "taken-name" });
    const res = await post("/account/settings/profile/", cookie, { display_name: "Careful", username: "taken-name", link_bluesky: "not a handle", job_title: "Typed" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("That username is taken.");
    expect(html).toContain("Bluesky:");
    expect(html).toContain('value="Typed"');
    expect(await env.DB.prepare("SELECT job_title FROM users WHERE id = 7100002").first("job_title")).toBeNull();
  });

  it("adds, confirms, promotes and removes email addresses", async () => {
    const cookie = await sessionFor({ id: 7100004, display_name: "Mail User" });
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (7100004, 'first@example.org', 1, 1)").run();

    expect((await post("/account/settings/emails/", cookie, { email: "Second@Example.org" })).headers.get("location")).toContain("notice=sent");
    const mail = sent.findLast((m) => m.to === "second@example.org")!;
    const link = mail.text.match(/\/account\/emails\/verify\/[\w-]+\//)![0];
    expect((await get(link, cookie)).headers.get("location")).toContain("notice=verified");

    const second = await env.DB.prepare("SELECT id, verified, is_primary FROM user_emails WHERE email = 'second@example.org'").first<any>();
    expect(second).toMatchObject({ verified: 1, is_primary: 0 });
    await post(`/account/settings/emails/${second.id}/primary/`, cookie);
    const first = await env.DB.prepare("SELECT id, is_primary FROM user_emails WHERE email = 'first@example.org'").first<any>();
    expect(first.is_primary).toBe(0);

    expect((await post(`/account/settings/emails/${second.id}/remove/`, cookie)).headers.get("location")).toContain("keep-primary");
    await post(`/account/settings/emails/${first.id}/remove/`, cookie);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM user_emails WHERE user_id = 7100004").first("n")).toBe(1);

    // Someone else's address cannot be changed.
    const other = await sessionFor({ id: 7100005, display_name: "Other" });
    expect((await post(`/account/settings/emails/${second.id}/remove/`, other)).status).toBe(404);
  });

  it("applies the chosen theme on every page", async () => {
    const cookie = await sessionFor({ id: 7100006, display_name: "Night Owl" });
    await post("/account/settings/theme/", cookie, { theme: "dark" });
    expect(await (await get("/", cookie)).text()).toContain('<html lang="en" data-theme="dark">');
    expect(await (await get("/")).text()).toContain('<html lang="en">');
  });

});

describe("picture choice", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  let nextId = 7100100;
  async function account(opts: { email?: boolean } = {}) {
    const id = ++nextId;
    const cookie = await sessionFor({ id, display_name: "Picture Person" });
    if (opts.email !== false) await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, 1, 1)").bind(id, `pic-${id}@example.invalid`).run();
    return { id, cookie };
  }
  const form = (fields: Record<string, string>, file?: File) => {
    const fd = new FormData();
    fd.append("display_name", "Picture Person");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append("avatar", file ?? new File([], ""));
    return fd;
  };
  const state = (id: number) => env.DB.prepare("SELECT avatar_key, use_gravatar FROM users WHERE id = ?").bind(id).first<{ avatar_key: string | null; use_gravatar: number }>();
  const upload = async (p: { id: number; cookie: string }) => {
    const res = await post("/account/settings/profile/", p.cookie, form({ picture: "upload" }, new File([PNG], "me.png", { type: "image/png" })));
    expect(res.headers.get("location")).toBe("/account/settings/profile/?notice=profile");
    return (await state(p.id))!.avatar_key!;
  };

  it("is one form without JavaScript: three radios, a plain file input and one Save", async () => {
    const { cookie } = await account();
    const html = await (await get("/account/settings/profile/", cookie)).text();
    const forms = html.match(/<form [^>]*>/g)!.filter((f) => f.includes('action="/account/settings/'));
    expect(forms).toEqual(['<form method="post" action="/account/settings/profile/" enctype="multipart/form-data" class="profile-form">']);
    const profileForm = html.slice(html.indexOf(forms[0]), html.indexOf("</form>", html.indexOf(forms[0])));
    expect(html).toContain("<legend><h2 id=\"h-avatar\">Picture</h2></legend>");
    for (const value of ["initials", "gravatar", "upload"]) expect(html).toContain(`type="radio" name="picture" id="f-picture-${value}" value="${value}"`);
    expect(html).toContain('id="f-picture-initials" value="initials" checked=""');
    expect(html).toContain('<input type="file" name="avatar" id="f-avatar"');
    expect(profileForm.match(/<button/g)).toHaveLength(1);
    expect(profileForm).toContain('<button class="button" type="submit">Save profile</button>');
    expect(profileForm).toContain('<input type="file" name="avatar"');
    expect(html).not.toMatch(/\/account\/settings\/avatar\/(remove|gravatar)?/);
  });

  it("uploads a picture, serves it, and replaces it with the next one, deleting the old file", async () => {
    const p = await account();
    await env.DB.prepare("UPDATE users SET use_gravatar = 1 WHERE id = ?").bind(p.id).run();
    const first = await upload(p);
    expect(first).toMatch(new RegExp(`^${p.id}/[\\w-]+\\.png$`));
    expect((await state(p.id))!.use_gravatar).toBe(0);
    expect(await (await get("/", p.cookie)).text()).toContain(`src="/avatars/${first}"`);
    expect((await get(`/avatars/${first}`)).headers.get("Content-Type")).toBe("image/png");
    expect(await (await get("/account/settings/profile/", p.cookie)).text()).toContain('id="f-picture-upload" value="upload" checked=""');

    const second = await upload(p);
    expect(second).not.toBe(first);
    expect(await env.FILES.get(`avatars/${first}`)).toBeNull();
    expect(await env.FILES.get(`avatars/${second}`)).not.toBeNull();

    await post("/account/settings/profile/", p.cookie, form({ picture: "upload", job_title: "Kept" }));
    expect((await state(p.id))!.avatar_key).toBe(second);
    await env.FILES.delete(`avatars/${second}`);
  });

  it("treats a chosen file as \"Your picture\" whatever radio was left on, as the browser does", async () => {
    const p = await account();
    await post("/account/settings/profile/", p.cookie, form({ picture: "initials" }, new File([PNG], "me.png", { type: "image/png" })));
    const key = (await state(p.id))!.avatar_key;
    expect(key).toMatch(new RegExp(`^${p.id}/`));
    await env.FILES.delete(`avatars/${key}`);
  });

  it("drops the uploaded file for Gravatar and for initials", async () => {
    for (const [picture, use_gravatar] of [["gravatar", 1], ["initials", 0]] as const) {
      const p = await account();
      const key = await upload(p);
      expect((await post("/account/settings/profile/", p.cookie, form({ picture }))).headers.get("location")).toBe("/account/settings/profile/?notice=profile");
      expect(await state(p.id)).toEqual({ avatar_key: null, use_gravatar });
      expect(await env.FILES.get(`avatars/${key}`)).toBeNull();
      const html = await (await get("/account/settings/profile/?notice=profile", p.cookie)).text();
      expect(html).toContain('<p class="notice" role="status">Profile saved.</p>');
      expect(html).toContain(`id="f-picture-${picture}" value="${picture}" checked=""`);
    }
  });

  it("refuses \"Your picture\" with nothing uploaded, a bad file, and Gravatar without a confirmed address, keeping what was typed", async () => {
    const p = await account();
    const none = await post("/account/settings/profile/", p.cookie, form({ picture: "upload", job_title: "Typed Title" }));
    expect(none.status).toBe(422);
    const html = await none.text();
    expect(html).toContain("Choose a picture file to upload, or pick Initials or Gravatar.");
    expect(html).toContain('value="Typed Title"');
    expect(html).toContain('id="f-picture-upload" value="upload" checked=""');
    expect(await env.DB.prepare("SELECT job_title FROM users WHERE id = ?").bind(p.id).first("job_title")).toBeNull();

    const svg = await post("/account/settings/profile/", p.cookie, form({ picture: "upload" }, new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" })));
    expect(svg.status).toBe(422);
    expect(await svg.text()).toContain("Use a PNG, JPEG or WebP file under 512 KB, and choose it again.");
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(PNG);
    expect((await post("/account/settings/profile/", p.cookie, form({ picture: "upload" }, new File([big], "big.png", { type: "image/png" })))).status).toBe(422);

    const lost = await post("/account/settings/profile/", p.cookie, form({ picture: "upload", link_github: "javascript:alert(1)" }, new File([PNG], "me.png", { type: "image/png" })));
    expect(lost.status).toBe(422);
    expect(await lost.text()).toContain("choose your picture again: browsers do not keep a chosen file after an error.");
    expect(await state(p.id)).toEqual({ avatar_key: null, use_gravatar: 0 });
    expect((await env.FILES.list({ prefix: `avatars/${p.id}/` })).objects).toEqual([]);

    const q = await account({ email: false });
    const page = await (await get("/account/settings/profile/", q.cookie)).text();
    expect(page).toContain('id="f-picture-gravatar" value="gravatar" disabled=""');
    const g = await post("/account/settings/profile/", q.cookie, form({ picture: "gravatar" }));
    expect(g.status).toBe(422);
    expect(await g.text()).toContain("Gravatar needs a confirmed primary email address.");
    expect(await state(q.id)).toEqual({ avatar_key: null, use_gravatar: 0 });
  });
});
