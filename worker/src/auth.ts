import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export type User = { id: number; display_name: string; role: string; slug: string | null; orcid: string | null; avatar: string | null; avatar_key?: string | null; theme: "system" | "light" | "dark" };
export type AppEnv = { Bindings: Env; Variables: { user: User | null } };
type C = Context<AppEnv>;

const SESSION_COOKIE = "eelsdb_session";
const STATE_COOKIE = "eelsdb_oauth";
const SESSION_DAYS = 30;

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

export const PROVIDERS: Record<string, Provider> = {
  orcid: {
    label: "ORCID",
    configured: (env) => !!env.ORCID_CLIENT_ID,
    authorizeUrl: (env, redirect_uri, state) =>
      `${orcidBase(env)}/oauth/authorize?${form({ client_id: env.ORCID_CLIENT_ID!, response_type: "code", scope: "/authenticate", redirect_uri, state })}`,
    async identity(env, code, redirect_uri) {
      // ORCID returns the iD and name with the token; it rarely shares an email.
      const t = await postToken(`${orcidBase(env)}/oauth/token`, {
        client_id: env.ORCID_CLIENT_ID!, client_secret: env.ORCID_CLIENT_SECRET!, grant_type: "authorization_code", code, redirect_uri,
      });
      return { provider: "orcid", subject: t.orcid, name: t.name || null, email: null, emailVerified: false };
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
              (SELECT e.email FROM user_emails e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.verified DESC, e.id LIMIT 1) AS email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), new Date().toISOString())
      .first<Omit<User, "avatar"> & { email: string | null }>();
    if (row) {
      const { email, ...rest } = row;
      user = { ...rest, avatar: await avatarUrl(rest.avatar_key ?? null, email) };
    }
  }
  c.set("user", user);
  await next();
};

export async function signOut(c: C) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Redirect to the provider, remembering a random state (and where to return) in a short-lived cookie. */
export function startSignIn(c: C) {
  const provider = PROVIDERS[c.req.param("provider")!];
  if (!provider || !provider.configured(c.env)) return c.notFound();
  const state = randomToken();
  const next = safeNext(c.req.query("next"));
  setCookie(c, STATE_COOKIE, `${state}|${next}`, { ...cookieOptions(c), maxAge: 600 });
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

/**
 * Finds the user for an identity: an existing link, else the account that verified this email, else a migrated
 * account with the same email that no one has claimed, else a new account.
 */
export async function userForIdentity(db: D1Database, id: Identity): Promise<number> {
  const linked = await db.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").bind(id.provider, id.subject).first<number>("user_id");
  if (linked !== null) return linked;

  let userId: number | null = null;
  if (id.email && id.emailVerified) {
    userId = await db.prepare("SELECT user_id FROM user_emails WHERE email = ? AND verified = 1").bind(id.email.trim()).first<number>("user_id");
  }
  if (userId === null && id.email && id.emailVerified) {
    userId = await db
      .prepare(
        `SELECT u.id FROM users u WHERE u.legacy_email = ? COLLATE NOCASE
         AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id) ORDER BY u.id LIMIT 1`,
      )
      .bind(id.email)
      .first<number>("id");
  }
  if (userId === null) {
    userId = (await db
      .prepare("INSERT INTO users (display_name, orcid) VALUES (?, ?) RETURNING id")
      .bind(id.name || id.email?.split("@")[0] || "EELSdb user", id.provider === "orcid" ? id.subject : null)
      .first<number>("id"))!;
  }
  await db
    .prepare("INSERT INTO identities (user_id, provider, subject, email, email_verified) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, id.provider, id.subject, id.email, id.emailVerified ? 1 : 0)
    .run();
  if (id.provider === "orcid") await db.prepare("UPDATE users SET orcid = COALESCE(orcid, ?) WHERE id = ?").bind(id.subject, userId).run();
  return userId;
}

export async function finishSignIn(c: C) {
  const provider = PROVIDERS[c.req.param("provider")!];
  const [state, next] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  const code = c.req.query("code");
  if (!provider || !provider.configured(c.env) || !code || !state || state !== c.req.query("state")) {
    return c.redirect("/login/?error=state");
  }
  let identity: Identity;
  try {
    identity = await provider.identity(c.env, code, callbackUrl(c));
  } catch {
    return c.redirect("/login/?error=provider");
  }
  if (!identity.subject) return c.redirect("/login/?error=provider");
  await createSession(c, await userForIdentity(c.env.DB, identity));
  return c.redirect(safeNext(next));
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.redirect(`/login/?next=${encodeURIComponent(new URL(c.req.url).pathname)}`);
  await next();
};
