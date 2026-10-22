import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/auth";
import { sent } from "../src/email";
import { mergeAccounts } from "../src/merge";
import { sessionFor } from "./helpers/session";

const SITE = "https://eelsdb.eu";
const go = (path: string, cookie = "", init: RequestInit = {}) =>
  exports.default.fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as object) } });
const post = (path: string, cookie: string, body: Record<string, string> = {}) =>
  go(path, cookie, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
const row = <T,>(sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const all = <T,>(sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).all<T>().then((r) => r.results);
const count = (sql: string, ...args: unknown[]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).bind(...args).first<number>("n").then((n) => n ?? 0);
const run = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).run();

let nextId = 9940100;
const admin = (role = "admin") => sessionFor({ id: ++nextId, display_name: `Merge Admin ${nextId}`, role }).then((cookie) => ({ id: nextId, cookie }));

async function account(opts: { name: string; slug?: string | null; role?: string; password?: boolean; verified?: boolean; emails?: string[]; unverified?: string[] }) {
  const id = ++nextId;
  await run("INSERT INTO users (id, display_name, slug, role, password_hash, legacy_password_hash) VALUES (?, ?, ?, ?, ?, ?)",
    id, opts.name, opts.slug ?? null, opts.role ?? "user", opts.password ? `pbkdf2$${id}` : null, opts.password ? `$P$B${id}` : null);
  const emails = opts.emails ?? [`m${id}@example.invalid`];
  for (const [i, email] of emails.entries()) {
    await run("INSERT INTO user_emails (user_id, email, verified, is_primary) VALUES (?, ?, ?, ?)", id, email, opts.verified === false || opts.unverified?.includes(email) ? 0 : 1, i === 0 ? 1 : 0);
  }
  const token = crypto.randomUUID();
  await run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", await sha256(token), id);
  return { id, email: emails[0], cookie: `eelsdb_session=${token}` };
}

const totp = (id: number, secret: string, enabled = true) =>
  run("INSERT INTO user_totp (user_id, secret, enabled_at) VALUES (?, ?, ?)", id, secret, enabled ? "2026-01-01" : null);
const code = (id: number, hash: string) => run("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)", id, hash);
const passkey = (id: number, credential: string) => run("INSERT INTO passkeys (credential_id, user_id, public_key, name) VALUES (?, ?, 'key', ?)", credential, id, credential);
const spectrum = async (owner: number, slug: string, status = "published") =>
  (await run("INSERT INTO spectra (slug, status, title, type, owner_id, author_slug, author_display) VALUES (?, ?, ?, 'coreloss', ?, 'old-author', 'Old Author')", slug, status, slug, owner)).meta.last_row_id;
const merge = (keptId: number, goneId: number, cookie: string, body: Record<string, string> = {}) => post(`/admin/users/${keptId}/merge/${goneId}/`, cookie, body);
const mailTo = (to: string) => sent.filter((m) => m.to === to);

/** Every column declared `REFERENCES users`, read from the schema so a table added later is checked too. */
const referencing = async () =>
  (await all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'table'")).flatMap((t) =>
    [...t.sql.matchAll(/(\w+)\s+INTEGER[^,\n]*REFERENCES users\(id\)/g)].map((m) => ({ tbl: t.name, col: m[1] })),
  );

describe("merging accounts", () => {
  it("moves or drops every table, and leaves nothing pointing at the merged-away account", async () => {
    const a = await admin();
    const kept = await account({ name: "Kept Person", slug: "kept-person", password: true, emails: ["shared@example.invalid", "kept-only@example.invalid"], unverified: ["shared@example.invalid"] });
    const gone = await account({ name: "Gone Person", slug: "gone-person", password: true, emails: ["gone-main@example.invalid", "shared@example.invalid"] });
    const [g, k] = [gone.id, kept.id];
    await run("UPDATE users SET avatar_key = 'gone-avatar', orcid = '0000-0002-1825-0097', mfa_all_methods = 1, affiliation = 'Gone Lab' WHERE id = ?", g);
    await run("UPDATE users SET affiliation = 'Kept Lab' WHERE id = ?", k);
    await run("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'github', ?)", g, `gh-${g}`);
    await run("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'google', ?)", g, `go-${g}`);
    await run("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'google', ?)", k, `go-${k}`);
    await totp(g, "GONESECRET");
    await code(g, "c1");
    await code(g, "c2");
    await passkey(g, `pk-${g}`);
    const spec = await spectrum(g, `merge-pub-${g}`);
    const draft = await spectrum(g, `merge-draft-${g}`, "draft");
    await run("INSERT INTO favourites (user_id, spectrum_id) VALUES (?, ?)", g, spec);
    await run("INSERT INTO favourites (user_id, spectrum_id) VALUES (?, ?)", g, draft);
    await run("INSERT INTO favourites (user_id, spectrum_id) VALUES (?, ?)", k, spec);
    await run("INSERT INTO draft_tokens (user_id, hash) VALUES (?, ?)", g, `draft-${g}`);
    await run("INSERT INTO submissions (spectrum_id, submitted_by, status, decided_by) VALUES (?, ?, 'approved', ?)", spec, g, g);
    await run("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, '{}')", spec, g);
    const inst = (await run("INSERT INTO instruments (name, created_by) VALUES ('Merge Instrument', ?)", g)).meta.last_row_id;
    await run("INSERT INTO instrument_versions (instrument_id, version, name, created_by, decided_by) VALUES (?, 1, 'v1', ?, ?)", inst, g, g);
    await run("INSERT INTO admin_actions (admin_id, user_id, action) VALUES (?, ?, 'profile_edited')", g, g);
    await run("INSERT INTO admin_actions (admin_id, user_id, action) VALUES (?, ?, 'role_changed')", a.id, g);
    await run("INSERT INTO site_settings (key, value, updated_by) VALUES (?, '1', ?)", `merge-test-${g}`, g);
    await run("INSERT INTO user_slug_history (slug, user_id) VALUES (?, ?)", `gone-older-${g}`, g);
    await run("INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?, ?, '2099-01-01')", `lc-${g}`, g);
    await run("INSERT INTO webauthn_challenges (token_hash, user_id, challenge, kind, expires_at) VALUES (?, ?, 'x', 'register', '2099-01-01')", `wc-${g}`, g);
    await run("INSERT INTO login_links (token_hash, email, expires_at) VALUES (?, 'gone-main@example.invalid', '2099-01-01')", `ll-${g}`);
    await run("INSERT INTO account_claims (token_hash, user_id, legacy_user_id, expires_at) VALUES (?, ?, ?, '2099-01-01')", `ac-${g}`, g, k);

    const res = await merge(k, g, a.cookie);
    expect(res.headers.get("location")).toBe(`/admin/users/${k}/?notice=merged`);

    expect(await row("SELECT 1 FROM users WHERE id = ?", g)).toBeNull();
    const columns = await referencing();
    expect(columns.length).toBeGreaterThan(20);
    for (const { tbl, col } of columns) {
      expect(await count(`SELECT 1 FROM ${tbl} WHERE ${col} = ?`, g), `${tbl}.${col}`).toBe(0);
    }
    expect(await count("SELECT 1 FROM login_links WHERE token_hash = ?", `ll-${g}`)).toBe(0);

    const u = (await row<any>("SELECT * FROM users WHERE id = ?", k))!;
    expect([u.display_name, u.affiliation, u.slug, u.password_hash, u.legacy_password_hash]).toEqual(["Kept Person", "Kept Lab", "kept-person", `pbkdf2$${k}`, `$P$B${k}`]);
    expect([u.avatar_key, u.orcid, u.mfa_all_methods]).toEqual(["gone-avatar", "0000-0002-1825-0097", 1]);

    expect((await all<any>("SELECT email, verified, is_primary FROM user_emails WHERE user_id = ? ORDER BY email", k)).map((e) => [e.email, e.verified, e.is_primary])).toEqual([
      ["gone-main@example.invalid", 1, 0],
      ["kept-only@example.invalid", 1, 0],
      ["shared@example.invalid", 1, 1],
    ]);
    expect((await all<any>("SELECT provider FROM identities WHERE user_id = ? ORDER BY provider", k)).map((i) => i.provider)).toEqual(["github", "google"]);
    expect(await row("SELECT subject FROM identities WHERE user_id = ? AND provider = 'google'", k)).toEqual({ subject: `go-${k}` });
    expect(await row("SELECT secret FROM user_totp WHERE user_id = ?", k)).toEqual({ secret: "GONESECRET" });
    expect(await count("SELECT 1 FROM recovery_codes WHERE user_id = ?", k)).toBe(2);
    expect(await count("SELECT 1 FROM passkeys WHERE user_id = ?", k)).toBe(1);

    expect((await all<any>("SELECT slug, owner_id, author_slug, author_display FROM spectra WHERE owner_id = ? ORDER BY slug", k)).map((s) => [s.owner_id, s.author_slug, s.author_display]))
      .toEqual([[k, "kept-person", "Kept Person"], [k, "kept-person", "Kept Person"]]);
    expect(await count("SELECT 1 FROM favourites WHERE user_id = ?", k)).toBe(2);
    expect(await count("SELECT 1 FROM draft_tokens WHERE user_id = ?", k)).toBe(1);
    expect(await row("SELECT submitted_by, decided_by FROM submissions WHERE spectrum_id = ?", spec)).toEqual({ submitted_by: k, decided_by: k });
    expect(await row("SELECT user_id FROM history WHERE spectrum_id = ?", spec)).toEqual({ user_id: k });
    expect(await row("SELECT created_by FROM instruments WHERE id = ?", inst)).toEqual({ created_by: k });
    expect(await row("SELECT created_by, decided_by FROM instrument_versions WHERE instrument_id = ?", inst)).toEqual({ created_by: k, decided_by: k });
    expect(await count("SELECT 1 FROM admin_actions WHERE admin_id = ? AND action = 'profile_edited'", k)).toBe(1);
    expect(await count("SELECT 1 FROM admin_actions WHERE user_id = ? AND action = 'role_changed'", k)).toBe(1);
    expect(await row("SELECT updated_by FROM site_settings WHERE key = ?", `merge-test-${g}`)).toEqual({ updated_by: k });
    expect((await all<any>("SELECT slug FROM user_slug_history WHERE user_id = ? ORDER BY slug", k)).map((h) => h.slug)).toEqual([`gone-older-${g}`, "gone-person"]);
    expect(await count("SELECT 1 FROM account_claims WHERE token_hash = ?", `ac-${g}`)).toBe(0);
  });

  it("keeps the kept account's own two-step and password, drops the others, and keeps every passkey", async () => {
    const a = await admin();
    const kept = await account({ name: "Protected Keeper", password: true });
    const gone = await account({ name: "Other Self", password: true });
    await totp(kept.id, "KEPTSECRET");
    await code(kept.id, "kept-code");
    await passkey(kept.id, `keep-${kept.id}`);
    await totp(gone.id, "GONESECRET");
    await code(gone.id, "gone-code");
    await passkey(gone.id, `drop-${gone.id}`);
    await run("UPDATE users SET avatar_key = 'keep-avatar' WHERE id = ?", kept.id);
    await run("UPDATE users SET avatar_key = 'drop-avatar' WHERE id = ?", gone.id);
    await merge(kept.id, gone.id, a.cookie);
    expect(await row("SELECT secret FROM user_totp WHERE user_id = ?", kept.id)).toEqual({ secret: "KEPTSECRET" });
    expect((await all<any>("SELECT code_hash FROM recovery_codes WHERE user_id = ?", kept.id)).map((r) => r.code_hash)).toEqual(["kept-code"]);
    expect((await all<any>("SELECT credential_id FROM passkeys WHERE user_id = ? ORDER BY credential_id", kept.id)).map((r) => r.credential_id)).toEqual([`drop-${gone.id}`, `keep-${kept.id}`].sort());
    expect(await row("SELECT password_hash, avatar_key FROM users WHERE id = ?", kept.id)).toEqual({ password_hash: `pbkdf2$${kept.id}`, avatar_key: "keep-avatar" });
  });

  it("replaces an authenticator set-up the kept account never confirmed", async () => {
    const a = await admin();
    const kept = await account({ name: "Half Set Up" });
    const gone = await account({ name: "Fully Set Up" });
    await totp(kept.id, "HALFSECRET", false);
    await code(kept.id, "stale-code");
    await totp(gone.id, "FULLSECRET");
    await code(gone.id, "fresh-code");
    await merge(kept.id, gone.id, a.cookie);
    expect(await row("SELECT secret, enabled_at FROM user_totp WHERE user_id = ?", kept.id)).toMatchObject({ secret: "FULLSECRET" });
    expect((await all<any>("SELECT code_hash FROM recovery_codes WHERE user_id = ?", kept.id)).map((r) => r.code_hash)).toEqual(["fresh-code"]);
  });

  it("gives the kept account the other's username when it has none, and redirects the old address otherwise", async () => {
    const a = await admin();
    const noName = await account({ name: "No Username" });
    const named = await account({ name: "Has Username Gone", slug: "merge-named-gone" });
    const named2 = await account({ name: "Redirect Target", slug: "merge-target" });
    const s1 = await spectrum(named.id, `slug-spec-${nextId}`);
    await merge(noName.id, named.id, a.cookie);
    expect(await row("SELECT slug FROM users WHERE id = ?", noName.id)).toEqual({ slug: "merge-named-gone" });
    expect(await count("SELECT 1 FROM user_slug_history WHERE slug = ?", "merge-named-gone")).toBe(0);
    expect(await row("SELECT author_slug FROM spectra WHERE id = ?", s1)).toEqual({ author_slug: "merge-named-gone" });

    const gone = await account({ name: "Will Redirect", slug: "merge-will-redirect" });
    await spectrum(gone.id, `redirect-spec-${nextId}`);
    await merge(named2.id, gone.id, a.cookie);
    const res = await go("/author/merge-will-redirect/");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/author/merge-target/");
  });

  it("emails both people and logs the merge on the kept account", async () => {
    const a = await admin();
    const kept = await account({ name: "Kept Mail" });
    const gone = await account({ name: "Gone Mail" });
    await merge(kept.id, gone.id, a.cookie);
    expect(mailTo(kept.email).at(-1)!.text).toContain('The account "Gone Mail" was merged into this one');
    expect(mailTo(kept.email).at(-1)!.text).not.toContain(a.id.toString());
    expect(mailTo(gone.email).at(-1)!.text).toContain('merged your account "Gone Mail" into the account "Kept Mail"');
    const entry = await row<any>("SELECT admin_id, details_json FROM admin_actions WHERE user_id = ? AND action = 'accounts_merged'", kept.id);
    expect(entry!.admin_id).toBe(a.id);
    expect(JSON.parse(entry!.details_json)).toEqual({ merged_id: gone.id, merged_name: "Gone Mail" });
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", gone.id)).toBe(0);
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", kept.id)).toBe(1);
  });

  it("sends no email to an account without a confirmed address, and still merges", async () => {
    const a = await admin();
    const kept = await account({ name: "Quiet Kept", verified: false });
    const gone = await account({ name: "Quiet Gone", verified: false });
    const before = sent.length;
    expect((await merge(kept.id, gone.id, a.cookie)).headers.get("location")).toContain("merged");
    expect(sent.length).toBe(before);
    expect(await row("SELECT 1 FROM users WHERE id = ?", gone.id)).toBeNull();
  });
});

describe("the merge pages and safety rules", () => {
  it("finds the other account and shows both side by side with what moves and what is dropped", async () => {
    const a = await admin();
    const kept = await account({ name: "Left Side", slug: "merge-left", password: true });
    const gone = await account({ name: "Zoltan Rightside", slug: "merge-right", role: "moderator" });
    await totp(gone.id, "S");
    await run("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'github', ?)", gone.id, `gh-${gone.id}`);
    await spectrum(gone.id, `side-spec-${gone.id}`);
    expect(await (await go(`/admin/users/${kept.id}/`, a.cookie)).text()).toContain("Merge another account into this one");
    const found = await (await go(`/admin/users/${kept.id}/merge/?q=zoltan`, a.cookie)).text();
    expect(found).toContain(`/admin/users/${kept.id}/merge/${gone.id}/`);
    expect(await (await go(`/admin/users/${kept.id}/merge/?q=${encodeURIComponent(a.id)}`, a.cookie)).text()).not.toContain(`/merge/${a.id}/`);
    const page = await (await go(`/admin/users/${kept.id}/merge/${gone.id}/`, a.cookie)).text();
    for (const text of ["Left Side", "Zoltan Rightside", gone.email, kept.email, "authenticator app", "moderator", "What moves", "What is dropped", "Authenticator app and recovery codes", "/author/merge-right/", "the role is not moved", "cannot be undone"]) {
      expect(page, text).toContain(text.replace(/&/g, "&amp;").replace(/"/g, "&quot;"));
    }
    expect(page).not.toContain("both_admins");
    expect(await row("SELECT 1 FROM users WHERE id = ?", gone.id)).not.toBeNull();
  });

  it("is for admins only", async () => {
    const mod = await admin("moderator");
    const kept = await account({ name: "Not Yours" });
    const gone = await account({ name: "Not Yours Either" });
    expect((await go(`/admin/users/${kept.id}/merge/${gone.id}/`, mod.cookie)).status).toBe(403);
    expect((await merge(kept.id, gone.id, mod.cookie)).status).toBe(403);
    expect((await go(`/admin/users/${kept.id}/merge/`, kept.cookie)).status).toBeGreaterThanOrEqual(302);
    expect(await row("SELECT 1 FROM users WHERE id = ?", gone.id)).not.toBeNull();
  });

  it("refuses one's own account on either side, the same account twice, and an old sign-in", async () => {
    const a = await admin();
    const other = await account({ name: "Somebody Else" });
    expect((await merge(a.id, other.id, a.cookie)).status).toBe(400);
    expect((await merge(other.id, a.id, a.cookie)).status).toBe(400);
    expect((await go(`/admin/users/${other.id}/merge/${a.id}/`, a.cookie)).status).toBe(400);
    expect((await merge(other.id, other.id, a.cookie)).status).toBe(400);
    expect((await go(`/admin/users/${a.id}/merge/${other.id}/`, a.cookie)).headers.get("location")).toBe("/account/settings/");
    expect(await row("SELECT 1 FROM users WHERE id = ?", a.id)).not.toBeNull();

    const stale = await account({ name: "Stale Target" });
    const gone = await account({ name: "Stale Gone" });
    await run("UPDATE sessions SET created_at = datetime('now', '-2 hours') WHERE id = ?", await sha256(a.cookie.split("=")[1]));
    expect((await merge(stale.id, gone.id, a.cookie)).headers.get("location")).toBe(`/admin/users/${stale.id}/?notice=stale`);
    expect(await row("SELECT 1 FROM users WHERE id = ?", gone.id)).not.toBeNull();
  });

  it("answers 404 for an account that does not exist", async () => {
    const a = await admin();
    const kept = await account({ name: "Real One" });
    expect((await go(`/admin/users/${kept.id}/merge/99999999/`, a.cookie)).status).toBe(404);
    expect((await merge(kept.id, 99999999, a.cookie)).status).toBe(404);
  });

  it("warns before merging two administrators and needs the box ticked", async () => {
    const a = await admin();
    const kept = await account({ name: "Admin One", role: "admin" });
    const gone = await account({ name: "Admin Two", role: "admin" });
    await totp(kept.id, "A");
    await totp(gone.id, "B");
    expect(await (await go(`/admin/users/${kept.id}/merge/${gone.id}/`, a.cookie)).text()).toContain('name="both_admins"');
    const refused = await merge(kept.id, gone.id, a.cookie);
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("Both accounts are administrators");
    expect(await row("SELECT 1 FROM users WHERE id = ?", gone.id)).not.toBeNull();
    expect((await merge(kept.id, gone.id, a.cookie, { both_admins: "1" })).headers.get("location")).toContain("merged");
    expect(await row("SELECT role FROM users WHERE id = ?", kept.id)).toEqual({ role: "admin" });
  });

  it("keeps the kept account's role when the other has a higher one", async () => {
    const a = await admin();
    const kept = await account({ name: "Plain User" });
    const gone = await account({ name: "Former Moderator", role: "moderator" });
    await merge(kept.id, gone.id, a.cookie);
    expect(await row("SELECT role FROM users WHERE id = ?", kept.id)).toEqual({ role: "user" });
  });

  it("rolls back as a whole if a statement fails", async () => {
    const kept = await account({ name: "Atomic Kept" });
    const gone = await account({ name: "Atomic Gone" });
    await spectrum(gone.id, `atomic-spec-${gone.id}`);
    await run("CREATE TRIGGER merge_fail BEFORE DELETE ON users WHEN OLD.id = " + gone.id + " BEGIN SELECT RAISE(ABORT, 'boom'); END");
    await expect(mergeAccounts(env.DB, gone.id, kept.id)).rejects.toThrow();
    await run("DROP TRIGGER merge_fail");
    expect(await count("SELECT 1 FROM spectra WHERE owner_id = ?", gone.id)).toBe(1);
    expect(await count("SELECT 1 FROM user_emails WHERE user_id = ?", gone.id)).toBe(1);
  });
});

describe("claiming an old account with the shared merge", () => {
  it("keeps passkeys, two-step, the password and draft tokens of the new account, and ends its sessions", async () => {
    const legacy = await account({ name: "Old Claimed", slug: "merge-old-claimed", emails: [`old${nextId}@example.invalid`], verified: false });
    const fresh = await account({ name: "New Claimer" });
    await run("UPDATE users SET password_hash = 'pbkdf2$new' WHERE id = ?", fresh.id);
    await totp(fresh.id, "NEWSECRET");
    await code(fresh.id, "new-code");
    await passkey(fresh.id, `claim-${fresh.id}`);
    const token = crypto.randomUUID();
    await run("INSERT INTO account_claims (token_hash, user_id, legacy_user_id, expires_at) VALUES (?, ?, ?, '2099-01-01')", await sha256(token), fresh.id, legacy.id);
    const res = await post(`/account/claim/${token}/`, fresh.cookie);
    expect(res.headers.get("location")).toBe("/login/second-step/");
    expect(await row("SELECT 1 FROM users WHERE id = ?", fresh.id)).toBeNull();
    expect(await row("SELECT secret FROM user_totp WHERE user_id = ?", legacy.id)).toEqual({ secret: "NEWSECRET" });
    expect(await count("SELECT 1 FROM recovery_codes WHERE user_id = ?", legacy.id)).toBe(1);
    expect(await count("SELECT 1 FROM passkeys WHERE user_id = ?", legacy.id)).toBe(1);
    expect(await row("SELECT password_hash FROM users WHERE id = ?", legacy.id)).toBeDefined();
    expect(await count("SELECT 1 FROM sessions WHERE user_id = ?", fresh.id)).toBe(0);
  });
});
