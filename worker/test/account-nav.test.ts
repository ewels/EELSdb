import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ACCOUNT_PAGES, SETTINGS_PAGES } from "../src/pages/layout";
import { sessionFor } from "./helpers/session";

const get = async (path: string, cookie: string) =>
  (await exports.default.fetch(`https://eelsdb.eu${path}`, { redirect: "manual", headers: { Cookie: cookie } })).text();
const ALL_PAGES = [...ACCOUNT_PAGES, ...SETTINGS_PAGES];
const nav = (html: string) => html.match(/<nav class="account-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";

describe("account nav", () => {
  it("is on every account page, with that page marked current", async () => {
    const cookie = await sessionFor({ id: 7300001, display_name: "Nav User" });
    for (const [path] of ALL_PAGES) {
      const html = nav(await get(path, cookie));
      expect(html, path).toContain('aria-label="Your account"');
      expect(html.match(/aria-current="page"/g), path).toHaveLength(1);
      expect(html, path).toContain(`<a href="${path}" aria-current="page">`);
      for (const [other] of ALL_PAGES) expect(html, path).toContain(`href="${other}"`);
      expect(html, path).toContain('action="/logout/"');
      expect(html, path).not.toContain('href="/admin/');
    }
  });

  it("lists the settings pages as plain links in a Settings group, with no in-page section links", async () => {
    const html = nav(await get("/account/settings/emails/", await sessionFor({ id: 7300002, display_name: "Nav Settings" })));
    expect(html).toContain('id="account-settings"');
    expect(html).not.toContain('href="#');
    expect(html).not.toContain("account-sections");
  });

  it("sends /account/settings/ to the first settings page", async () => {
    const res = await exports.default.fetch("https://eelsdb.eu/account/settings/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(SETTINGS_PAGES[0][0]);
  });

  it("puts each settings section on one page", async () => {
    const cookie = await sessionFor({ id: 7300006, display_name: "Pages User" });
    const sections: Record<string, string[]> = {
      "/account/settings/profile/": ['id="h-avatar"', 'id="h-profile"'],
      "/account/settings/emails/": ['action="/account/settings/emails/"'],
      "/account/settings/sign-in/": ['id="h-signin"', 'id="h-password"'],
      "/account/settings/two-step/": ['id="h-two-step"', 'id="h-passkeys"'],
      "/account/settings/tokens/": ['action="/account/settings/tokens/"'],
    };
    const html: Record<string, string> = {};
    for (const [path] of SETTINGS_PAGES) html[path] = await get(path, cookie);
    for (const [path, marks] of Object.entries(sections)) {
      for (const mark of marks) {
        expect(html[path], `${path} has ${mark}`).toContain(mark);
        for (const other of Object.keys(html)) if (other !== path) expect(html[other], `${other} lacks ${mark}`).not.toContain(mark);
      }
    }
    expect(html["/account/settings/profile/"].indexOf('id="h-avatar"')).toBeLessThan(html["/account/settings/profile/"].indexOf('id="h-profile"'));
  });

  it("redirects every settings POST to the page that holds its section", async () => {
    const cookie = await sessionFor({ id: 7300007, display_name: "Redirect User" });
    const post = (path: string, body: Record<string, string> = {}) =>
      exports.default.fetch(`https://eelsdb.eu${path}`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: "https://eelsdb.eu" }, body: new URLSearchParams(body) });
    const cases: [path: string, body: Record<string, string>, page: string, mark: string][] = [
      ["/account/settings/profile/", { display_name: "Redirect User", username: "redirect-user" }, "/account/settings/profile/", 'id="h-profile"'],
      ["/account/settings/theme/", { theme: "dark" }, "/account/settings/profile/", 'id="h-profile"'],
      ["/account/settings/profile/", { display_name: "Redirect User", username: "redirect-user", picture: "initials" }, "/account/settings/profile/", 'id="h-avatar"'],
      ["/account/settings/emails/", { email: "redirect@example.invalid" }, "/account/settings/emails/", 'action="/account/settings/emails/"'],
      ["/account/settings/password/", { new_password: "x" }, "/account/settings/sign-in/", 'id="h-password"'],
      ["/account/settings/password/remove/", {}, "/account/settings/sign-in/", 'id="h-password"'],
      ["/account/settings/two-step/start/", {}, "/account/settings/two-step/", 'id="h-two-step"'],
      ["/account/settings/two-step/cancel/", {}, "/account/settings/two-step/", 'id="h-two-step"'],
      ["/account/settings/two-step/off/", { code: "000000" }, "/account/settings/two-step/", 'id="h-two-step"'],
      ["/account/settings/tokens/12345/revoke/", {}, "/account/settings/tokens/", 'action="/account/settings/tokens/"'],
      ["/account/settings/passkeys/remove/", { id: "none" }, "/account/settings/two-step/", 'id="h-passkeys"'],
    ];
    for (const [path, body, page, mark] of cases) {
      const location = new URL((await post(path, body)).headers.get("location")!, "https://eelsdb.eu");
      expect(location.pathname, path).toBe(page);
      expect(await get(location.pathname + location.search, cookie), path).toContain(mark);
    }
  });

  it("shows staff the pages their role opens", async () => {
    const mod = nav(await get("/account/", await sessionFor({ id: 7300003, display_name: "Nav Mod", role: "moderator" })));
    expect(mod).toContain('href="/admin/"');
    expect(mod).not.toContain('href="/admin/settings/"');
    const admin = nav(await get("/account/", await sessionFor({ id: 7300004, display_name: "Nav Admin", role: "admin" })));
    for (const href of ["/admin/", "/admin/users/", "/admin/settings/", "/admin/messages/"]) expect(admin).toContain(`href="${href}"`);
    const noTwoStep = nav(await get("/account/", await sessionFor({ id: 7300005, display_name: "Nav Mod 2", role: "moderator" }, { totp: false })));
    expect(noTwoStep).not.toContain('href="/admin/');
  });
});
