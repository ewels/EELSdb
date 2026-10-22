// Account edits shared by a person's own settings and the admin pages: both pass the id of the account being changed.
import { sha256 } from "./auth";
import { sendEmail } from "./email";
import { LINK_FIELDS, parseLink, parseLinks, parseOrcid, parseUsername } from "./pages/profile";

export const VERIFY_HOURS = 24;
export const MAX_EMAILS_PER_DAY = 5;

export type Profile = Record<string, string>;
export type EmailRow = { id: number; email: string; verified: number; is_primary: number };

export const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function Field(props: { name: string; label: string; errors: Profile; hint?: string; children: any }) {
  return (
    <div class={`field${props.errors[props.name] ? " has-error" : ""}`}>
      <label for={`f-${props.name}`}>{props.label}</label>
      {props.children}
      {props.hint && <p class="hint">{props.hint}</p>}
      {props.errors[props.name] && <p class="error">{props.errors[props.name]}</p>}
    </div>
  );
}

export async function storedProfile(db: D1Database, userId: number): Promise<Profile> {
  const row = await db.prepare("SELECT display_name, slug, job_title, affiliation, orcid, links_json, profile_public FROM users WHERE id = ?")
    .bind(userId).first<any>();
  return {
    display_name: row.display_name ?? "",
    username: row.slug ?? "",
    job_title: row.job_title ?? "",
    affiliation: row.affiliation ?? "",
    orcid: row.orcid ?? "",
    profile_public: row.profile_public ? "1" : "",
    ...Object.fromEntries(Object.entries(parseLinks(row.links_json)).map(([k, v]) => [`link_${k}`, v])),
  };
}

/** The profile fields, with the same inputs in settings and on the admin page. */
export function ProfileFields(props: { v: Profile; errors: Profile; origin: string; orcidLocked: boolean; who: string }) {
  const { v, errors } = props;
  return (
    <>
      <div class="grid-2">
        <Field name="display_name" label="Name" errors={errors} hint={`Shown as the author of ${props.who} spectra.`}>
          <input id="f-display_name" name="display_name" type="text" required maxlength={100} value={v.display_name} autocomplete="name" />
        </Field>
        <Field name="username" label="Username" errors={errors} hint={`${props.who === "your" ? "Your" : "Their"} page: ${props.origin}/author/${v.username || "username"}/`}>
          <input id="f-username" name="username" type="text" maxlength={40} value={v.username} autocomplete="username" spellcheck={false} />
        </Field>
        <Field name="job_title" label="Job title" errors={errors}>
          <input id="f-job_title" name="job_title" type="text" maxlength={100} value={v.job_title} autocomplete="organization-title" />
        </Field>
        <Field name="affiliation" label="Affiliation" errors={errors}>
          <input id="f-affiliation" name="affiliation" type="text" maxlength={200} value={v.affiliation} autocomplete="organization" />
        </Field>
      </div>
      <h3>Links</h3>
      <div class="grid-2">
        <Field name="orcid" label="ORCID iD" errors={errors} hint={props.orcidLocked ? "From an ORCID sign-in." : undefined}>
          <input id="f-orcid" name="orcid" type="text" value={v.orcid} placeholder="0000-0002-1825-0097" readonly={props.orcidLocked} spellcheck={false} />
        </Field>
        {LINK_FIELDS.map((f) => (
          <Field name={`link_${f.key}`} label={f.label} errors={errors}>
            <input id={`f-link_${f.key}`} name={`link_${f.key}`} type="text" maxlength={200} value={v[`link_${f.key}`] ?? ""} placeholder={f.placeholder} spellcheck={false} />
          </Field>
        ))}
      </div>
      <Field name="profile_public" label="Public profile" errors={errors}>
        <label class="check">
          <input id="f-profile_public" type="checkbox" name="profile_public" value="1" checked={!!v.profile_public} /> Show {props.who === "your" ? "my" : "the"} picture,
          job title, affiliation and links on {props.who === "your" ? "my" : "the"} author page, with the spectra {props.who === "your" ? "I have" : "they have"} contributed
        </label>
      </Field>
    </>
  );
}

/** Checks the form like the user's own settings do and saves it; returns the values and errors when something is wrong, and nothing was saved. */
export async function saveProfile(db: D1Database, userId: number, body: Record<string, unknown>): Promise<{ values: Profile; errors: Profile } | null> {
  const values: Profile = Object.fromEntries(Object.entries(body).filter(([, x]) => typeof x === "string").map(([k, x]) => [k, String(x).trim()]));
  const errors: Profile = {};
  const stored = await storedProfile(db, userId);

  const name = text(body.display_name, 100);
  if (!name) errors.display_name = "Enter a name.";

  let username: string | null = stored.username || null;
  if (values.username && values.username.toLowerCase() !== stored.username) {
    const parsed = parseUsername(values.username);
    if ("error" in parsed) errors.username = parsed.error;
    else {
      const taken = await db.prepare(
        `SELECT 1 FROM users WHERE slug = ?1 AND id != ?2
         UNION SELECT 1 FROM spectra WHERE author_slug = ?1 AND (owner_id IS NULL OR owner_id != ?2)
         UNION SELECT 1 FROM user_slug_history WHERE slug = ?1 AND user_id != ?2`,
      ).bind(parsed.value, userId).first();
      if (taken) errors.username = "That username is taken.";
      else username = parsed.value;
    }
  } else if (!values.username && stored.username) {
    errors.username = "The username is part of the author page address, so it cannot be empty.";
  }
  if (values.profile_public && !username && !errors.username) errors.username = "Choose a username for the public profile address.";

  const identities = await db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = 'orcid'").bind(userId).first();
  let orcid: string | null = stored.orcid || null;
  if (!identities) {
    const parsed = parseOrcid(values.orcid ?? "");
    if ("error" in parsed) errors.orcid = parsed.error;
    else orcid = parsed.value;
  }

  const links: Record<string, string> = {};
  for (const f of LINK_FIELDS) {
    const parsed = parseLink(f.key, values[`link_${f.key}`] ?? "");
    if ("error" in parsed) errors[`link_${f.key}`] = parsed.error;
    else if (parsed.value) links[f.key] = parsed.value;
  }

  if (Object.keys(errors).length) return { values: { ...values, orcid: orcid ?? values.orcid ?? "" }, errors };

  const statements = [
    db.prepare("UPDATE users SET display_name = ?, job_title = ?, affiliation = ?, orcid = ?, links_json = ?, profile_public = ?, slug = ? WHERE id = ?").bind(
      name, text(body.job_title, 100) || null, text(body.affiliation, 200) || null, orcid,
      Object.keys(links).length ? JSON.stringify(links) : null, values.profile_public ? 1 : 0, username, userId,
    ),
    // Spectra carry the author's name and address for the API and listings.
    db.prepare("UPDATE spectra SET author_display = ?, author_slug = COALESCE(?, author_slug) WHERE owner_id = ?").bind(name, username, userId),
  ];
  if (username && stored.username && username !== stored.username) {
    statements.push(
      db.prepare("INSERT OR REPLACE INTO user_slug_history (slug, user_id) VALUES (?, ?)").bind(stored.username, userId),
      db.prepare("DELETE FROM user_slug_history WHERE slug = ?").bind(username),
    );
  }
  await db.batch(statements);
  return null;
}

export async function removeAvatar(env: Env, userId: number) {
  const key = await env.DB.prepare("SELECT avatar_key FROM users WHERE id = ?").bind(userId).first<string | null>("avatar_key");
  await env.DB.prepare("UPDATE users SET avatar_key = NULL WHERE id = ?").bind(userId).run();
  if (key) await env.FILES.delete(`avatars/${key}`);
}

/** `intro` says who added the address; the link only works while signed in to the account. */
export async function sendVerification(env: Env, origin: string, row: { id: number; email: string }, intro: string) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO email_verifications (token_hash, email_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), row.id, new Date(Date.now() + VERIFY_HOURS * 3600_000).toISOString())
    .run();
  await sendEmail(env, {
    to: row.email,
    subject: "Confirm your email address for the EELS Data Base",
    text: `${intro}\n\nIf that was you, open this link while signed in (it works for ${VERIFY_HOURS} hours):\n${origin}/account/emails/verify/${token}/\n\nIf not, ignore this email.`,
  });
}

/** Rate-limited per account; the same answer whatever happens, so the form cannot tell which addresses have accounts. */
export async function allowEmail(db: D1Database, userId: number) {
  const key = String(userId);
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'email' AND key = ? AND at > datetime('now', '-1 day')")
    .bind(key).first<number>("n");
  if ((recent ?? 0) >= MAX_EMAILS_PER_DAY) return false;
  await db.prepare("INSERT INTO rate_events (kind, key) VALUES ('email', ?)").bind(key).run();
  return true;
}

/** Adds an unconfirmed address and sends its confirmation link. Nobody can mark an address confirmed except by opening that link. */
export async function addEmail(env: Env, origin: string, userId: number, input: unknown, intro: string): Promise<"sent" | "email-bad" | "limit"> {
  const email = text(input, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "email-bad";
  if (!(await allowEmail(env.DB, userId))) return "limit";
  const row = await env.DB.prepare(
    "INSERT INTO user_emails (user_id, email) VALUES (?, ?) ON CONFLICT (user_id, email) DO UPDATE SET email = excluded.email RETURNING id, email, verified",
  ).bind(userId, email).first<{ id: number; email: string; verified: number }>();
  if (row && !row.verified) await sendVerification(env, origin, row, intro);
  return "sent";
}

export const emailOf = (db: D1Database, userId: number, emailId: number) =>
  db.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE id = ? AND user_id = ?").bind(emailId, userId).first<EmailRow>();

export async function resendVerification(env: Env, origin: string, userId: number, row: EmailRow, intro: string) {
  if (!row.verified && (await allowEmail(env.DB, userId))) await sendVerification(env, origin, row, intro);
}

export async function makePrimary(db: D1Database, userId: number, row: EmailRow) {
  await db.batch([
    db.prepare("UPDATE user_emails SET is_primary = 0 WHERE user_id = ?").bind(userId),
    db.prepare("UPDATE user_emails SET is_primary = 1 WHERE id = ?").bind(row.id),
  ]);
}

export async function removeEmail(db: D1Database, row: EmailRow): Promise<"removed" | "keep-primary"> {
  if (row.is_primary) return "keep-primary";
  await db.prepare("DELETE FROM user_emails WHERE id = ?").bind(row.id).run();
  return "removed";
}

/** The list of addresses with the per-address forms under `base` (`{base}/{id}/primary/` and so on). */
export function EmailList(props: { emails: EmailRow[]; base: string; extra?: (e: EmailRow) => any }) {
  return (
    <ul class="email-list">
      {props.emails.map((e) => (
        <li>
          <span class="email-address">{e.email}</span>
          <span class="email-tags">
            {e.is_primary ? <span class="tag tag-primary">Primary</span> : null}
            {e.verified ? <span class="tag">Confirmed</span> : <span class="tag tag-pending">Not confirmed</span>}
          </span>
          <span class="email-actions">
            {e.verified && !e.is_primary ? (
              <form method="post" action={`${props.base}/${e.id}/primary/`}><button class="link-button" type="submit">Make primary</button></form>
            ) : null}
            {!e.verified ? (
              <form method="post" action={`${props.base}/${e.id}/send/`}><button class="link-button" type="submit">Send link</button></form>
            ) : null}
            {props.extra?.(e)}
            {!e.is_primary ? (
              <form method="post" action={`${props.base}/${e.id}/remove/`}><button class="link-button danger" type="submit">Remove</button></form>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
