// Account edits shared by a person's own settings and the admin pages: both pass the id of the account being changed.
import { avatarUrl, sha256 } from "./auth";
import { sendEmail } from "./email";
import { Avatar } from "./pages/layout";
import { LinkIcon } from "./pages/link-icons";
import { LINK_FIELDS, parseLink, parseLinks, parseUsername } from "./pages/profile";

export const VERIFY_HOURS = 24;
export const MAX_EMAILS_PER_DAY = 5;
const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_TYPES: [ext: string, type: string, magic: (b: Uint8Array) => boolean][] = [
  ["png", "image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["jpg", "image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["webp", "image/webp", (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP"],
];

export type Profile = Record<string, string>;
export type EmailRow = { id: number; email: string; verified: number; is_primary: number };

export const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function Field(props: { name: string; label: string; errors: Profile; hint?: any; children: any }) {
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
  const row = await db.prepare("SELECT display_name, slug, job_title, affiliation, links_json, avatar_key, use_gravatar, show_details, show_links FROM users WHERE id = ?")
    .bind(userId).first<any>();
  return {
    display_name: row.display_name ?? "",
    username: row.slug ?? "",
    job_title: row.job_title ?? "",
    affiliation: row.affiliation ?? "",
    picture: row.avatar_key ? "upload" : row.use_gravatar ? "gravatar" : "initials",
    show_details: row.show_details ? "1" : "",
    show_links: row.show_links ? "1" : "",
    ...Object.fromEntries(Object.entries(parseLinks(row.links_json)).map(([k, v]) => [`link_${k}`, v])),
  };
}

const mine = (who: string) => (who === "your" ? "my" : "their");

/** Name, username, job title and affiliation, with the switch for showing the last two. */
export function DetailsFields(props: { v: Profile; errors: Profile; origin: string; who: string }) {
  const { v, errors } = props;
  const page = `${props.origin}/author/${v.username || "username"}/`;
  return (
    <>
      <div class="profile-fields">
        <Field name="display_name" label="Name" errors={errors} hint={`Shown as the author of ${props.who} spectra.`}>
          <input id="f-display_name" name="display_name" type="text" required maxlength={100} value={v.display_name} autocomplete="name" />
        </Field>
        <Field name="username" label="Username" errors={errors} hint={<>{props.who === "your" ? "Your" : "Their"} page: {v.username ? <a href={page}>{page}</a> : page}</>}>
          <input id="f-username" name="username" type="text" maxlength={40} value={v.username} autocomplete="username" spellcheck={false} />
        </Field>
        <Field name="job_title" label="Job title" errors={errors}>
          <input id="f-job_title" name="job_title" type="text" maxlength={100} value={v.job_title} autocomplete="organization-title" />
        </Field>
        <Field name="affiliation" label="Affiliation" errors={errors}>
          <input id="f-affiliation" name="affiliation" type="text" maxlength={200} value={v.affiliation} autocomplete="organization" />
        </Field>
      </div>
      <Field name="show_details" label="Public" errors={errors}>
        <label class="check">
          <input id="f-show_details" type="checkbox" name="show_details" value="1" checked={!!v.show_details} /> Show {mine(props.who)} job title and affiliation on {mine(props.who)} author page
        </label>
      </Field>
    </>
  );
}

/** One link row: the service's mark on the left and a full-width input; the mark and aria-label name it, so there is no visible label. */
function LinkRow(props: { name: string; field: string; label: string; value: string; placeholder: string; errors: Profile }) {
  const error = props.errors[props.field];
  return (
    <div class={`link-row${error ? " has-error" : ""}`}>
      <LinkIcon name={props.name} />
      <input id={`f-${props.field}`} name={props.field} type="text" maxlength={200} value={props.value} placeholder={props.placeholder} aria-label={props.label} spellcheck={false} />
      {error && <p class="error">{error}</p>}
    </div>
  );
}

/**
 * Two labelled web page fields, then the social accounts as icon rows, with the switch for showing them all. The ORCID row
 * shows the linked iD, or a button to link one (`linkNext` is where to return to; null for no button), or nothing.
 */
export function LinkFields(props: { v: Profile; errors: Profile; orcid: string | null; linkNext: string | null; who: string; orcidOff?: boolean }) {
  const { v, errors } = props;
  return (
    <>
      {LINK_FIELDS.filter((f) => f.web).map((f) => (
        <Field name={`link_${f.key}`} label={f.label} errors={errors}>
          <input id={`f-link_${f.key}`} name={`link_${f.key}`} type="text" maxlength={200} value={v[`link_${f.key}`] ?? ""} placeholder={f.placeholder} spellcheck={false} />
        </Field>
      ))}
      <h3>Social accounts</h3>
      <div class="link-list">
        {(props.orcid || props.linkNext || props.orcidOff) && (
          <div class={!props.orcid && !props.linkNext ? "link-row is-off" : "link-row"}>
            <LinkIcon name="orcid" />
            {props.orcid ? (
              <p class="link-linked"><a href={`https://orcid.org/${props.orcid}`}>{props.orcid}</a> <span class="muted">Linked</span></p>
            ) : props.linkNext ? (
              <p class="link-linked"><a class="button secondary" href={`/auth/orcid/link?next=${encodeURIComponent(props.linkNext)}`}>Link ORCID</a></p>
            ) : (
              <p class="link-linked"><button class="button secondary" type="button" disabled>Link ORCID</button> <span class="muted small">ORCID sign-in is not available at the moment.</span></p>
            )}
          </div>
        )}
        {LINK_FIELDS.filter((f) => !f.web).map((f) => (
          <LinkRow name={f.key} field={`link_${f.key}`} label={f.label} value={v[`link_${f.key}`] ?? ""} placeholder={f.placeholder} errors={errors} />
        ))}
      </div>
      <Field name="show_links" label="Public" errors={errors}>
        <label class="check">
          <input id="f-show_links" type="checkbox" name="show_links" value="1" checked={!!v.show_links} /> Show {mine(props.who)} web pages, ORCID iD and social accounts on {mine(props.who)} author page
        </label>
      </Field>
    </>
  );
}

function PictureOption(props: { value: string; label: string; picked: string; hint: any; preview: any; disabled?: boolean; children?: any }) {
  const id = `f-picture-${props.value}`;
  return (
    <div class={`picture-option${props.disabled ? " is-off" : ""}`} data-option={props.value}>
      <input type="radio" name="picture" id={id} value={props.value} checked={props.picked === props.value} disabled={props.disabled} aria-describedby={`${id}-hint`} />
      <label for={id}>
        {props.preview}
        <span class="picture-name">{props.label}</span>
      </label>
      <p class="hint" id={`${id}-hint`} aria-live={props.children ? "polite" : undefined}>{props.hint}</p>
      {props.children}
    </div>
  );
}

/**
 * The picture as one choice of three, each card previewing what people will see; it saves with the rest of the profile.
 * `uploads` adds the file input (the form must then be multipart); the admin page leaves it out.
 */
export function PictureChoice(props: {
  v: Profile; errors: Profile; name: string; seed: string; state: { key: string | null; email: string | null; gravatar: string | null }; who: string; uploads: boolean; heading: "h2" | "h3";
}) {
  const { v, errors, state, who } = props;
  const Their = who === "your" ? "Your" : "Their";
  const initials = <Avatar name={props.name} seed={props.seed} class="av-large" />;
  return (
    <fieldset class={`picture-choice${errors.picture ? " has-error" : ""}`}>
      <legend>{props.heading === "h2" ? <h2 id="h-avatar">Picture</h2> : <h3>Picture</h3>}</legend>
      <div class="picture-options">
        <PictureOption value="initials" label="Initials" picked={v.picture} preview={initials} hint={`From ${who} name.`} />
        <PictureOption
          value="gravatar" label="Gravatar" picked={v.picture} disabled={!state.email}
          preview={<Avatar name={props.name} seed={props.seed} src={state.gravatar} class="av-large" />}
          hint={state.email
            ? <>From gravatar.com for <span class="picture-email">{state.email.split("@")[0]}@<wbr />{state.email.split("@")[1]}</span>. Initials show if it has none.</>
            : `Needs a confirmed primary email address${who === "your" ? ": add one under Email addresses" : ""}.`}
        />
        <PictureOption
          value="upload" label={`${Their} picture`} picked={v.picture} disabled={!props.uploads && !state.key}
          preview={state.key ? <Avatar name={props.name} seed={props.seed} src={`/avatars/${state.key}`} class="av-large" /> : <span class="av av-large picture-empty" aria-hidden="true" />}
          hint={props.uploads
            ? (state.key ? "Choose a new one to replace it." : "PNG, JPEG or WebP, under 512 KB. Drop one here or choose a file.")
            : (state.key ? "Picking another option deletes it." : "They have not uploaded one.")}
        >
          {props.uploads && (
            <div class="picture-file">
              <input type="file" name="avatar" id="f-avatar" accept="image/png,image/jpeg,image/webp" aria-describedby="f-picture-upload-hint" />
              <label for="f-avatar" class="button secondary">Choose a picture</label>
            </div>
          )}
        </PictureOption>
      </div>
      {errors.picture && <p class="error" role="alert">{errors.picture}</p>}
    </fieldset>
  );
}

/** Both field groups in one run, for the admin page. */
export function ProfileFields(props: { v: Profile; errors: Profile; origin: string; orcid: string | null; linkNext: string | null; who: string }) {
  return (
    <>
      <DetailsFields v={props.v} errors={props.errors} origin={props.origin} who={props.who} />
      <h3>Links</h3>
      <LinkFields v={props.v} errors={props.errors} orcid={props.orcid} linkNext={props.linkNext} who={props.who} />
    </>
  );
}

/** The uploaded picture's key, and the primary address if it is confirmed: Gravatar is only offered for that one. */
export async function pictureState(db: D1Database, userId: number) {
  const row = await db.prepare(
    "SELECT avatar_key, (SELECT e.email FROM user_emails e WHERE e.user_id = u.id AND e.is_primary = 1 AND e.verified = 1) AS email FROM users u WHERE u.id = ?",
  ).bind(userId).first<{ avatar_key: string | null; email: string | null }>();
  return { key: row?.avatar_key ?? null, email: row?.email ?? null, gravatar: row?.email ? (await avatarUrl(null, row.email, 1))!.replace("s=64", "s=160") : null };
}

type Picture = { choice: string; file?: { bytes: Uint8Array; ext: string; type: string } } | { error: string; file?: true };

/** A chosen file means "Your picture", as choosing one does in the browser, so a form sent without JavaScript does the same. */
async function checkPicture(body: Record<string, unknown>, current: string, state: { key: string | null; email: string | null }, uploads: boolean): Promise<Picture> {
  const file = uploads && body.avatar instanceof File && body.avatar.size ? body.avatar : null;
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = file.size <= MAX_AVATAR_BYTES && AVATAR_TYPES.find(([, , magic]) => magic(bytes));
    if (!kind) return { error: "That picture could not be used. Use a PNG, JPEG or WebP file under 512 KB, and choose it again.", file: true };
    return { choice: "upload", file: { bytes, ext: kind[0], type: kind[1] } };
  }
  const choice = typeof body.picture === "string" && body.picture ? body.picture : current;
  if (choice === "initials") return { choice };
  if (choice === "gravatar") return state.email ? { choice } : { error: "Gravatar needs a confirmed primary email address." };
  if (choice === "upload") {
    if (state.key) return { choice };
    return { error: uploads ? "Choose a picture file to upload, or pick Initials or Gravatar." : "There is no uploaded picture to keep." };
  }
  return { error: "Pick one of the options." };
}

/**
 * Checks the form like the user's own settings do and saves it; returns the values and errors when something is wrong, and nothing was saved.
 * `uploads` is false on the admin page, where a picture can be dropped but not uploaded.
 */
export async function saveProfile(env: Env, userId: number, body: Record<string, unknown>, uploads: boolean): Promise<{ values: Profile; errors: Profile } | null> {
  const db = env.DB;
  const values: Profile = Object.fromEntries(Object.entries(body).filter(([, x]) => typeof x === "string").map(([k, x]) => [k, String(x).trim()]));
  const errors: Profile = {};
  const stored = await storedProfile(db, userId);
  const state = await pictureState(db, userId);
  const picture = await checkPicture(body, stored.picture, state, uploads);
  if ("error" in picture) errors.picture = picture.error;
  if (picture.file) values.picture = "upload";
  else if ("choice" in picture) values.picture = picture.choice;

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
  if ((values.show_details || values.show_links) && !username && !errors.username) errors.username = "Choose a username for the public profile address.";

  const links: Record<string, string> = {};
  for (const f of LINK_FIELDS) {
    const parsed = parseLink(f.key, values[`link_${f.key}`] ?? "");
    if ("error" in parsed) errors[`link_${f.key}`] = parsed.error;
    else if (parsed.value) links[f.key] = parsed.value;
  }

  if (Object.keys(errors).length || "error" in picture) {
    if (picture.file && !errors.picture) errors.picture = "Nothing was saved, so choose your picture again: browsers do not keep a chosen file after an error.";
    return { values, errors };
  }

  const statements = [
    db.prepare("UPDATE users SET display_name = ?, job_title = ?, affiliation = ?, links_json = ?, show_details = ?, show_links = ?, slug = ? WHERE id = ?").bind(
      name, text(body.job_title, 100) || null, text(body.affiliation, 200) || null,
      Object.keys(links).length ? JSON.stringify(links) : null, values.show_details ? 1 : 0, values.show_links ? 1 : 0, username, userId,
    ),
    // Spectra carry the author's name and address for the API and listings. Showing links publishes the ORCID iD in
    // harvested metadata, so that counts as a change to the spectra too.
    db.prepare(
      `UPDATE spectra SET author_display = ?1, author_slug = COALESCE(?2, author_slug),
         updated_at = CASE WHEN author_display IS NOT ?1 OR author_slug IS NOT COALESCE(?2, author_slug) OR ?3 THEN datetime('now') ELSE updated_at END
       WHERE owner_id = ?4`,
    ).bind(name, username, (values.show_links ? "1" : "") !== stored.show_links ? 1 : 0, userId),
  ];
  if (username && stored.username && username !== stored.username) {
    statements.push(
      db.prepare("INSERT OR REPLACE INTO user_slug_history (slug, user_id) VALUES (?, ?)").bind(stored.username, userId),
      db.prepare("DELETE FROM user_slug_history WHERE slug = ?").bind(username),
    );
  }
  let key = picture.choice === "upload" ? state.key : null;
  if (picture.file) {
    // A new name each time, so browsers and caches never show the old picture.
    key = `${userId}/${crypto.randomUUID()}.${picture.file.ext}`;
    await env.FILES.put(`avatars/${key}`, picture.file.bytes, { httpMetadata: { contentType: picture.file.type } });
  }
  statements.push(db.prepare("UPDATE users SET avatar_key = ?, use_gravatar = ? WHERE id = ?").bind(key, picture.choice === "gravatar" ? 1 : 0, userId));
  await db.batch(statements);
  if (state.key && state.key !== key) await env.FILES.delete(`avatars/${state.key}`);
  return null;
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
    "INSERT INTO user_emails (user_id, email, is_primary) VALUES (?1, ?2, NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = ?1 AND is_primary = 1)) ON CONFLICT (user_id, email) DO UPDATE SET email = excluded.email RETURNING id, email, verified",
  ).bind(userId, email).first<{ id: number; email: string; verified: number }>();
  if (row && !row.verified) await sendVerification(env, origin, row, intro);
  return "sent";
}

export const emailOf = (db: D1Database, userId: number, emailId: number) =>
  db.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE id = ? AND user_id = ?").bind(emailId, userId).first<EmailRow>();

/** Returns whether a link was sent: not for a confirmed address, nor over the daily limit. */
export async function resendVerification(env: Env, origin: string, userId: number, row: EmailRow, intro: string) {
  if (row.verified || !(await allowEmail(env.DB, userId))) return false;
  await sendVerification(env, origin, row, intro);
  return true;
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
