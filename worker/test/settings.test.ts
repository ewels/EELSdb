import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sent } from "../src/email";
import { linkUrl, parseLink, parseUsername } from "../src/pages/profile";
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

    const res = await post("/account/settings/profile/", cookie, {
      display_name: "New Name",
      username: "new-name",
      job_title: "Postdoc",
      affiliation: "Lab of Spectra",
      orcid: "https://orcid.org/0000-0002-1825-0097",
      link_github: "@newname",
      profile_public: "1",
    });
    expect(res.status).toBe(302);
    expect(await env.DB.prepare("SELECT author_display || ' ' || author_slug FROM spectra WHERE slug = 'profile-spectrum'").first()).toEqual({
      "author_display || ' ' || author_slug": "New Name new-name",
    });

    const page = await (await get("/author/new-name/")).text();
    expect(page).toContain("Postdoc · Lab of Spectra");
    expect(page).toContain('href="https://github.com/newname"');
    expect(page).toContain("0000-0002-1825-0097");
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

  it("uploads a picture, serves it and shows it instead of Gravatar", async () => {
    const cookie = await sessionFor({ id: 7100007, display_name: "Picture Person" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const fd = new FormData();
    fd.append("avatar", new File([png], "me.png", { type: "image/png" }));
    expect((await post("/account/settings/avatar/", cookie, fd)).headers.get("location")).toContain("notice=avatar");
    const key = await env.DB.prepare("SELECT avatar_key FROM users WHERE id = 7100007").first<string>("avatar_key");
    expect(key).toMatch(/^7100007\/[\w-]+\.png$/);
    expect(await (await get("/", cookie)).text()).toContain(`src="/avatars/${key}"`);
    const served = await get(`/avatars/${key}`);
    expect(served.headers.get("Content-Type")).toBe("image/png");

    const svg = new FormData();
    svg.append("avatar", new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }));
    expect((await post("/account/settings/avatar/", cookie, svg)).headers.get("location")).toContain("avatar-bad");
  });
});
