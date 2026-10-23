import { Hono, type Context } from "hono";
import { FRESH_SIGN_IN_MINUTES, MAX_PASSWORD_FAILURES, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PROVIDERS, methodsOn, requireUser, safeNext, sha256, signOutOtherSessions, signedInRecently, syncEmails, unclaimedAccountForEmail, type AppEnv } from "../auth";
import { mergeAccounts, outranks } from "../merge";
import { sendEmail } from "../email";
import { pbkdf2Hash, verifyLegacyPassword } from "../legacy-password";
import { MAX_PASSKEYS, addPasskey, registrationOptions } from "../passkeys";
import { MAX_SECOND_STEP_FAILURES, makeRecoveryCodes, matchingStep, newSecret, otpauthUri, spendCode } from "../totp";
import { HAS_PAGE_SQL } from "./profile";
import { LicenceSection } from "../admin-users";
import { AccountLayout, SETTINGS_PAGES, type AccountPage } from "./layout";
import { DetailsFields, EmailList, LinkFields, PictureChoice, VERIFY_HOURS, MAX_EMAILS_PER_DAY, addEmail, emailOf, makePrimary, pictureState, removeEmail, resendVerification, saveProfile, storedProfile, text, type EmailRow, type Profile } from "../account-edit";

export const settings = new Hono<AppEnv>();
type C = Context<AppEnv>;

const THEMES = [
  ["system", "Same as your device"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;

const NOTICES: Record<string, string> = {
  profile: "Profile saved.",
  licence: "Licence saved.",
  stale: `Admin changes need a sign-in in the last ${FRESH_SIGN_IN_MINUTES} minutes. Sign out, sign in again, then repeat the change.`,
  theme: "Appearance saved.",
  sent: `If that address can be added, we have emailed it a link. The link works for ${VERIFY_HOURS} hours.`,
  limit: `You can add up to ${MAX_EMAILS_PER_DAY} addresses a day. Please try again tomorrow.`,
  "email-bad": "That does not look like an email address.",
  verified: "Email address confirmed.",
  "verified-merged": "Email address confirmed. The spectra and favourites recorded with it are now on your account.",
  "verify-failed": "This link has expired, was already used, belongs to another signed-in account, or the address is confirmed on another account.",
  primary: "Primary address changed.",
  removed: "Address removed.",
  "password-saved": "Password saved. You were signed out everywhere else.",
  "password-removed": "Password removed. You were signed out everywhere else. You can still sign in with an email link.",
  "password-wrong": "The current password is not right. Nothing was changed.",
  "password-short": `A password needs ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
  "password-locked": "Too many wrong passwords. Please wait an hour.",
  "password-stale": `To set a password, sign out and sign in again, then set it within ${FRESH_SIGN_IN_MINUTES} minutes.`,
  "two-step-required": "Moderators and admins need two-step sign-in. Until you set it up, your role does nothing.",
  "two-step-users": "This site requires two-step sign-in. Set it up below before you use your account.",
  "two-step-started": "Add the secret to your authenticator app, then enter a code it shows to turn two-step sign-in on.",
  "two-step-stale": `To set up two-step sign-in, sign out and sign in again, then set it up within ${FRESH_SIGN_IN_MINUTES} minutes.`,
  "two-step-bad-code": "That code is not right. Nothing was changed.",
  "two-step-locked": "Too many wrong codes. Please wait an hour.",
  "two-step-cancelled": "Set-up cancelled.",
  "two-step-off": "Two-step sign-in is off.",
  "two-step-all-on": "You will be asked for your second step after ORCID, Google and GitHub too.",
  "passkey-added": "Passkey added.",
  "passkey-removed": "Passkey removed.",
  "passkey-stale": `To add or remove a passkey, sign out and sign in again, then try within ${FRESH_SIGN_IN_MINUTES} minutes.`,
  "two-step-all-off": "You will be asked for your second step after an email link or a password only.",
  linked: "Linked.",
  "linked-orcid": "ORCID linked. You can now sign in with it.",
  "linked-google": "Google linked. You can now sign in with it.",
  "linked-github": "GitHub linked. You can now sign in with it.",
  "link-taken": "That account is already linked to a different EELSdb account, so nothing was changed.",
  "link-has": "Your account already has a different account of that kind linked. Nothing was changed.",
  "link-off": "Sign-in with that service is switched off on this site, so it cannot be linked.",
  "password-off": "Password sign-in is switched off on this site, so a password cannot be set.",
  "link-failed": "The sign-in service did not confirm who you are, so nothing was linked. Please try again.",
  "token-revoked": "Token revoked.",
  "keep-primary": "Make another confirmed address primary before removing this one.",
};

type Page = "profile" | "emails" | "sign-in" | "two-step" | "tokens";
const pageUrl = (page: Page) => `/account/settings/${page}/` as AccountPage;
const PAGE_TITLES = Object.fromEntries(SETTINGS_PAGES.map(([href, label]) => [href, label])) as Record<AccountPage, string>;

async function renderSettings(c: C, page: Page, form?: { values: Profile; errors: Profile }, recoveryCodes?: string[], token?: { created?: string; notice?: string }) {
  const user = c.get("user")!;
  const db = c.env.DB;
  const [{ results: emails }, { results: identities }, { results: pw }, { results: totpRows }, { results: passkeys }, { results: tokens }] = await db.batch<any>([
    db.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE user_id = ? ORDER BY is_primary DESC, verified DESC, email").bind(user.id),
    db.prepare("SELECT provider, subject, email FROM identities WHERE user_id = ? ORDER BY provider").bind(user.id),
    db.prepare("SELECT password_hash IS NOT NULL AS has, mfa_all_methods FROM users WHERE id = ?").bind(user.id),
    db.prepare(
      `SELECT t.secret, t.enabled_at, (SELECT COUNT(*) FROM recovery_codes r WHERE r.user_id = t.user_id AND r.used_at IS NULL) AS codes_left
       FROM user_totp t WHERE t.user_id = ?`,
    ).bind(user.id),
    db.prepare("SELECT credential_id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at, name").bind(user.id),
    db.prepare("SELECT id, label, created_at, last_used_at FROM draft_tokens WHERE user_id = ? ORDER BY id DESC").bind(user.id),
  ]);
  const totp = totpRows[0] as { secret: string; enabled_at: string | null; codes_left: number } | undefined;
  const hasPassword = !!pw[0].has;
  const recent = await signedInRecently(c);
  const askCurrent = hasPassword && !recent;
  const v = form?.values ?? (await storedProfile(db, user.id));
  const errors = form?.errors ?? {};
  const orcidId: string | null = identities.find((i: any) => i.provider === "orcid")?.subject ?? null;
  const on: string[] = await methodsOn(c.env);
  const passwordOn = on.includes("password");
  const unlinked = Object.entries(PROVIDERS)
    .filter(([key]) => on.includes(key) && !identities.some((i: any) => i.provider === key))
    .map(([key, p]) => [key, p.label] as const);
  const origin = new URL(c.req.url).origin;
  const picture = page === "profile" ? await pictureState(db, user.id) : null;
  const hasPage = page === "profile" && !!(await db.prepare(`SELECT 1 FROM users u WHERE u.id = ? AND ${HAS_PAGE_SQL}`).bind(user.id).first());
  const notice = token?.notice ?? (form ? null : NOTICES[c.req.query("notice") ?? ""]);
  return (
    <AccountLayout title={`${PAGE_TITLES[pageUrl(page)]} - Settings`} current={pageUrl(page)} user={user}>
      <div class="settings">
        <h1>{PAGE_TITLES[pageUrl(page)]}</h1>
        {notice && <p class="notice" role="status">{notice}</p>}
        {page === "two-step" && (user.needs_2fa || user.setup_required) && !notice && (
          <p class="notice" role="status">{NOTICES[user.setup_required ? "two-step-users" : "two-step-required"]}</p>
        )}

        {page === "profile" && (
<>
        <p class="lede">How you appear on EELSdb: on your author page and beside the spectra you share.</p>
        {hasPage ? (
          <p><a class="button secondary" href={`/author/${user.slug}/`}>View public profile</a></p>
        ) : (
          <p class="hint">Your public page appears once you have a username and your first spectrum is published, or you show your details or links.</p>
        )}
        <form method="post" action="/account/settings/profile/" enctype="multipart/form-data" class="profile-form">
          {Object.keys(errors).length > 0 && <p class="notice error-summary" role="alert">Some fields need attention. Nothing was saved.</p>}
          <section class="settings-section" aria-labelledby="h-avatar">
            <PictureChoice v={v} errors={errors} name={user.display_name} seed={user.slug ?? user.display_name} state={picture!} who="your" uploads heading="h2" />
          </section>

          <section class="settings-section settings-form" aria-labelledby="h-profile">
            <h2 id="h-profile">Details</h2>
            <DetailsFields v={v} errors={errors} origin={origin} who="your" />
          </section>

          <section class="settings-section settings-form" aria-labelledby="h-links">
            <h2 id="h-links">Links</h2>
            <LinkFields v={v} errors={errors} orcid={orcidId} linkNext={on.includes("orcid") ? pageUrl("profile") : null} orcidOff={!on.includes("orcid")} who="your" />
            <div><button class="button" type="submit">Save profile</button></div>
          </section>
        </form>
        {user.role === "admin" && <LicenceSection id={user.id} licence={user.licence} whose="your" />}
</>
        )}

        {page === "emails" && (
        <section class="settings-section lone">
          <p class="hint">The primary address is used for your avatar and for messages about your submissions. Addresses are never shown on the site.</p>
          {emails.length > 0 && <EmailList emails={emails as EmailRow[]} base="/account/settings/emails" />}
          <form method="post" action="/account/settings/emails/" class="inline-form">
            <input type="email" name="email" required aria-label="Email address to add" autocomplete="email" placeholder="name@example.org" />
            <button class="button secondary" type="submit">Add address</button>
          </form>
        </section>
        )}

        {page === "sign-in" && (
<>
        <section class="settings-section" aria-labelledby="h-signin">
          <h2 id="h-signin">Linked services</h2>
          {identities.length ? (
            <dl class="meta">
              {identities.map((i: any) => (
                <>
                  <dt>{PROVIDERS[i.provider]?.label ?? i.provider}</dt>
                  <dd>{i.email ?? (i.provider === "orcid" && user.orcid ? user.orcid : "Connected")}</dd>
                </>
              ))}
            </dl>
          ) : (
            <p class="muted">No sign-in service is linked to your account yet.</p>
          )}
          {unlinked.length > 0 && (
            <p class="link-services">
              {unlinked.map(([key, label]) => (
                <a class="button secondary" href={`/auth/${key}/link?next=${encodeURIComponent("/account/settings/sign-in/?notice=linked#h-signin")}`}>Link {label}</a>
              ))}
            </p>
          )}
        </section>

        <section class="settings-section" aria-labelledby="h-password">
          <h2 id="h-password">Password</h2>
          {passwordOn ? (
          <p class="hint">
            {hasPassword ? "You can sign in with your email address and password." : "You have no password. A password is optional."}{" "}
            {askCurrent && `Changing or removing it needs your current password, because you signed in more than ${FRESH_SIGN_IN_MINUTES} minutes ago.`}
            {!hasPassword && !recent && `To set one, sign out and sign in again, then set it within ${FRESH_SIGN_IN_MINUTES} minutes.`}
          </p>
          ) : (
            <p class="hint">Password sign-in is switched off on this site.{hasPassword && " You can remove the password your account still has."}</p>
          )}
          {passwordOn && (hasPassword || recent) && (
          <form method="post" action="/account/settings/password/" class="settings-form">
            {hasPassword && <h3>Change your password</h3>}
            {askCurrent && (
              <div class="field">
                <label for="f-current-password">Current password</label>
                <input id="f-current-password" name="current_password" type="password" autocomplete="current-password" required />
              </div>
            )}
            <div class="field">
              <label for="f-new-password">{hasPassword ? "New password" : "Password"}</label>
              <input id="f-new-password" name="new_password" type="password" autocomplete="new-password" required minlength={MIN_PASSWORD_LENGTH} maxlength={MAX_PASSWORD_LENGTH} />
              <p class="hint">{MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters. Changing it signs you out everywhere else.</p>
            </div>
            <div><button class="button" type="submit">{hasPassword ? "Change password" : "Set password"}</button></div>
          </form>
          )}
          {hasPassword && (
            <form method="post" action="/account/settings/password/remove/" class="settings-form">
              <h3>Remove your password</h3>
              <p class="hint">
                {passwordOn ? "Then you sign in with an email link or another method instead, and nobody can sign in to your account with a password." : "Then nobody can sign in to your account with a password if password sign-in is switched back on."}{" "}
                Removing it signs you out everywhere else.
              </p>
              {askCurrent && (
                <div class="field">
                  <label for="f-remove-password">Current password</label>
                  <input id="f-remove-password" name="current_password" type="password" autocomplete="current-password" required />
                </div>
              )}
              <div><button class="button secondary" type="submit">Remove password</button></div>
            </form>
          )}
        </section>
</>
        )}

        {page === "two-step" && (
<>
        <section class="settings-section" aria-labelledby="h-two-step" id="two-step">
          <h2 id="h-two-step">Two-step sign-in</h2>
          {recoveryCodes ? (
            <>
              <p class="notice" role="status">Two-step sign-in is on. Save these recovery codes now: they are not shown again. Each works once, if you lose your phone.</p>
              <ul class="recovery-codes">{recoveryCodes.map((code) => <li><code>{code}</code></li>)}</ul>
            </>
          ) : totp?.enabled_at ? (
            <>
              <p class="hint">
                On. After you sign in with an email link or a password you also enter a code from your authenticator app. You have {totp.codes_left} unused recovery{" "}
                {totp.codes_left === 1 ? "code" : "codes"}. Each form below needs a current code or a recovery code.
              </p>
              {["admin", "moderator"].includes(user.role) && <p class="hint">Your moderator role needs this: turning it off ends your role until you set it up again.</p>}
              <form method="post" action="/account/settings/two-step/all-methods/" class="settings-form">
                <h3>Other sign-in services</h3>
                <label class="check">
                  <input type="checkbox" name="all_methods" value="1" checked={!!pw[0].mfa_all_methods} /> Also ask after ORCID, Google and GitHub
                </label>
                <div class="field">
                  <label for="f-code-all">Current code or recovery code</label>
                  <input id="f-code-all" name="code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck={false} required />
                </div>
                <div><button class="button secondary" type="submit">Save</button></div>
              </form>
              <form method="post" action="/account/settings/two-step/recovery/" class="settings-form">
                <h3>New recovery codes</h3>
                <div class="field">
                  <label for="f-code-new">Current code or recovery code</label>
                  <input id="f-code-new" name="code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck={false} required />
                </div>
                <div><button class="button secondary" type="submit">Make new recovery codes</button></div>
              </form>
              <form method="post" action="/account/settings/two-step/off/" class="settings-form">
                <h3>Turn off</h3>
                <div class="field">
                  <label for="f-code-off">Current code or recovery code</label>
                  <input id="f-code-off" name="code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck={false} required />
                </div>
                <div><button class="button secondary" type="submit">Turn off two-step sign-in</button></div>
              </form>
            </>
          ) : totp ? (
            <>
              <p class="hint">
                In your authenticator app, scan this code, or add the secret by hand. Then enter the code the app shows.
              </p>
              <div id="totp-qr" class="totp-qr" data-uri={otpauthUri(totp.secret, user.display_name)}></div>
              <p>Secret: <code class="totp-secret">{totp.secret.match(/.{1,4}/g)!.join(" ")}</code></p>
              <p class="small"><a href={otpauthUri(totp.secret, user.display_name)}>Open in an authenticator app on this device</a></p>
              <form method="post" action="/account/settings/two-step/confirm/" class="settings-form">
                <div class="field">
                  <label for="f-code-confirm">Code</label>
                  <input id="f-code-confirm" name="code" type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" required />
                </div>
                <div><button class="button" type="submit">Turn on two-step sign-in</button></div>
              </form>
              <form method="post" action="/account/settings/two-step/cancel/"><button class="link-button" type="submit">Cancel</button></form>
            </>
          ) : (
            <>
              <p class="hint">
                Protect your account with a code from an authenticator app (such as your phone's, or a password manager) as well as an email link or password.
                Moderators and admins need it.
              </p>
              {recent ? (
                <form method="post" action="/account/settings/two-step/start/"><button class="button" type="submit">Set up two-step sign-in</button></form>
              ) : (
                <p class="hint">{NOTICES["two-step-stale"]}</p>
              )}
            </>
          )}
        </section>

        <section class="settings-section" aria-labelledby="h-passkeys" id="passkeys">
          <h2 id="h-passkeys">Passkeys</h2>
          <p class="hint">
            {on.includes("passkey")
              ? "A passkey signs you in with your device's fingerprint, face or screen lock instead of an email link or a password, and needs no second step."
              : "Passkey sign-in is switched off on this site, but a passkey still works as your second step after another way in."}{" "}
            It also counts as two-step sign-in for moderators and admins.
          </p>
          {passkeys.length > 0 && (
            <ul class="passkey-list">
              {passkeys.map((p: any) => (
                <li>
                  <span><strong>{p.name}</strong> <span class="muted small">added {p.created_at.slice(0, 10)}, {p.last_used_at ? `last used ${p.last_used_at.slice(0, 10)}` : "never used"}</span></span>
                  {recent && (
                    <form method="post" action="/account/settings/passkeys/remove/">
                      <input type="hidden" name="id" value={p.credential_id} />
                      <button class="link-button" type="submit" aria-label={`Remove passkey ${p.name}`}>Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {recent ? (
            <form id="passkey-add" class="settings-form" hidden>
              <div class="field">
                <label for="f-passkey-name">Name</label>
                <input id="f-passkey-name" name="name" type="text" maxLength={60} placeholder="Laptop" required />
              </div>
              <div><button class="button" type="submit">Add a passkey</button></div>
              <p class="notice error-summary" id="passkey-error" role="alert" hidden></p>
            </form>
          ) : (
            <p class="hint">{NOTICES["passkey-stale"]}</p>
          )}
          {passkeys.length > 0 && !totp?.enabled_at && recent && (
            <form method="post" action="/account/settings/two-step/all-methods/" class="settings-form">
              <h3>Other sign-in services</h3>
              <label class="check">
                <input type="checkbox" name="all_methods" value="1" checked={!!pw[0].mfa_all_methods} /> Also ask for a passkey after ORCID, Google and GitHub
              </label>
              <div><button class="button secondary" type="submit">Save</button></div>
            </form>
          )}
        </section>
</>
        )}

        {page === "tokens" && (
        <section class="settings-section lone">
          <p class="hint">
            An API token lets a script or an AI assistant use the EELSdb API as you. For now a token can only make drafts: it cannot submit,
            publish or change anything else. Treat it like a password. See <a href="/docs/share/drafts/">Prepare drafts with an assistant</a>. Your drafts are on the{" "}
            <a href="/account/drafts/">drafts page</a>.
          </p>
          {token?.created && (
            <div class="notice" role="status">
              <p><strong>Your new token.</strong> Copy it now: it is not shown again.</p>
              <pre id="new-token">{token.created}</pre>
            </div>
          )}
          <form method="post" action="/account/settings/tokens/" class="inline-form">
            <input type="text" name="label" placeholder="What is it for? e.g. laptop" aria-label="Token label" maxlength={80} />
            <button class="button secondary" type="submit">Make a token</button>
          </form>
          {tokens.length > 0 && (
            <div class="table-scroll">
              <table>
                <thead><tr><th>Label</th><th>Made</th><th>Last used</th><th></th></tr></thead>
                <tbody>
                  {tokens.map((t: any) => (
                    <tr>
                      <td>{t.label || <span class="muted">No label</span>}</td>
                      <td>{String(t.created_at).slice(0, 10)}</td>
                      <td>{t.last_used_at ? String(t.last_used_at).slice(0, 10) : "Never"}</td>
                      <td>
                        <form method="post" action={`/account/settings/tokens/${t.id}/revoke/`}>
                          <button class="button secondary" type="submit">Revoke</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        )}
      </div>
      <script src="/settings.js" type="module"></script>
      <script src="/passkeys.js" type="module"></script>
    </AccountLayout>
  );
}

settings.get("/account/settings/", (c) => c.redirect(pageUrl("profile")));
for (const page of ["profile", "emails", "sign-in", "two-step", "tokens"] as const) {
  settings.get(pageUrl(page), requireUser, async (c) => c.html(await renderSettings(c, page)));
}

const back = (c: C, page: Page, notice: string, hash = "") => c.redirect(`${pageUrl(page)}?notice=${notice}${hash}`);

settings.post("/account/settings/profile/", requireUser, async (c) => {
  const failed = await saveProfile(c.env, c.get("user")!.id, await c.req.parseBody(), true);
  if (failed) return c.html(await renderSettings(c, "profile", failed), 422);
  return back(c, "profile", "profile");
});

settings.post("/account/settings/theme/", requireUser, async (c) => {
  const theme = String((await c.req.parseBody()).theme ?? "");
  if (THEMES.some(([t]) => t === theme)) await c.env.DB.prepare("UPDATE users SET theme = ? WHERE id = ?").bind(theme, c.get("user")!.id).run();
  return back(c, "profile", "theme");
});

settings.get("/avatars/:user/:file", async (c) => {
  const key = `${c.req.param("user")}/${c.req.param("file")}`;
  if (!/^\d+\/[\w-]+\.(png|jpg|webp)$/.test(key)) return c.notFound();
  const object = await c.env.FILES.get(`avatars/${key}`);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
});

settings.post("/account/settings/emails/", requireUser, async (c) => {
  const user = c.get("user")!;
  const intro = `Someone signed in to the EELS Data Base as "${user.display_name}" and added this address.`;
  return back(c, "emails", await addEmail(c.env, new URL(c.req.url).origin, user.id, (await c.req.parseBody()).email, intro));
});

const ownEmail = (c: C) => emailOf(c.env.DB, c.get("user")!.id, Number(c.req.param("id")));

settings.post("/account/settings/emails/:id/send/", requireUser, async (c) => {
  const row = await ownEmail(c);
  if (!row) return c.notFound();
  const user = c.get("user")!;
  const sent = await resendVerification(c.env, new URL(c.req.url).origin, user.id, row, `Someone signed in to the EELS Data Base as "${user.display_name}" and added this address.`);
  // The banner sends the page it was on, and asks for JSON so it can say what happened without a reload.
  if (c.req.header("Accept")?.includes("application/json")) return c.json({ sent });
  const next = (await c.req.parseBody()).next;
  return typeof next === "string" && next ? c.redirect(safeNext(next)) : back(c, "emails", "sent");
});

settings.post("/account/settings/emails/:id/primary/", requireUser, async (c) => {
  const row = await ownEmail(c);
  if (!row?.verified) return c.notFound();
  await makePrimary(c.env.DB, c.get("user")!.id, row);
  return back(c, "emails", "primary");
});

settings.post("/account/settings/emails/:id/remove/", requireUser, async (c) => {
  const row = await ownEmail(c);
  if (!row) return c.notFound();
  return back(c, "emails", await removeEmail(c.env.DB, row));
});

settings.get("/account/emails/verify/:token/", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const found = await db.prepare(
    `SELECT e.id, e.email FROM email_verifications v JOIN user_emails e ON e.id = v.email_id
     WHERE v.token_hash = ? AND e.user_id = ? AND v.expires_at > ?`,
  ).bind(await sha256(c.req.param("token")), user.id, new Date().toISOString()).first<{ id: number; email: string }>();
  if (found === null) return back(c, "emails", "verify-failed");
  const row = found.id;
  try {
    await db.batch([
      db.prepare("UPDATE user_emails SET verified = 1 WHERE id = ?").bind(row),
      db.prepare("DELETE FROM email_verifications WHERE email_id = ?").bind(row),
    ]);
  } catch {
    // The unique index on confirmed addresses: another account confirmed it first.
    return back(c, "emails", "verify-failed");
  }
  // A confirmed address takes over from an unconfirmed primary.
  await db.prepare(
    `UPDATE user_emails SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END
     WHERE user_id = ?2 AND NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = ?2 AND is_primary = 1 AND verified = 1)`,
  ).bind(row, user.id).run();
  // Confirming an address proves it is theirs, so the migrated account that used it (and its spectra) joins this one.
  const migrated = await unclaimedAccountForEmail(db, found.email);
  const merge = migrated !== null && migrated !== user.id;
  if (merge) {
    const role = await db.prepare("SELECT role FROM users WHERE id = ?").bind(migrated).first<string>("role");
    const { droppedAvatar } = await mergeAccounts(db, migrated, user.id);
    if (droppedAvatar) await c.env.FILES.delete(`avatars/${droppedAvatar}`);
    if (role && outranks(role, user.role)) await db.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, user.id).run();
  }
  await syncEmails(db, user.id);
  return back(c, "emails", merge ? "verified-merged" : "verified");
});

/** Passes when the session is fresh or the current password is right; wrong guesses count towards the same hourly lockout as sign-in. */
// A first password needs a fresh sign-in too: otherwise anyone at an unattended signed-in browser could set one and keep access.
async function mayChangePassword(c: C, current: unknown): Promise<"ok" | "wrong" | "locked" | "stale"> {
  const user = c.get("user")!;
  const db = c.env.DB;
  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<string | null>("password_hash");
  if (await signedInRecently(c)) return "ok";
  if (!row) return "stale";
  const key = `account:${user.id}`;
  const failures = await db.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'password' AND key = ? AND at > datetime('now', '-1 hour')").bind(key).first<number>("n");
  if ((failures ?? 0) >= MAX_PASSWORD_FAILURES) return "locked";
  const password = typeof current === "string" ? current : "";
  if (password.length <= MAX_PASSWORD_LENGTH && (await verifyLegacyPassword(password, row))) return "ok";
  await db.prepare("INSERT INTO rate_events (kind, key) VALUES ('password', ?)").bind(key).run();
  return "wrong";
}

settings.post("/account/settings/password/", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const next = typeof body.new_password === "string" ? body.new_password : "";
  if (!(await methodsOn(c.env)).includes("password")) return back(c, "sign-in", "password-off");
  const allowed = await mayChangePassword(c, body.current_password);
  if (allowed !== "ok") return back(c, "sign-in", `password-${allowed}`);
  if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) return back(c, "sign-in", "password-short");
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, legacy_password_hash = NULL WHERE id = ?").bind(await pbkdf2Hash(next), user.id).run();
  await signOutOtherSessions(c, user.id);
  return back(c, "sign-in", "password-saved");
});

settings.post("/account/settings/password/remove/", requireUser, async (c) => {
  const user = c.get("user")!;
  const allowed = await mayChangePassword(c, (await c.req.parseBody()).current_password);
  if (allowed !== "ok") return back(c, "sign-in", `password-${allowed}`);
  await c.env.DB.prepare("UPDATE users SET password_hash = NULL, legacy_password_hash = NULL WHERE id = ?").bind(user.id).run();
  await signOutOtherSessions(c, user.id);
  return back(c, "sign-in", "password-removed");
});


const stepBack = (c: C, notice: string) => back(c, "two-step", notice, "#h-two-step");

settings.post("/account/settings/two-step/start/", requireUser, async (c) => {
  const user = c.get("user")!;
  if (!(await signedInRecently(c))) return stepBack(c, "two-step-stale");
  await c.env.DB.prepare("INSERT INTO user_totp (user_id, secret) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, last_step = 0 WHERE enabled_at IS NULL")
    .bind(user.id, newSecret()).run();
  return stepBack(c, "two-step-started");
});

settings.post("/account/settings/two-step/cancel/", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM user_totp WHERE user_id = ? AND enabled_at IS NULL").bind(c.get("user")!.id).run();
  return stepBack(c, "two-step-cancelled");
});

settings.post("/account/settings/two-step/confirm/", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const pending = await db.prepare("SELECT secret FROM user_totp WHERE user_id = ? AND enabled_at IS NULL").bind(user.id).first<string>("secret");
  if (!pending) return stepBack(c, "two-step-cancelled");
  const failures = await db.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'second_step' AND key = ? AND at > datetime('now', '-1 hour')").bind(String(user.id)).first<number>("n");
  if ((failures ?? 0) >= MAX_SECOND_STEP_FAILURES) return stepBack(c, "two-step-locked");
  const code = String((await c.req.parseBody()).code ?? "").replace(/\s/g, "");
  const step = await matchingStep(pending, code, 0);
  if (step === null) {
    await db.prepare("INSERT INTO rate_events (kind, key) VALUES ('second_step', ?)").bind(String(user.id)).run();
    return stepBack(c, "two-step-bad-code");
  }
  await db.prepare("UPDATE user_totp SET enabled_at = datetime('now'), last_step = ? WHERE user_id = ? AND enabled_at IS NULL").bind(step, user.id).run();
  c.header("Cache-Control", "no-store");
  return c.html(await renderSettings(c, "two-step", undefined, await makeRecoveryCodes(db, user.id)));
});

/** The forms for an account with two-step sign-in on all need a current code or a recovery code. */
async function codeOk(c: C, body: Record<string, unknown>) {
  const result = await spendCode(c.env.DB, c.get("user")!.id, body.code);
  return result === "ok" ? null : stepBack(c, result === "locked" ? "two-step-locked" : "two-step-bad-code");
}

settings.post("/account/settings/two-step/off/", requireUser, async (c) => {
  const user = c.get("user")!;
  const refused = await codeOk(c, await c.req.parseBody());
  if (refused) return refused;
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_totp WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("UPDATE users SET mfa_all_methods = 0 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ?)").bind(user.id, user.id),
  ]);
  return stepBack(c, "two-step-off");
});

settings.post("/account/settings/two-step/recovery/", requireUser, async (c) => {
  const refused = await codeOk(c, await c.req.parseBody());
  if (refused) return refused;
  c.header("Cache-Control", "no-store");
  return c.html(await renderSettings(c, "two-step", undefined, await makeRecoveryCodes(c.env.DB, c.get("user")!.id)));
});

settings.post("/account/settings/two-step/all-methods/", requireUser, async (c) => {
  const body = await c.req.parseBody();
  const userId = c.get("user")!.id;
  // With an authenticator app the change needs a code; with passkeys only, a fresh sign-in (which used the passkey).
  if (await c.env.DB.prepare("SELECT 1 FROM user_totp WHERE user_id = ? AND enabled_at IS NOT NULL").bind(userId).first()) {
    const refused = await codeOk(c, body);
    if (refused) return refused;
  } else {
    if (!(await c.env.DB.prepare("SELECT 1 FROM passkeys WHERE user_id = ?").bind(userId).first())) return stepBack(c, "two-step-bad-code");
    if (!(await signedInRecently(c))) return stepBack(c, "passkey-stale");
  }
  await c.env.DB.prepare("UPDATE users SET mfa_all_methods = ? WHERE id = ?").bind(body.all_methods ? 1 : 0, c.get("user")!.id).run();
  return stepBack(c, body.all_methods ? "two-step-all-on" : "two-step-all-off");
});

// Adding or removing a passkey needs a sign-in in the last 15 minutes, like setting up two-step sign-in: someone at an
// unattended browser could otherwise add their own passkey, or remove the owner's.
settings.post("/account/settings/passkeys/options/", requireUser, async (c) => {
  if (!(await signedInRecently(c))) return c.json({ error: NOTICES["passkey-stale"] }, 403);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(c.get("user")!.id).first<number>("n");
  if ((count ?? 0) >= MAX_PASSKEYS) return c.json({ error: `You can have up to ${MAX_PASSKEYS} passkeys.` }, 400);
  return c.json(await registrationOptions(c, c.get("user")!));
});

settings.post("/account/settings/passkeys/", requireUser, async (c) => {
  if (!(await signedInRecently(c))) return c.json({ error: NOTICES["passkey-stale"] }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!(await addPasskey(c, c.get("user")!.id, body.token, body.response, text(body.name, 60) || "Passkey"))) {
    return c.json({ error: "The passkey could not be added. Nothing was changed." }, 400);
  }
  return c.json({ ok: true });
});

settings.post("/account/settings/passkeys/remove/", requireUser, async (c) => {
  if (!(await signedInRecently(c))) return back(c, "two-step", "passkey-stale", "#h-passkeys");
  await c.env.DB.prepare("DELETE FROM passkeys WHERE credential_id = ? AND user_id = ?").bind(String((await c.req.parseBody()).id ?? ""), c.get("user")!.id).run();
  return back(c, "two-step", "passkey-removed", "#h-passkeys");
});

const staleToken = (c: C) =>
  renderSettings(c, "tokens", undefined, undefined, {
    notice: `To make or revoke a token, sign out and sign in again, then do it within ${FRESH_SIGN_IN_MINUTES} minutes. This keeps a token out of reach of anyone at a browser you left signed in.`,
  }).then((page) => c.html(page, 403));

settings.post("/account/settings/tokens/", requireUser, async (c) => {
  const user = c.get("user")!;
  if (!(await signedInRecently(c))) return staleToken(c);
  const label = String((await c.req.parseBody()).label ?? "").trim().slice(0, 80) || null;
  const token = "eelsdb_draft_" + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await c.env.DB.prepare("INSERT INTO draft_tokens (user_id, hash, label) VALUES (?, ?, ?)").bind(user.id, await sha256(token), label).run();
  c.header("Cache-Control", "no-store");
  return c.html(await renderSettings(c, "tokens", undefined, undefined, { created: token }));
});

settings.post("/account/settings/tokens/:id/revoke/", requireUser, async (c) => {
  if (!(await signedInRecently(c))) return staleToken(c);
  await c.env.DB.prepare("DELETE FROM draft_tokens WHERE id = ? AND user_id = ?").bind(Number(c.req.param("id")), c.get("user")!.id).run();
  return back(c, "tokens", "token-revoked");
});
