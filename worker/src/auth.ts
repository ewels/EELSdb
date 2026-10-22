import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SIGN_IN_METHODS, getSettings, twoStepRequired, type Settings, type SwitchableMethod } from "./settings";
import { hasTwoStep } from "./totp";

export type User = { id: number; display_name: string; role: string; slug: string | null; orcid: string | null; avatar: string | null; avatar_key?: string | null; theme: "system" | "light" | "dark"; needs_2fa?: boolean;
  /** An ordinary user (or a staff member acting as one) with no two-step sign-in while "all other users" must have it: every account page sends them to settings. */
  setup_required?: boolean;
  /** Set when ORCID sign-in is configured and the account has no linked ORCID: "required" while submitting needs one. */
  orcid_prompt?: "ask" | "required";
  /** ORCID is the only way to sign in that is on, so the banner cannot be hidden. */
  orcid_only?: boolean;
};
export type AppEnv = { Bindings: Env; Variables: { user: User | null } };
type C = Context<AppEnv>;

const SESSION_COOKIE = "eelsdb_session";
const STATE_COOKIE = "eelsdb_oauth";
export const CHALLENGE_COOKIE = "eelsdb_second_step";
export const CHALLENGE_MINUTES = 10;
/** Readable by script: the next signed-in page copies it into localStorage and deletes it (layout.tsx), so the login page can mark the last method. */
export const LAST_METHOD_COOKIE = "eelsdb_last_method";
const LAST_METHOD_SECONDS = 300;
const SESSION_DAYS = 30;
export const PENDING_COOKIE = "eelsdb_pending";
const PENDING_MINUTES = 15;

export type Identity = { provider: string; subject: string; name: string | null; email: string | null; emailVerified: boolean };

type Provider = {
  label: string;
  configured: (env: Env) => boolean;
  authorizeUrl: (env: Env, redirectUri: string, state: string) => string;
  identity: (env: Env, code: string, redirectUri: string) => Promise<Identity>;
};

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();

async function postToken(url: string, data: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form(data),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return res.json<Record<string, any>>();
}

const orcidBase = (env: Env) => env.ORCID_BASE || "https://orcid.org";

/** The first verified address the person made public on their ORCID record; any failure means no address, never a failed sign-in. */
async function orcidVerifiedEmail(env: Env, orcid: string, token: string | undefined): Promise<string | null> {
  try {
    const res = await fetch(`${orcidBase(env).replace("://", "://pub.")}/v3.0/${encodeURIComponent(orcid)}/email`, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = await res.json<{ email?: { email?: string; verified?: boolean; primary?: boolean }[] }>();
    const verified = (body.email ?? []).filter((e) => e.verified === true && typeof e.email === "string" && e.email.includes("@"));
    return (verified.find((e) => e.primary) ?? verified[0])?.email!.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export const PROVIDERS: Record<string, Provider> = {
  orcid: {
    label: "ORCID",
    configured: (env) => !!env.ORCID_CLIENT_ID,
    authorizeUrl: (env, redirect_uri, state) =>
      `${orcidBase(env)}/oauth/authorize?${form({ client_id: env.ORCID_CLIENT_ID!, response_type: "code", scope: "/authenticate", redirect_uri, state })}`,
    async identity(env, code, redirect_uri) {
      // ORCID returns the iD and name with the token; addresses need the public API.
      const t = await postToken(`${orcidBase(env)}/oauth/token`, {
        client_id: env.ORCID_CLIENT_ID!, client_secret: env.ORCID_CLIENT_SECRET!, grant_type: "authorization_code", code, redirect_uri,
      });
      const email = t.orcid ? await orcidVerifiedEmail(env, t.orcid, t.access_token) : null;
      return { provider: "orcid", subject: t.orcid, name: t.name || null, email, emailVerified: !!email };
    },
  },
  google: {
    label: "Google",
    configured: (env) => !!env.GOOGLE_CLIENT_ID,
    authorizeUrl: (env, redirect_uri, state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: env.GOOGLE_CLIENT_ID!, response_type: "code", scope: "openid email profile", redirect_uri, state })}`,
    async identity(env, code, redirect_uri) {
      const t = await postToken("https://oauth2.googleapis.com/token", {
        client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: "authorization_code", code, redirect_uri,
      });
      const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } });
      if (!res.ok) throw new Error(`userinfo failed (${res.status})`);
      const u = await res.json<Record<string, any>>();
      return { provider: "google", subject: u.sub, name: u.name ?? null, email: u.email ?? null, emailVerified: u.email_verified === true };
    },
  },
  github: {
    label: "GitHub",
    configured: (env) => !!env.GITHUB_CLIENT_ID,
    authorizeUrl: (env, redirect_uri, state) =>
      `https://github.com/login/oauth/authorize?${form({ client_id: env.GITHUB_CLIENT_ID!, scope: "read:user user:email", redirect_uri, state })}`,
    async identity(env, code, redirect_uri) {
      const t = await postToken("https://github.com/login/oauth/access_token", {
        client_id: env.GITHUB_CLIENT_ID!, client_secret: env.GITHUB_CLIENT_SECRET!, code, redirect_uri,
      });
      const headers = { Authorization: `Bearer ${t.access_token}`, "User-Agent": "EELSdb", Accept: "application/vnd.github+json" };
      const [user, emails] = await Promise.all([
        fetch("https://api.github.com/user", { headers }).then((r) => r.json<Record<string, any>>()),
        fetch("https://api.github.com/user/emails", { headers }).then((r) => (r.ok ? r.json<any[]>() : [])),
      ]);
      const primary = emails.find((e) => e.primary && e.verified);
      return {
        provider: "github",
        subject: String(user.id),
        name: user.name || user.login || null,
        email: primary?.email ?? null,
        emailVerified: !!primary,
      };
    },
  },
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cookieOptions = (c: C) => ({
  path: "/",
  httpOnly: true,
  secure: new URL(c.req.url).protocol === "https:",
  sameSite: "Lax" as const,
});

/** Sessions are stored by the SHA-256 of the cookie value, so a database read does not reveal live tokens. */
/**
 * The user's uploaded picture, else their Gravatar. Gravatar looks pictures up by the SHA-256 of the
 * address, so the address itself never reaches the page; `d=blank` lets the initial show through.
 */
export async function avatarUrl(key: string | null, email: string | null) {
  if (key) return `/avatars/${key}`;
  return email ? `https://gravatar.com/avatar/${await sha256(email.trim().toLowerCase())}?s=64&d=blank` : null;
}

/** Copies the addresses sign-in services and the old site know into the user's email list, and picks a primary if none. */
export async function syncEmails(db: D1Database, userId: number) {
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO user_emails (user_id, email, verified)
       SELECT user_id, lower(trim(email)), MAX(email_verified) FROM identities
       WHERE user_id = ? AND email IS NOT NULL AND trim(email) != '' GROUP BY lower(trim(email))`,
    ).bind(userId),
    db.prepare(
      `UPDATE user_emails SET verified = 1 WHERE user_id = ?1 AND verified = 0
       AND email IN (SELECT lower(trim(email)) FROM identities WHERE user_id = ?1 AND email_verified = 1)`,
    ).bind(userId),
    db.prepare(
      "INSERT OR IGNORE INTO user_emails (user_id, email) SELECT id, lower(trim(legacy_email)) FROM users WHERE id = ? AND trim(legacy_email) != ''",
    ).bind(userId),
    db.prepare(
      `UPDATE user_emails SET is_primary = 1 WHERE id = (SELECT id FROM user_emails WHERE user_id = ?1 ORDER BY verified DESC, id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = ?1 AND is_primary = 1)`,
    ).bind(userId),
  ]);
}

export async function createSession(c: C, userId: number) {
  await syncEmails(c.env.DB, userId);
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires.toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), expires });
}

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  let user: User | null = null;
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.display_name, u.role, u.slug, u.orcid, u.theme, u.avatar_key,
              (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email,
              (EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) OR EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)) AS has_2fa,
              EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = 'orcid') AS orcid_linked
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), new Date().toISOString())
      .first<Omit<User, "avatar"> & { email: string | null; has_2fa: number; orcid_linked: number }>();
    if (row) {
      const { email, has_2fa, orcid_linked, ...rest } = row;
      user = { ...rest, avatar: await avatarUrl(rest.avatar_key ?? null, email) };
      const settings = await getSettings(c.env.DB);
      if (!orcid_linked && PROVIDERS.orcid.configured(c.env)) {
        const on = methodsFrom(c.env, settings);
        // With ORCID sign-in switched off there is no way to link an iD, so nothing asks for one.
        if (on.includes("orcid")) {
          user.orcid_prompt = settings.require_orcid === "1" ? "required" : "ask";
          if (on.length === 1) user.orcid_only = true;
        }
      }
      // A moderator or admin whose group must use two-step sign-in, and has none, is an ordinary user everywhere until they set it up, so no
      // check that looks at the role can be reached without it.
      if (!has_2fa && twoStepRequired(settings, rest.role)) user = { ...user, role: "user", needs_2fa: true };
      if (!has_2fa && user.role === "user" && twoStepRequired(settings, "user")) user.setup_required = true;
    }
  }
  c.set("user", user);
  await next();
};

export const MAX_PASSWORD_FAILURES = 10;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
export const FRESH_SIGN_IN_MINUTES = 15;

/** Whether this session started recently, so sensitive changes can skip asking for the password again. */
export async function signedInRecently(c: C) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  const row = await c.env.DB.prepare("SELECT 1 FROM sessions WHERE id = ? AND created_at > datetime('now', ?)")
    .bind(await sha256(token), `-${FRESH_SIGN_IN_MINUTES} minutes`).first();
  return !!row;
}

export async function signOutOtherSessions(c: C, userId: number) {
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .bind(userId, await sha256(getCookie(c, SESSION_COOKIE) ?? "")).run();
}

export const signOutEverywhere = (db: D1Database, userId: number) => db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();

export async function signOut(c: C) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Sign-in methods that are switched on and, for a service, set up on this server. */
export const methodsFrom = (env: Env, s: Settings): SwitchableMethod[] =>
  SIGN_IN_METHODS.filter((m) => s[`signin_${m}`] === "1" && (!PROVIDERS[m] || PROVIDERS[m].configured(env)));
export const methodsOn = async (env: Env) => methodsFrom(env, await getSettings(env.DB));
export const methodOn = async (env: Env, method: string) => (await methodsOn(env)).includes(method as SwitchableMethod);
export const METHOD_OFF = "/login/?error=off";
const LINK_OFF = "/account/settings/?notice=link-off#h-signin";

/** SQL that is true when account `u` can take this first step. Shared by the lock-out guard and the admin count, so both agree. */
export function wayInSql(method: SwitchableMethod, env: Env) {
  switch (method) {
    case "passkey":
      return "EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)";
    case "password":
      return env.LEGACY_PASSWORD_LOGIN === "1" ? "(u.password_hash IS NOT NULL OR u.legacy_password_hash IS NOT NULL)" : "u.password_hash IS NOT NULL";
    case "email_link":
      // An unclaimed old account is reached through its old address (see accountForEmail).
      return `(EXISTS (SELECT 1 FROM user_emails e WHERE e.user_id = u.id AND e.verified = 1)
        OR (trim(COALESCE(u.legacy_email, '')) != '' AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id)))`;
    default:
      return `EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = '${method}')`;
  }
}

/** How many accounts (or whether this one, with `userId`) would have none of these methods to sign in with. */
export async function accountsLockedOut(env: Env, methods: SwitchableMethod[], userId?: number) {
  const any = methods.length ? methods.map((m) => wayInSql(m, env)).join(" OR ") : "0";
  const sql = `SELECT COUNT(*) AS n FROM users u WHERE NOT (${any})${userId === undefined ? "" : " AND u.id = ?"}`;
  const stmt = env.DB.prepare(sql);
  return (await (userId === undefined ? stmt : stmt.bind(userId)).first<number>("n")) ?? 0;
}

/** Redirect to the provider, remembering a random state (and where to return) in a short-lived cookie. */
export async function startSignIn(c: C) {
  const provider = PROVIDERS[c.req.param("provider")!];
  if (!provider || !provider.configured(c.env)) return c.notFound();
  if (!(await methodOn(c.env, c.req.param("provider")!))) return c.redirect(METHOD_OFF);
  const state = randomToken();
  const next = safeNext(c.req.query("next"));
  setCookie(c, STATE_COOKIE, `${state}|${next}`, { ...cookieOptions(c), maxAge: 600 });
  return c.redirect(provider.authorizeUrl(c.env, callbackUrl(c), state));
}

/** Like `startSignIn`, but the callback adds the service to the signed-in account. The registered callback URLs stay the same. */
export async function startLink(c: C) {
  const provider = PROVIDERS[c.req.param("provider")!];
  if (!provider || !provider.configured(c.env)) return c.notFound();
  if (!(await methodOn(c.env, c.req.param("provider")!))) return c.redirect(LINK_OFF);
  const state = randomToken();
  const next = safeNext(c.req.query("next"));
  setCookie(c, STATE_COOKIE, `${state}|${next}|link`, { ...cookieOptions(c), maxAge: 600 });
  return c.redirect(provider.authorizeUrl(c.env, callbackUrl(c), state));
}

const callbackUrl = (c: C) => `${new URL(c.req.url).origin}/auth/${c.req.param("provider")}/callback`;

/** Only same-site paths, so the sign-in flow cannot be used as an open redirect. */
export function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/")) return "/account/";
  const base = "https://same.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : "/account/";
  } catch {
    return "/account/";
  }
}

/** The account that verified this address, else a migrated account with this `legacy_email` that no one has claimed. */
export async function accountForEmail(db: D1Database, email: string): Promise<number | null> {
  const address = email.trim();
  const verified = await db.prepare("SELECT user_id FROM user_emails WHERE email = ? AND verified = 1").bind(address).first<number>("user_id");
  if (verified !== null) return verified;
  return db
    .prepare(
      `SELECT u.id FROM users u WHERE u.legacy_email = ? COLLATE NOCASE
       AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id) ORDER BY u.id LIMIT 1`,
    )
    .bind(address)
    .first<number>("id");
}

/**
 * Finds the user for an identity: an existing link, else the account that verified this email, else a migrated
 * account with the same email that no one has claimed. Null when nothing matches.
 */
export async function findUserForIdentity(db: D1Database, id: Identity): Promise<number | null> {
  const linked = await db.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").bind(id.provider, id.subject).first<number>("user_id");
  if (linked !== null) return linked;
  const userId = id.email && id.emailVerified ? await accountForEmail(db, id.email) : null;
  if (userId !== null) await addIdentity(db, userId, id);
  return userId;
}

export async function createUserForIdentity(db: D1Database, id: Identity): Promise<number> {
  const userId = (await db
    .prepare("INSERT INTO users (display_name, orcid) VALUES (?, ?) RETURNING id")
    .bind(id.name || id.email?.split("@")[0] || "EELSdb user", id.provider === "orcid" ? id.subject : null)
    .first<number>("id"))!;
  await addIdentity(db, userId, id);
  return userId;
}

async function addIdentity(db: D1Database, userId: number, id: Identity) {
  await db
    .prepare("INSERT INTO identities (user_id, provider, subject, email, email_verified) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, id.provider, id.subject, id.email, id.emailVerified ? 1 : 0)
    .run();
  if (id.provider === "orcid") await db.prepare("UPDATE users SET orcid = COALESCE(orcid, ?) WHERE id = ?").bind(id.subject, userId).run();
}

/** Adds the identity to this account. Returns where to go: `next`, or settings with a notice when nothing was changed. */
export async function linkIdentity(db: D1Database, userId: number, id: Identity, next: string | undefined) {
  const owner = await db.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").bind(id.provider, id.subject).first<number>("user_id");
  if (owner !== null && owner !== userId) return "/account/settings/?notice=link-taken#h-signin";
  const other = await db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = ? AND subject != ?").bind(userId, id.provider, id.subject).first();
  if (other) return "/account/settings/?notice=link-has#h-signin";
  if (owner === null) {
    await db.prepare("INSERT INTO identities (user_id, provider, subject, email, email_verified) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, id.provider, id.subject, id.email, id.emailVerified ? 1 : 0).run();
  }
  // The verified iD replaces one typed in or migrated from the old site.
  if (id.provider === "orcid") await db.prepare("UPDATE users SET orcid = ? WHERE id = ?").bind(id.subject, userId).run();
  return safeNext(next);
}

export type SignInMethod = "orcid" | "google" | "github" | "email_link" | "password" | "claim" | "passkey";

/** Only the methods the login page offers; a claim happens while signed in, so the method used before it stays. */
const SHOWN_METHODS: string[] = ["orcid", "google", "github", "email_link", "password", "passkey"];

export function rememberMethod(c: C, method: string | undefined, maxAge = LAST_METHOD_SECONDS) {
  if (method && SHOWN_METHODS.includes(method)) setCookie(c, LAST_METHOD_COOKIE, method, { ...cookieOptions(c), httpOnly: false, maxAge });
}

const FIRST_STEP_ALWAYS_ASKS: SignInMethod[] = ["email_link", "password", "claim"];

/**
 * The one way to finish a sign-in: every first step calls this, so the second-step check cannot be skipped.
 * A second step is asked when the account has two-step sign-in on and the first step was an email link or a password
 * (or a claim, which is an email link for the old account), or the account asked for it after ORCID, Google and
 * GitHub too, or the site requires two-step sign-in for the account's group. A passkey is already two factors, so it never asks.
 */
export async function completeSignIn(c: C, userId: number, { method, next }: { method: SignInMethod; next?: string }) {
  const db = c.env.DB;
  if (method !== "claim" && !(await methodOn(c.env, method))) return c.redirect(METHOD_OFF);
  if (method !== "passkey" && (await hasTwoStep(db, userId))) {
    const account = await db.prepare("SELECT role, mfa_all_methods FROM users WHERE id = ?").bind(userId).first<{ role: string; mfa_all_methods: number }>();
    if (FIRST_STEP_ALWAYS_ASKS.includes(method) || account?.mfa_all_methods || twoStepRequired(await getSettings(db), account?.role ?? "user")) {
      const token = randomToken();
      await db.prepare("INSERT INTO login_challenges (token_hash, user_id, next, expires_at) VALUES (?, ?, ?, ?)")
        .bind(await sha256(token), userId, safeNext(next), new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString()).run();
      setCookie(c, CHALLENGE_COOKIE, token, { ...cookieOptions(c), maxAge: CHALLENGE_MINUTES * 60 });
      // Pages without a session never copy it, so it waits for the second step to finish.
      rememberMethod(c, method, CHALLENGE_MINUTES * 60);
      return c.redirect("/login/second-step/");
    }
  }
  await createSession(c, userId);
  rememberMethod(c, method);
  if (method !== "claim") {
    const linked = await linkPendingIdentity(c, userId);
    if (linked) return c.redirect(linked);
  }
  return c.redirect(safeNext(next));
}

export type PendingIdentity = Identity & { next: string | null };

/** The identity waiting for the person's answer on the welcome page, if the cookie is valid and unexpired. */
export async function getPendingIdentity(c: C): Promise<PendingIdentity | null> {
  const token = getCookie(c, PENDING_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT provider, subject, name, email, email_verified, next FROM pending_identities WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), new Date().toISOString()).first<Omit<PendingIdentity, "emailVerified"> & { email_verified: number }>();
  if (!row) return null;
  const { email_verified, ...rest } = row;
  return { ...rest, emailVerified: email_verified === 1 };
}

export async function clearPendingIdentity(c: C) {
  const token = getCookie(c, PENDING_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM pending_identities WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, PENDING_COOKIE, { path: "/" });
}

async function keepPendingIdentity(c: C, id: Identity, next: string | undefined) {
  const db = c.env.DB;
  await clearPendingIdentity(c);
  await db.prepare("DELETE FROM pending_identities WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  const token = randomToken();
  await db.prepare("INSERT INTO pending_identities (token_hash, provider, subject, name, email, email_verified, next, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), id.provider, id.subject, id.name, id.email, id.emailVerified ? 1 : 0, safeNext(next), new Date(Date.now() + PENDING_MINUTES * 60_000).toISOString()).run();
  setCookie(c, PENDING_COOKIE, token, { ...cookieOptions(c), maxAge: PENDING_MINUTES * 60 });
}

/**
 * Called once a sign-in is complete (after any second step): adds the identity the person chose "Yes" for to the
 * account they signed in to, with the refusals of the settings link flow. Returns where to go, or null when nothing was pending.
 */
export async function linkPendingIdentity(c: C, userId: number): Promise<string | null> {
  const pending = await getPendingIdentity(c);
  if (!pending) return null;
  await clearPendingIdentity(c);
  const done = `/account/settings/?notice=linked-${pending.provider}#h-signin`;
  return linkIdentity(c.env.DB, userId, pending, done);
}

export async function finishSignIn(c: C) {
  const provider = PROVIDERS[c.req.param("provider")!];
  const [state, next, mode] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
  const linking = mode === "link";
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  const code = c.req.query("code");
  if (!provider || !provider.configured(c.env) || !code || !state || state !== c.req.query("state")) {
    return c.redirect(linking ? "/account/settings/?notice=link-failed#h-signin" : "/login/?error=state");
  }
  if (!(await methodOn(c.env, c.req.param("provider")!))) return c.redirect(linking ? LINK_OFF : METHOD_OFF);
  let identity: Identity;
  try {
    identity = await provider.identity(c.env, code, callbackUrl(c));
  } catch {
    return c.redirect(linking ? "/account/settings/?notice=link-failed#h-signin" : "/login/?error=provider");
  }
  if (!identity.subject) return c.redirect(linking ? "/account/settings/?notice=link-failed#h-signin" : "/login/?error=provider");
  if (linking) {
    const user = c.get("user");
    if (!user) return c.redirect("/login/?error=state");
    return c.redirect(await linkIdentity(c.env.DB, user.id, identity, next));
  }
  const userId = await findUserForIdentity(c.env.DB, identity);
  if (userId === null) {
    await keepPendingIdentity(c, identity, next);
    return c.redirect("/login/welcome/");
  }
  return completeSignIn(c, userId, { method: c.req.param("provider") as SignInMethod, next });
}

/** What a user who must set up two-step sign-in can still reach: the settings page, its two-step and passkey parts. */
// Confirming an address only proves it is theirs, so it need not wait for two-step set-up.
const SET_UP_PATHS = /^\/account\/(?:settings\/(?:$|two-step\/|passkeys\/)|emails\/verify\/)/;

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  const path = new URL(c.req.url).pathname;
  if (!user) return c.redirect(`/login/?next=${encodeURIComponent(path)}`);
  if (user.setup_required && !SET_UP_PATHS.test(path)) return c.redirect("/account/settings/?notice=two-step-required#h-two-step");
  await next();
};
