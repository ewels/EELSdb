import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sent } from "../src/email";
import { deleteOldMessages } from "../src/contact";
import { sessionFor } from "./helpers/session";

const config = env as { TURNSTILE_SECRET_KEY?: string; CONTACT_EMAIL?: string; EMAIL_PROVIDER?: string };
const SITE = "https://eelsdb.eu";
let nextIp = 0;
const go = (path: string, cookie = "", init: RequestInit = {}) =>
  exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as object) } });
const send = (fields: Record<string, string>, cookie = "", headers: Record<string, string> = {}) =>
  go("/contact/", cookie, {
    method: "POST",
    headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": `198.51.100.${++nextIp}`, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
const good = (n: number) => ({ name: "Ada Test", email: `ada${n}@example.invalid`, topic: "spectrum", message: "How was this spectrum calibrated?", page: "/spectra/x/" });
const count = (sql: string, ...args: unknown[]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).bind(...args).first<number>("n").then((n) => n ?? 0);
const mails = () => sent.filter((m) => m.subject.startsWith("[EELSdb contact]"));

let nextId = 9960000;
async function staff(role: string, opts: { email?: string | null; verified?: boolean; totp?: boolean } = {}) {
  const id = ++nextId;
  const cookie = await sessionFor({ id, display_name: `Contact ${role} ${id}`, role }, { totp: opts.totp });
  if (opts.email !== null) {
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, ?, 1)")
      .bind(id, opts.email ?? `staff${id}@example.invalid`, opts.verified === false ? 0 : 1).run();
  }
  return { id, cookie, email: opts.email === undefined ? `staff${id}@example.invalid` : opts.email };
}

afterEach(() => {
  config.TURNSTILE_SECRET_KEY = "";
  config.CONTACT_EMAIL = undefined;
  vi.unstubAllGlobals();
});

describe("contact form", () => {
  it("shows the form with the GitHub note, and /docs/about/contact/ is still the docs page", async () => {
    const html = await (await go("/contact/")).text();
    expect(html).toContain('action="/contact/"');
    expect(html).toContain('name="topic"');
    expect(html).toContain("https://github.com/ewels/EELSdb/issues");
    expect(html).not.toContain("Signed in as");
    expect((await go("/contact/")).status).toBe(200);
  });

  it("prefills name and primary confirmed address when signed in, and the page it came from", async () => {
    const u = await staff("user", { email: "prefill@example.invalid" });
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, 'unconfirmed@example.invalid', 0)").bind(u.id).run();
    const html = await (await go("/contact/?from=/spectra/", u.cookie)).text();
    expect(html).toContain(`value="Contact user ${u.id}"`);
    expect(html).toContain('value="prefill@example.invalid"');
    expect(html).not.toContain("unconfirmed@example.invalid");
    expect(html).toContain('name="page" value="/spectra/"');
    expect(await (await go("/contact/?from=//evil.example", u.cookie)).text()).toContain('name="page" value=""');
    const viaReferer = await (await go("/contact/", "", { headers: { Referer: `${SITE}/news/?x=1` } })).text();
    expect(viaReferer).toContain('name="page" value="/news/"');
  });

  it("validates every field and keeps what was typed", async () => {
    const before = await count("SELECT 1 FROM contact_messages");
    const res = await send({ ...good(1), name: " ", email: "not-an-address", topic: "bogus", message: "short" });
    expect(res.status).toBe(422);
    const html = await res.text();
    for (const m of ["Please enter your name", "valid email address", "choose a topic", "write a message"]) expect(html).toContain(m);
    expect((await send({ ...good(1), message: "x".repeat(5001) })).status).toBe(422);
    const kept = await (await send({ ...good(2), email: "bad" })).text();
    expect(kept).toContain("How was this spectrum calibrated?");
    expect(await count("SELECT 1 FROM contact_messages")).toBe(before);
  });

  it("emails each effective admin once, with Reply-To the sender and the context; never the sender", async () => {
    const a = await staff("admin", { email: "admin-a@example.invalid" });
    await env.DB.prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, 'admin-a-second@example.invalid', 1)").bind(a.id).run();
    const b = await staff("admin", { email: "admin-b@example.invalid" });
    const noTwoStep = await staff("admin", { email: "admin-nofa@example.invalid", totp: false });
    const unconfirmed = await staff("admin", { email: "admin-unconfirmed@example.invalid", verified: false });
    const noAddress = await staff("admin", { email: null });
    const moderator = await staff("moderator", { email: "mod@example.invalid" });
    const person = await staff("user", { email: "person@example.invalid" });
    sent.length = 0;
    const res = await send({ ...good(3), email: "Sender@Example.invalid" }, person.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact/sent/");
    const to = mails().map((m) => m.to).sort();
    expect(to).toContain("admin-a@example.invalid");
    expect(to).toContain("admin-b@example.invalid");
    for (const other of ["admin-a-second@example.invalid", "admin-nofa@example.invalid", "admin-unconfirmed@example.invalid", "mod@example.invalid", "person@example.invalid", "sender@example.invalid"]) {
      expect(to, other).not.toContain(other);
    }
    expect(new Set(to).size).toBe(to.length);
    const m = mails().find((x) => x.to === "admin-a@example.invalid")!;
    expect(m.replyTo).toBe("sender@example.invalid");
    expect(m.text).toContain("because you are an administrator of the EELS Data Base");
    expect(m.text).not.toContain("this address was used on eelsdb.eu");
    expect(m.subject).toBe("[EELSdb contact] A question about a spectrum");
    expect(m.text).toContain("How was this spectrum calibrated?");
    expect(m.text).toContain(`Signed in: yes, ${person.cookie ? `Contact user ${person.id}` : ""}, ${SITE}/admin/users/${person.id}/`);
    expect(m.text).toContain(`Page: ${SITE}/spectra/x/`);
    const stored = await env.DB.prepare("SELECT * FROM contact_messages WHERE email = 'sender@example.invalid'").first<any>();
    expect(stored).toMatchObject({ user_id: person.id, status: "sent", topic: "spectrum", recipients: to.length, delivered: to.length });
    void [noTwoStep, unconfirmed, noAddress, moderator];

    sent.length = 0;
    await send({ ...good(4), email: "anon@example.invalid" });
    expect(mails()[0].text).toContain("Signed in: no");
    expect((await env.DB.prepare("SELECT user_id FROM contact_messages WHERE email = 'anon@example.invalid'").first<any>()).user_id).toBeNull();
  });

  it("keeps the message and marks it when sending fails", async () => {
    const mod = await import("../src/email");
    const old = config.EMAIL_PROVIDER;
    config.EMAIL_PROVIDER = "nope";
    try {
      const res = await send({ ...good(5), email: "fails@example.invalid" });
      expect(res.status).toBe(303);
    } finally {
      config.EMAIL_PROVIDER = old;
    }
    expect(mod.sent).toBeDefined();
    const row = await env.DB.prepare("SELECT status, delivered FROM contact_messages WHERE email = 'fails@example.invalid'").first<any>();
    expect(row.status).toBe("failed");
    expect(row.delivered).toBe(0);
  });

  it("honeypot: pretends it worked, stores and sends nothing", async () => {
    sent.length = 0;
    const res = await send({ ...good(6), email: "bot@example.invalid", website: "http://spam.example" });
    expect(res.headers.get("location")).toBe("/contact/sent/");
    expect(await count("SELECT 1 FROM contact_messages WHERE email = 'bot@example.invalid'")).toBe(0);
    expect(mails()).toHaveLength(0);
  });

  it("Turnstile: refused without a token or when verification fails, accepted when it passes", async () => {
    config.TURNSTILE_SECRET_KEY = "secret";
    const form = { ...good(7), email: "turn@example.invalid" };
    expect((await send(form)).status).toBe(422);
    const verify = (success: boolean) => vi.fn(async () => Response.json({ success }));
    vi.stubGlobal("fetch", verify(false));
    const failed = await send({ ...form, "cf-turnstile-response": "tok" });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("anti-spam check failed");
    vi.stubGlobal("fetch", verify(true));
    expect((await send({ ...form, "cf-turnstile-response": "tok" })).status).toBe(303);
    expect(await count("SELECT 1 FROM contact_messages WHERE email = 'turn@example.invalid'")).toBe(1);
  });

  it("limits 5 messages an hour per address and per IP", async () => {
    for (let i = 0; i < 5; i++) expect((await send({ ...good(8), email: "same@example.invalid" })).status).toBe(303);
    const sixth = await send({ ...good(8), email: "same@example.invalid" });
    expect(sixth.status).toBe(429);
    expect(await sixth.text()).toContain("try again later");
    expect(await count("SELECT 1 FROM contact_messages WHERE email = 'same@example.invalid'")).toBe(5);
    for (let i = 0; i < 5; i++) expect((await send({ ...good(9), email: `ip${i}@example.invalid` }, "", { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(303);
    expect((await send({ ...good(9), email: "ip-other@example.invalid" }, "", { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(429);
    expect((await send({ ...good(9), email: "ip-other@example.invalid" }, "", { "CF-Connecting-IP": "203.0.113.10" })).status).toBe(303);
  });

  it("lists messages for admins only, and deletes those older than a year", async () => {
    const admin = await staff("admin");
    const mod = await staff("moderator");
    const user = await staff("user");
    await send({ ...good(10), email: "listed@example.invalid", message: "<b>hello</b> list me" });
    const page = await go("/admin/messages/", admin.cookie);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("listed@example.invalid");
    expect(html).toContain("&lt;b&gt;hello&lt;/b&gt; list me");
    expect((await go("/admin/messages/", mod.cookie)).status).toBe(403);
    expect((await go("/admin/messages/", user.cookie)).status).toBe(403);
    expect((await go("/admin/messages/")).status).not.toBe(200);
    expect(await (await go("/admin/", admin.cookie)).text()).toContain('href="/admin/messages/"');

    await env.DB.prepare("UPDATE contact_messages SET created_at = datetime('now', '-366 days') WHERE email = 'listed@example.invalid'").run();
    await deleteOldMessages(env);
    expect(await count("SELECT 1 FROM contact_messages WHERE email = 'listed@example.invalid'")).toBe(0);
    expect(await count("SELECT 1 FROM contact_messages WHERE email = 'same@example.invalid'")).toBe(5);
  });

  it("falls back to CONTACT_EMAIL when no administrator has an address, else stores with no recipient", async () => {
    await env.DB.prepare("UPDATE users SET role = 'user' WHERE role = 'admin'").run();
    sent.length = 0;
    await send({ ...good(11), email: "none@example.invalid" });
    expect(mails()).toHaveLength(0);
    expect((await env.DB.prepare("SELECT status FROM contact_messages WHERE email = 'none@example.invalid'").first<any>()).status).toBe("no_recipient");
    config.CONTACT_EMAIL = "team@example.invalid";
    await send({ ...good(12), email: "fallback@example.invalid" });
    expect(mails().map((m) => m.to)).toEqual(["team@example.invalid"]);
    expect(mails()[0].replyTo).toBe("fallback@example.invalid");
  });

  it("every Contact link on the site points to /contact/", async () => {
    const home = await (await go("/moderators/")).text();
    expect(home).toContain('href="/contact/"');
    expect(home).not.toContain('href="/docs/about/contact/"');
    expect((await go("/docs/about/contact/")).status).not.toBe(301);
  });
});
