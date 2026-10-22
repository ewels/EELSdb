import { Hono, type Context } from "hono";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { deleteCookie, getCookie } from "hono/cookie";
import { CHALLENGE_COOKIE, LAST_METHOD_COOKIE, MAX_PASSWORD_FAILURES, METHOD_OFF, MAX_PASSWORD_LENGTH, PROVIDERS, accountForEmail, clearPendingIdentity, completeSignIn, createSession, createUserForIdentity, findUserForIdentity, finishSignIn, getPendingIdentity, linkPendingIdentity, methodOn, methodsOn, rememberMethod, requireUser, safeNext, sha256, signOut, startLink, startSignIn, type AppEnv, type SignInMethod, type User } from "../auth";
import { addEmail } from "../account-edit";
import { sendEmail } from "../email";
import { mergeAccounts } from "../merge";
import { authenticationOptions, hasPasskey, verifyPasskey } from "../passkeys";
import { pbkdf2Hash, verifyLegacyPassword } from "../legacy-password";
import { spendCode } from "../totp";
import { AccountLayout, Avatar, Formula, Layout, TypeBadge, accountSummary } from "./layout";

export const account = new Hono<AppEnv>();

const ERRORS: Record<string, string> = {
  state: "The sign-in took too long or was started in another tab. Please try again.",
  provider: "The sign-in service did not confirm who you are. Please try again, or use another service.",
  password: "That email or username and password do not match. If you forgot your password, ask for a sign-in link instead.",
  locked: "Too many wrong passwords for this account. Please wait an hour, or ask for a sign-in link.",
  "second-step-locked": "Too many wrong codes for this account. Please wait an hour.",
  "second-step": "The second step took too long or went wrong too many times. Please sign in again.",
  off: "That way of signing in is switched off on this site. Please use another.",
};
const PASSKEY_OFF = "Passkey sign-in is switched off on this site. Please use another way.";
const MAX_CHALLENGE_ATTEMPTS = 5;
const CLAIM_HOURS = 24;
const LINK_MINUTES = 15;
const MAX_LINKS_PER_ADDRESS = 5;
const MAX_LINKS_PER_IP = 30;
const MAX_CLAIMS_PER_DAY = 5;

// Brand marks, drawn as each service asks: Google's G in its own colours on a neutral button, GitHub's mark in the text colour, ORCID's iD in its green.
const MARKS: Record<string, string> = {
  orcid: `<svg viewBox="0 0 256 256" aria-hidden="true"><circle cx="128" cy="128" r="128" fill="#A6CE39"/><g fill="#fff"><path d="M86.3 186.2H70.9V79.1h15.4v107.1zM108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7C191.7 111.2 178 93 148 93h-23.7v79.4zM88.7 56.8c0 5.5-4.5 10.1-10.1 10.1s-10.1-4.6-10.1-10.1c0-5.6 4.5-10.1 10.1-10.1s10.1 4.6 10.1 10.1z"/></g></svg>`,
  google: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
  github: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>`,
  passkey: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="10" r="3.5"/><path d="M10 10h7.5M15 10v2.5M17.5 10v2"/></svg>`,
};

// Marks the method this browser last signed in with (copied from a cookie by the layout). Runs before paint, so nothing jumps.
// Fills never change, so ORCID stays the one primary; the last method gets the tag and an accent border.
const LAST_USED_SCRIPT = `(function(){try{var m=localStorage.getItem("signin-method")||"",el=/^[a-z_]+$/.test(m)&&document.querySelector('.auth [data-method="'+m+'"]');if(!el||(m==="passkey"&&!window.PublicKeyCredential))return;var t=document.createElement("span");t.className="last-used";t.textContent="Last used";if(el.tagName==="DETAILS"){el.open=true;el.querySelector("summary").append(t)}else{el.append(t);el.classList.add("is-last")}}catch(e){}})()`;

const METHOD_NAMES: Record<string, string> = { email_link: "an email link", password: "a password", passkey: "a passkey" };
const listOr = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items[0] ?? "");

function AuthPage(props: { title: string; status?: number; aside?: Child; children: Child; script?: boolean; user?: User }) {
  return (
    <Layout title={props.title} path="/login/" user={props.user ?? null}>
      <div class="auth">
        <div class="auth-panel">{props.children}</div>
        {props.aside}
      </div>
      {props.script && <script src="/passkeys.js" type="module"></script>}
    </Layout>
  );
}

const Or = () => <p class="auth-or" aria-hidden="true">or</p>;

account.get("/login/", async (c) => {
  if (c.get("user")) return c.redirect(safeNext(c.req.query("next")));
  const next = c.req.query("next");
  const pending = c.req.query("notice") === "link" ? await getPendingIdentity(c) : null;
  if (c.req.query("notice") === "sent") {
    return c.html(
      <AuthPage title="Check your email">
        <h1>Check your email</h1>
        <p class="auth-lede">If the address is valid, a sign-in link is on its way. Open it in the browser where you want to be signed in.</p>
        <p class="hint">The link works for {LINK_MINUTES} minutes, once. No email after a few minutes? Check your spam folder, or <a href="/login/">try again</a>.</p>
      </AuthPage>,
    );
  }
  const on = await methodsOn(c.env);
  const has = (m: string) => on.includes(m as (typeof on)[number]);
  const services = (["orcid", "google", "github"] as const).filter(has);
  const errorKey = c.req.query("error") ?? "";
  const error = ERRORS[errorKey];
  const passwordOpen = errorKey === "password" || errorKey === "locked";
  const nextField = next && <input type="hidden" name="next" value={next} />;
  const top = services.length > 0 || has("passkey");
  const bottom = has("email_link") || has("password");
  const startUrl = (key: string) => `/auth/${key}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return c.html(
    <AuthPage
      title="Sign in"
      script={has("passkey")}
      aside={
        <section class="auth-note" aria-labelledby="h-old-site">
          <h2 id="h-old-site">Had an account on the old site?</h2>
          {bottom ? (
            <p>
              Sign in with its email address or username, and its favourites and spectra come with you. Signed in with ORCID or another address?
              Claim the old account from your account page.
            </p>
          ) : (
            <p>Sign in, then claim the old account from your account page. We email a link to its address, and its favourites and spectra come with you.</p>
          )}
        </section>
      }
    >
      <h1>Sign in</h1>
      <p class="auth-lede">Share spectra and keep favourites. New here? Your first sign-in makes your account.</p>
      {error && <p class="notice error-summary" role="alert">{error}</p>}
      {pending && (
        <p class="notice" role="status">
          Sign in your usual way, and we will link your {PROVIDERS[pending.provider]?.label ?? pending.provider} account to that account.
        </p>
      )}
      {!on.length && <p class="notice" role="status">Signing in is not possible right now. Please <a href="/contact/">contact us</a>.</p>}
      {top && (
        <div class="auth-alt">
          {has("orcid") && (
            <>
              <a class="button" data-method="orcid" href={startUrl("orcid")}>{raw(MARKS.orcid)}Continue with ORCID</a>
              <p class="hint auth-why">EELSdb credits contributors by their ORCID iD.</p>
            </>
          )}
          {services.filter((k) => k !== "orcid").map((key) => (
            <a class="button secondary" data-method={key} href={startUrl(key)}>{raw(MARKS[key])}Continue with {PROVIDERS[key].label}</a>
          ))}
          {has("passkey") && (
            <>
              <p class="notice error-summary" id="passkey-error" role="alert" hidden></p>
              <button class="button secondary" type="button" id="passkey-sign-in" data-method="passkey" hidden>
                {raw(MARKS.passkey)}Sign in with a passkey
              </button>
            </>
          )}
        </div>
      )}
      {!Object.values(PROVIDERS).some((p) => p.configured(c.env)) && (
        <p class="hint">ORCID, Google and GitHub sign-in are not set up on this server (no OAuth client IDs in its settings).</p>
      )}
      {top && bottom && <Or />}
      {has("email_link") && (
        <form method="post" action="/login/email/" class="auth-form">
          {nextField}
          <div class="field">
            <label for="email">Email address</label>
            <input id="email" name="email" type="email" autocomplete={has("passkey") ? "username webauthn" : "username"} required aria-describedby="email-hint" />
          </div>
          {/* Primary only when there is no ORCID button above. */}
          <button class={has("orcid") || passwordOpen ? "button secondary" : "button"} type="submit" data-method="email_link">Email me a sign-in link</button>
          <p class="hint" id="email-hint">We email you a link that signs you in. No password needed.</p>
        </form>
      )}
      {has("password") && (
        <details class="auth-password" open={passwordOpen} data-method="password">
          <summary>Sign in with a password</summary>
          <form method="post" action="/login/password/" class="auth-form">
            {nextField}
            <div class="field">
              <label for="login">Email address or username</label>
              <input
                id="login" name="login" type="text" autocomplete={!has("email_link") && has("passkey") ? "username webauthn" : "username"}
                autocapitalize="off" spellcheck={false} required
              />
            </div>
            <div class="field">
              <div class="label-row">
                <label for="password">Password</label>
                {has("email_link") && <a href="#email">Forgot your password?</a>}
              </div>
              <input id="password" name="password" type="password" autocomplete="current-password" required />
            </div>
            <button class="button" type="submit">Sign in</button>
          </form>
        </details>
      )}
      <script>{raw(LAST_USED_SCRIPT)}</script>
    </AuthPage>,
  );
});

account.get("/login/welcome/", async (c) => {
  if (c.get("user")) return c.redirect("/account/");
  const pending = await getPendingIdentity(c);
  if (!pending) return c.redirect("/login/?error=state");
  const on = await methodsOn(c.env);
  if (!on.includes(pending.provider as (typeof on)[number])) return c.redirect(METHOD_OFF);
  const label = PROVIDERS[pending.provider]?.label ?? pending.provider;
  const others = on.filter((m) => m !== pending.provider).map((m) => METHOD_NAMES[m] ?? PROVIDERS[m].label);
  const said = pending.name ? <>{label} says you are <strong>{pending.name}</strong>. </> : null;
  return c.html(
    <AuthPage title="Welcome">
      <h1>Welcome to EELSdb</h1>
      {others.length ? (
        <>
          <p class="auth-lede">{said}Have you signed in here before, with {listOr(others)}?</p>
          <div class="auth-alt">
            <a class="button" href="/login/?notice=link">Yes, sign in to my account</a>
            <form method="post" action="/login/welcome/">
              <button class="button secondary" type="submit">No, create a new account</button>
            </form>
          </div>
          <p class="hint auth-restart">This stops a second account being made for you. If you say yes, we link {label} to the account you sign in to.</p>
        </>
      ) : (
        <>
          <p class="auth-lede">
            {said}If you used EELSdb before with another sign-in, create this account and <a href="/contact/">ask us to merge them</a>.
          </p>
          <form method="post" action="/login/welcome/">
            <button class="button auth-wide" type="submit">Create my account</button>
          </form>
        </>
      )}
    </AuthPage>,
  );
});

account.post("/login/welcome/", async (c) => {
  const pending = await getPendingIdentity(c);
  if (!pending) return c.redirect("/login/?error=state");
  await clearPendingIdentity(c);
  if (!(await methodOn(c.env, pending.provider))) return c.redirect(METHOD_OFF);
  // Another tab may have linked this identity since; then it signs in to that account instead of making a second one.
  const found = await findUserForIdentity(c.env.DB, pending);
  const userId = found ?? (await createUserForIdentity(c.env.DB, pending));
  // A new account whose service shared no confirmed address goes to the email step first, then on; it rides in `next`, so a second step keeps the order.
  const askEmail = found === null && !(pending.email && pending.emailVerified);
  const next = askEmail ? `${EMAIL_STEP}?next=${encodeURIComponent(safeNext(pending.next ?? undefined))}` : pending.next ?? undefined;
  return completeSignIn(c, userId, { method: pending.provider as SignInMethod, next });
});

const EMAIL_STEP = "/account/welcome/email/";

function EmailStep(props: { user: User; next: string; error?: string; sent?: string }) {
  return (
    <AuthPage title={props.sent ? "Check your email" : "Add your email address"} user={props.user}>
      {props.sent ? (
        <>
          <h1>Check your email</h1>
          <p class="auth-lede">We sent a confirmation link to <strong>{props.sent}</strong>. Open it in this browser to confirm the address.</p>
          <a class="button auth-wide" href={props.next}>Continue</a>
        </>
      ) : (
        <>
          <h1>One more step: add your email address</h1>
          <p class="auth-lede">We use it for sign-in links, emails about your submissions, and getting you back into your account.</p>
          {props.error && <p class="notice error-summary" role="alert">{props.error}</p>}
          <form method="post" action={EMAIL_STEP} class="auth-form">
            <input type="hidden" name="next" value={props.next} />
            <div class="field">
              <label for="email">Email address</label>
              <input id="email" name="email" type="email" autocomplete="email" required aria-invalid={props.error ? "true" : undefined} />
            </div>
            <button class="button" type="submit">Send confirmation link</button>
          </form>
        </>
      )}
    </AuthPage>
  );
}

account.get("/account/welcome/email/", requireUser, (c) => c.html(<EmailStep user={c.get("user")!} next={safeNext(c.req.query("next"))} />));

account.post("/account/welcome/email/", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const next = safeNext(typeof body.next === "string" ? body.next : undefined);
  const intro = `Someone signed in to the EELS Data Base as "${user.display_name}" and added this address.`;
  const result = await addEmail(c.env, new URL(c.req.url).origin, user.id, body.email, intro);
  if (result === "email-bad") return c.html(<EmailStep user={user} next={next} error="That does not look like an email address." />, 422);
  if (result === "limit") return c.html(<EmailStep user={user} next={next} error="Too many addresses added today. Please try again tomorrow." />, 429);
  return c.html(<EmailStep user={user} next={next} sent={String(body.email).trim().toLowerCase()} />);
});

/** Makes a one-use link and emails it; the token only ever reaches the address. */
export async function sendLoginLink(env: Env, origin: string, email: string, next: string | null) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO login_links (token_hash, email, next, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), email, next, new Date(Date.now() + LINK_MINUTES * 60_000).toISOString()).run();
  await sendEmail(env, {
    to: email,
    subject: "Your EELS Data Base sign-in link",
    text: `Open this link to sign in. It works for ${LINK_MINUTES} minutes and only once:\n${origin}/login/email/${token}/`,
  });
}

const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

account.post("/login/email/", async (c) => {
  if (!(await methodOn(c.env, "email_link"))) return c.redirect(METHOD_OFF);
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim().toLowerCase();
  const next = safeNext(typeof body.next === "string" ? body.next : undefined);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const count = (kind: string, key: string) =>
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = ? AND key = ? AND at > datetime('now', '-1 hour')").bind(kind, key).first<number>("n");
  // The answer is the same whether or not a link was sent, so neither the limits nor the address give anything away.
  if (validEmail(email) && ((await count("login_email", email)) ?? 0) < MAX_LINKS_PER_ADDRESS && ((await count("login_email_ip", ip)) ?? 0) < MAX_LINKS_PER_IP) {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('login_email', ?)").bind(email),
      c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('login_email_ip', ?)").bind(ip),
    ]);
    await sendLoginLink(c.env, new URL(c.req.url).origin, email, next);
  }
  return c.redirect("/login/?notice=sent");
});

type LoginLink = { email: string; next: string | null; expires_at: string; used_at: string | null };
const findLink = async (c: any): Promise<LoginLink | null> =>
  c.env.DB.prepare("SELECT email, next, expires_at, used_at FROM login_links WHERE token_hash = ?").bind(await sha256(c.req.param("token"))).first();

account.get("/login/email/:token/", async (c) => {
  if (!(await methodOn(c.env, "email_link"))) {
    return c.html(
      <AuthPage title="Email links are off">
        <h1>Email links are switched off</h1>
        <p class="auth-lede">This site no longer signs people in with email links.</p>
        <a class="button auth-wide" href="/login/">Sign in another way</a>
      </AuthPage>,
      403,
    );
  }
  const link = await findLink(c);
  const usable = !!link && !link.used_at && link.expires_at > new Date().toISOString();
  return c.html(
    usable ? (
      <AuthPage title="Sign in">
        <h1>Sign in</h1>
        <form method="post" class="auth-form">
          <p class="auth-lede">Sign in to the EELS Data Base as <strong>{link.email}</strong>.</p>
          <button class="button" type="submit">Sign in</button>
          <p class="hint">This extra click stops email scanners from using up your link.</p>
        </form>
      </AuthPage>
    ) : link ? (
      <AuthPage title="Link no longer works">
        <h1>This link no longer works</h1>
        <form method="post" action="/login/email/" class="auth-form">
          <p class="auth-lede">It has expired or was already used. Each link works for {LINK_MINUTES} minutes, once.</p>
          <input type="hidden" name="email" value={link.email} />
          {link.next && <input type="hidden" name="next" value={link.next} />}
          <button class="button long-label" type="submit">Send a new link to {link.email}</button>
          <p class="hint"><a href="/login/">Sign in another way</a></p>
        </form>
      </AuthPage>
    ) : (
      <AuthPage title="Link not valid">
        <h1>This link is not valid</h1>
        <p class="auth-lede">Check that you opened the whole link from the email.</p>
        <a class="button auth-wide" href="/login/">Ask for a new link</a>
      </AuthPage>
    ),
    usable ? 200 : 410,
  );
});

account.post("/login/email/:token/", async (c) => {
  if (!(await methodOn(c.env, "email_link"))) return c.redirect(METHOD_OFF);
  const db = c.env.DB;
  const now = new Date().toISOString();
  // One statement both checks and spends the link, so two clicks cannot both sign in.
  const link = await db
    .prepare("UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email, next")
    .bind(now, await sha256(c.req.param("token")), now)
    .first<{ email: string; next: string | null }>();
  if (!link) return c.redirect(`/login/email/${c.req.param("token")}/`);
  let userId = await accountForEmail(db, link.email);
  if (userId === null) {
    userId = (await db.prepare("INSERT INTO users (display_name) VALUES (?) RETURNING id").bind(link.email.split("@")[0]).first<number>("id"))!;
  }
  await db
    .prepare("INSERT INTO user_emails (user_id, email, verified) VALUES (?, ?, 1) ON CONFLICT (user_id, email) DO UPDATE SET verified = 1")
    .bind(userId, link.email)
    .run();
  return completeSignIn(c, userId, { method: "email_link", next: link.next ?? undefined });
});

account.post("/login/password/", async (c) => {
  if (!(await methodOn(c.env, "password"))) return c.redirect(METHOD_OFF);
  const body = await c.req.parseBody();
  const login = String(body.login ?? "").trim();
  const password = String(body.password ?? "");
  const key = login.toLowerCase();
  const failures = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'password' AND key = ? AND at > datetime('now', '-1 hour')")
    .bind(key).first<number>("n");
  if ((failures ?? 0) >= MAX_PASSWORD_FAILURES) return c.redirect("/login/?error=locked");
  const legacyAllowed = c.env.LEGACY_PASSWORD_LOGIN === "1";
  const user = login
    ? await c.env.DB.prepare(
        `SELECT id, password_hash, legacy_password_hash FROM users
         WHERE (password_hash IS NOT NULL OR (?1 = 1 AND legacy_password_hash IS NOT NULL))
         AND (id = (SELECT user_id FROM user_emails WHERE email = ?2 AND verified = 1) OR slug = ?2 OR legacy_login = ?3 OR legacy_email = ?3 COLLATE NOCASE)
         ORDER BY id != (SELECT user_id FROM user_emails WHERE email = ?2 AND verified = 1), slug IS NOT ?2, id LIMIT 1`,
      ).bind(legacyAllowed ? 1 : 0, key, login).first<{ id: number; password_hash: string | null; legacy_password_hash: string | null }>()
    : null;
  const hash = user?.password_hash ?? user?.legacy_password_hash;
  if (!user || !hash || password.length > MAX_PASSWORD_LENGTH || !(await verifyLegacyPassword(password, hash))) {
    await c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('password', ?)").bind(key).run();
    return c.redirect("/login/?error=password");
  }
  if (!user.password_hash) {
    // phpass and bcrypt are only checked while LEGACY_PASSWORD_LOGIN is on; after one good sign-in the account no longer needs them.
    const moved = hash.startsWith("$pbkdf2-") ? hash : await pbkdf2Hash(password);
    await c.env.DB.prepare("UPDATE users SET password_hash = ?, legacy_password_hash = NULL WHERE id = ?").bind(moved, user.id).run();
  }
  return completeSignIn(c, user.id, { method: "password", next: typeof body.next === "string" ? body.next : undefined });
});

const challengeHash = async (c: Context<AppEnv>) => {
  const token = getCookie(c, CHALLENGE_COOKIE);
  return token ? sha256(token) : null;
};

const challengeUser = async (c: Context<AppEnv>) => {
  const hash = await challengeHash(c);
  return hash
    ? c.env.DB.prepare("SELECT user_id FROM login_challenges WHERE token_hash = ? AND expires_at > ? AND attempts < ?")
        .bind(hash, new Date().toISOString(), MAX_CHALLENGE_ATTEMPTS).first<number>("user_id")
    : null;
};

account.get("/login/second-step/", async (c) => {
  const userId = await challengeUser(c);
  if (userId === null) return c.redirect("/login/?error=second-step");
  return secondStepPage(c, userId);
});

async function secondStepPage(c: Context<AppEnv>, userId: number, error?: string) {
  const [totp, passkey] = await Promise.all([
    c.env.DB.prepare("SELECT 1 FROM user_totp WHERE user_id = ? AND enabled_at IS NOT NULL").bind(userId).first(),
    hasPasskey(c.env.DB, userId),
  ]);
  return c.html(
    <AuthPage title="Second step" script>
      <h1>Second step</h1>
      <p class="auth-lede">Your account has two-step sign-in on. {totp ? "Confirm it is you with a code." : "Confirm it is you with your passkey."}</p>
      {error && <p class="notice error-summary" role="alert" id="code-error">{error}</p>}
      {totp && (
        <form method="post" action="/login/second-step/" class="auth-form">
          <div class="field">
            <label for="code">Code from your authenticator app</label>
            <input
              id="code" name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="off" spellcheck={false} required autofocus
              aria-describedby={error ? "code-error code-hint" : "code-hint"} aria-invalid={error ? "true" : undefined}
            />
            <p class="hint" id="code-hint">Or one of your recovery codes. Each recovery code works once.</p>
          </div>
          <button class="button" type="submit">Sign in</button>
        </form>
      )}
      {totp && passkey && <Or />}
      {passkey && (
        <div class="auth-alt">
          <p class="notice error-summary" id="passkey-error" role="alert" hidden></p>
          <button class={totp ? "button secondary" : "button"} type="button" id="passkey-second-step" hidden>{raw(MARKS.passkey)}Use a passkey</button>
        </div>
      )}
      <p class="hint auth-restart"><a href="/login/">Start again</a></p>
    </AuthPage>,
    error ? 422 : 200,
  );
}

type Challenge = { hash: string; user_id: number; next: string | null; attempts: number };

/** Counting the try before checking the answer means a request cannot be tried again without being counted. */
async function takeAttempt(c: Context<AppEnv>): Promise<Challenge | null> {
  const hash = await challengeHash(c);
  const challenge = hash
    ? await c.env.DB.prepare("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ? AND expires_at > ? AND attempts < ? RETURNING user_id, next, attempts")
        .bind(hash, new Date().toISOString(), MAX_CHALLENGE_ATTEMPTS).first<Omit<Challenge, "hash">>()
    : null;
  return hash && challenge ? { hash, ...challenge } : null;
}

/** The end of a second step, whether the answer was a code or a passkey. Returns null while the person may try again. */
async function secondStepResult(c: Context<AppEnv>, challenge: Challenge, result: "ok" | "wrong" | "locked") {
  const db = c.env.DB;
  if (result !== "ok") {
    if (result === "locked" || challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      await db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").bind(challenge.hash).run();
      deleteCookie(c, CHALLENGE_COOKIE, { path: "/" });
      deleteCookie(c, LAST_METHOD_COOKIE, { path: "/" });
      return c.redirect(result === "locked" ? "/login/?error=second-step-locked" : "/login/?error=second-step");
    }
    return null;
  }
  await db.prepare("DELETE FROM login_challenges WHERE token_hash = ?").bind(challenge.hash).run();
  deleteCookie(c, CHALLENGE_COOKIE, { path: "/" });
  await createSession(c, challenge.user_id);
  rememberMethod(c, getCookie(c, LAST_METHOD_COOKIE));
  return c.redirect((await linkPendingIdentity(c, challenge.user_id)) ?? safeNext(challenge.next ?? undefined));
}

account.post("/login/second-step/", async (c) => {
  const challenge = await takeAttempt(c);
  if (!challenge) return c.redirect("/login/?error=second-step");
  const result = await spendCode(c.env.DB, challenge.user_id, (await c.req.parseBody()).code);
  return (await secondStepResult(c, challenge, result)) ?? secondStepPage(c, challenge.user_id, "That code is not right. Check the time on your phone, or use a recovery code.");
});

// The passkey routes answer JSON; a redirect (success, or the challenge used up) is followed by the page's script.
account.post("/login/second-step/passkey/options/", async (c) => {
  const userId = await challengeUser(c);
  if (userId === null) return c.json({ error: "expired" }, 400);
  return c.json(await authenticationOptions(c, "second_step", userId));
});

account.post("/login/second-step/passkey/", async (c) => {
  const challenge = await takeAttempt(c);
  if (!challenge) return c.redirect("/login/?error=second-step");
  const body = await c.req.json().catch(() => ({}));
  const ok = (await verifyPasskey(c, "second_step", challenge.user_id, body.token, body.response)) === challenge.user_id;
  return (await secondStepResult(c, challenge, ok ? "ok" : "wrong")) ?? c.json({ error: "That passkey did not work. Try again, or use a code." }, 422);
});

// Only the first-step routes check the switch: passkeys as a second step keep working, so moderators keep their 2FA.
account.post("/login/passkey/options/", async (c) =>
  (await methodOn(c.env, "passkey")) ? c.json(await authenticationOptions(c, "sign_in", null)) : c.json({ error: PASSKEY_OFF }, 403));

account.post("/login/passkey/", async (c) => {
  if (!(await methodOn(c.env, "passkey"))) return c.json({ error: PASSKEY_OFF }, 403);
  const body = await c.req.json().catch(() => ({}));
  const userId = await verifyPasskey(c, "sign_in", null, body.token, body.response);
  if (userId === null) return c.json({ error: "That passkey did not work. Try again, or use another way to sign in." }, 400);
  return completeSignIn(c, userId, { method: "passkey", next: typeof body.next === "string" ? body.next : undefined });
});

account.get("/wp-login.php", (c) => c.redirect("/login/", 301));
account.get("/auth/:provider/start", startSignIn);
account.get("/auth/:provider/link", requireUser, startLink);
account.get("/auth/:provider/callback", finishSignIn);

account.post("/logout/", async (c) => {
  await signOut(c);
  return c.redirect("/");
});

account.post("/favourites/:id/", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const spectrum = await c.env.DB.prepare("SELECT slug FROM spectra WHERE id = ? AND status = 'published'").bind(id).first<string>("slug");
  if (!spectrum) return c.notFound();
  const removed = await c.env.DB.prepare("DELETE FROM favourites WHERE user_id = ? AND spectrum_id = ?").bind(user.id, id).run();
  if (!removed.meta.changes) {
    await c.env.DB.prepare("INSERT INTO favourites (user_id, spectrum_id) VALUES (?, ?)").bind(user.id, id).run();
  }
  return c.redirect(safeNext(c.req.header("Referer") ? new URL(c.req.header("Referer")!).pathname : `/spectra/${encodeURIComponent(spectrum)}/`));
});

// The docs site is static; its header asks here who is signed in.
account.get("/account/me.json", (c) => c.json(accountSummary(c.get("user")), 200, { "Cache-Control": "no-store" }));

account.get("/account/", requireUser, async (c) => {
  const user = c.get("user")!;
  const [{ results: identities }, { results: favourites }, { results: owned }] = await c.env.DB.batch<any>([
    c.env.DB.prepare("SELECT provider, email FROM identities WHERE user_id = ? ORDER BY provider").bind(user.id),
    c.env.DB.prepare(
      `SELECT s.id, s.slug, s.title, s.type, s.formula FROM favourites f JOIN spectra s ON s.id = f.spectrum_id
       WHERE f.user_id = ? AND s.status = 'published' ORDER BY f.created_at DESC, s.title`,
    ).bind(user.id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE owner_id = ? AND status = 'published'").bind(user.id),
  ]);
  const notice = c.req.query("claim");
  return c.html(
    <AccountLayout title="Your account" current="/account/" user={user}>
      <div class="profile-head">
        <Avatar name={user.display_name} seed={user.slug ?? user.display_name} src={user.avatar} class="av-large" />
        <div>
          <h1>{user.display_name}</h1>
          <p class="muted profile-facts">
            Signed in with {identities.map((i: any) => PROVIDERS[i.provider]?.label ?? i.provider).join(", ") || "email"}
            {user.orcid && <> · ORCID <a href={`https://orcid.org/${user.orcid}`}>{user.orcid}</a></>}
            {owned[0].n > 0 && user.slug && <> · <a href={`/author/${user.slug}/`}>{owned[0].n} contributed {owned[0].n === 1 ? "spectrum" : "spectra"}</a></>}
          </p>
        </div>
      </div>
      {notice === "sent" && (
        <p class="notice" role="status">If an old account uses that address, we have emailed it a link. The link works for {CLAIM_HOURS} hours.</p>
      )}
      {notice === "limit" && <p class="notice" role="status">You have asked for {MAX_CLAIMS_PER_DAY} links today. Please try again tomorrow.</p>}
      {notice === "done" && <p class="notice" role="status">Your old account is now linked. Its favourites and spectra are below.</p>}

      <p class="account-actions">
        <a class="button" href="/submit-data/">Submit a spectrum</a>
      </p>

      <h2>Favourite spectra</h2>
      {favourites.length ? (
        <div class="table-scroll">
          <table>
            <tbody>
              {favourites.map((s: any) => (
                <tr>
                  <td><TypeBadge type={s.type} /></td>
                  <td class="title"><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a></td>
                  <td><Formula formula={s.formula} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">None yet. Use the star on a spectrum's page to keep it here.</p>
      )}

      <div class="prose">
        <h2>Claim your account from the old site</h2>
        <p>Enter the email address of your old EELSdb account. We will send a link to that address; open it while signed in here.</p>
        <form method="post" action="/account/claim/" class="inline-form">
          <input type="email" name="email" required aria-label="Email address of your old account" autocomplete="email" placeholder="name@example.org" />
          <button class="button secondary" type="submit">Send link</button>
        </form>
      </div>
    </AccountLayout>,
  );
});

account.post("/account/claim/", requireUser, async (c) => {
  const user = c.get("user")!;
  const email = String((await c.req.parseBody()).email ?? "").trim();
  const legacy = email
    ? await c.env.DB.prepare(
        `SELECT id FROM users WHERE legacy_email = ? COLLATE NOCASE AND id != ?
         AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = users.id)`,
      ).bind(email, user.id).first<number>("id")
    : null;
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'claim' AND key = ? AND at > datetime('now', '-1 day')")
    .bind(String(user.id)).first<number>("n");
  if ((recent ?? 0) >= MAX_CLAIMS_PER_DAY) return c.redirect("/account/?claim=limit");
  await c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('claim', ?)").bind(String(user.id)).run();
  // The same answer whether or not the address exists, so the form cannot be used to look up members.
  if (legacy !== null) {
    const token = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO account_claims (token_hash, user_id, legacy_user_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), user.id, legacy, new Date(Date.now() + CLAIM_HOURS * 3600_000).toISOString())
      .run();
    const link = `${new URL(c.req.url).origin}/account/claim/${token}/`;
    await sendEmail(c.env, {
      to: email,
      subject: "Link your EELS Data Base account",
      text: `Someone signed in to the EELS Data Base as "${user.display_name}" and asked to link the old account that uses this address.\n\nIf that was you, open this link while signed in (it works for ${CLAIM_HOURS} hours):\n${link}\n\nIf not, ignore this email.`,
    });
  }
  return c.redirect("/account/?claim=sent");
});

async function findClaim(c: any) {
  return c.env.DB.prepare(
    `SELECT a.legacy_user_id, u.display_name FROM account_claims a JOIN users u ON u.id = a.legacy_user_id
     WHERE a.token_hash = ? AND a.user_id = ? AND a.expires_at > ?`,
  )
    .bind(await sha256(c.req.param("token")), c.get("user").id, new Date().toISOString())
    .first() as Promise<{ legacy_user_id: number; display_name: string } | null>;
}

account.get("/account/claim/:token/", requireUser, async (c) => {
  const claim = await findClaim(c);
  return c.html(
    <AccountLayout title="Link your old account" current="/account/" user={c.get("user")!}>
      <div class="prose">
        <h1>Link your old account</h1>
        {claim ? (
          <form method="post">
            <p>
              Link the old account <strong>{claim.display_name}</strong> to your sign-in? Its favourites and spectra become yours, and you
              will sign in to it from now on.
            </p>
            <button class="button" type="submit">Link account</button>
          </form>
        ) : (
          <p class="notice">This link has expired, was already used, or was sent to a different signed-in account.</p>
        )}
      </div>
    </AccountLayout>,
    claim ? 200 : 404,
  );
});

/** Merges the new, signed-in account into the old one (see `mergeAccounts`), then signs in as the old one. */
account.post("/account/claim/:token/", requireUser, async (c) => {
  const claim = await findClaim(c);
  if (!claim) return c.redirect("/account/");
  const to = claim.legacy_user_id;
  const { droppedAvatar } = await mergeAccounts(c.env.DB, c.get("user")!.id, to);
  if (droppedAvatar) await c.env.FILES.delete(`avatars/${droppedAvatar}`);
  return completeSignIn(c, to, { method: "claim", next: "/account/?claim=done" });
});
