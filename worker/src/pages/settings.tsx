import { Hono, type Context } from "hono";
import { PROVIDERS, requireUser, sha256, syncEmails, type AppEnv } from "../auth";
import { sendEmail } from "../email";
import { Avatar, Layout } from "./layout";
import { LINK_FIELDS, parseLink, parseLinks, parseOrcid, parseUsername } from "./profile";

export const settings = new Hono<AppEnv>();
type C = Context<AppEnv>;

const VERIFY_HOURS = 24;
const MAX_EMAILS_PER_DAY = 5;
const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_TYPES: [ext: string, type: string, magic: (b: Uint8Array) => boolean][] = [
  ["png", "image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["jpg", "image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["webp", "image/webp", (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP"],
];
const THEMES = [
  ["system", "Same as your device"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;

const NOTICES: Record<string, string> = {
  profile: "Profile saved.",
  theme: "Appearance saved.",
  avatar: "Picture saved.",
  "avatar-removed": "Picture removed. Your avatar now comes from Gravatar, if you have one there.",
  "avatar-bad": "That picture could not be used. Use a PNG, JPEG or WebP file under 512 KB.",
  sent: `If that address can be added, we have emailed it a link. The link works for ${VERIFY_HOURS} hours.`,
  limit: `You can add up to ${MAX_EMAILS_PER_DAY} addresses a day. Please try again tomorrow.`,
  "email-bad": "That does not look like an email address.",
  verified: "Email address confirmed.",
  "verify-failed": "This link has expired, was already used, belongs to another signed-in account, or the address is confirmed on another account.",
  primary: "Primary address changed.",
  removed: "Address removed.",
  "keep-primary": "Make another confirmed address primary before removing this one.",
};

type EmailRow = { id: number; email: string; verified: number; is_primary: number };

type Profile = Record<string, string>;

function Field(props: { name: string; label: string; errors: Profile; hint?: string; children: any }) {
  return (
    <div class={`field${props.errors[props.name] ? " has-error" : ""}`}>
      <label for={`f-${props.name}`}>{props.label}</label>
      {props.children}
      {props.hint && <p class="hint">{props.hint}</p>}
      {props.errors[props.name] && <p class="error">{props.errors[props.name]}</p>}
    </div>
  );
}

async function storedProfile(db: D1Database, userId: number): Promise<Profile> {
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

async function renderSettings(c: C, form?: { values: Profile; errors: Profile }) {
  const user = c.get("user")!;
  const db = c.env.DB;
  const [{ results: emails }, { results: identities }] = await db.batch<any>([
    db.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE user_id = ? ORDER BY is_primary DESC, verified DESC, email").bind(user.id),
    db.prepare("SELECT provider, email FROM identities WHERE user_id = ? ORDER BY provider").bind(user.id),
  ]);
  const v = form?.values ?? (await storedProfile(db, user.id));
  const errors = form?.errors ?? {};
  const orcidLocked = identities.some((i: any) => i.provider === "orcid");
  const origin = new URL(c.req.url).origin;
  const notice = form ? null : NOTICES[c.req.query("notice") ?? ""];
  return (
    <Layout title="Settings" path="/account/" user={user}>
      <div class="settings">
        <p class="small back-link"><a href="/account/">← Your account</a></p>
        <h1>Settings</h1>
        {notice && <p class="notice" role="status">{notice}</p>}

        <section class="settings-section" aria-labelledby="h-profile">
          <h2 id="h-profile">Profile</h2>
          {Object.keys(errors).length > 0 && <p class="notice error-summary" role="alert">Some fields need attention. Nothing was saved.</p>}
          <form method="post" action="/account/settings/profile/" class="settings-form">
            <div class="grid-2">
              <Field name="display_name" label="Name" errors={errors} hint="Shown as the author of your spectra.">
                <input id="f-display_name" name="display_name" type="text" required maxlength={100} value={v.display_name} autocomplete="name" />
              </Field>
              <Field name="username" label="Username" errors={errors} hint={`Your page: ${origin}/author/${v.username || "username"}/`}>
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
              <Field name="orcid" label="ORCID iD" errors={errors} hint={orcidLocked ? "From your ORCID sign-in." : undefined}>
                <input id="f-orcid" name="orcid" type="text" value={v.orcid} placeholder="0000-0002-1825-0097" readonly={orcidLocked} spellcheck={false} />
              </Field>
              {LINK_FIELDS.map((f) => (
                <Field name={`link_${f.key}`} label={f.label} errors={errors}>
                  <input id={`f-link_${f.key}`} name={`link_${f.key}`} type="text" maxlength={200} value={v[`link_${f.key}`] ?? ""} placeholder={f.placeholder} spellcheck={false} />
                </Field>
              ))}
            </div>
            <Field name="profile_public" label="Public profile" errors={errors}>
              <label class="check">
                <input id="f-profile_public" type="checkbox" name="profile_public" value="1" checked={!!v.profile_public} /> Show my picture, job title, affiliation
                and links on my author page, with the spectra I have contributed
              </label>
            </Field>
            <div><button class="button" type="submit">Save profile</button></div>
          </form>
        </section>

        <section class="settings-section" aria-labelledby="h-avatar">
          <h2 id="h-avatar">Picture</h2>
          <div class="avatar-row">
            <Avatar name={user.display_name} seed={user.slug ?? user.display_name} src={user.avatar?.replace("s=64", "s=160")} class="av-large" />
            <div class="avatar-actions">
              <p class="hint">
                {user.avatar_key
                  ? "Your uploaded picture."
                  : <>Taken from <a href="https://gravatar.com/">Gravatar</a> for your primary address, if you have one there. Otherwise your initials are shown. You can upload your own picture instead.</>}
              </p>
              <form method="post" action="/account/settings/avatar/" enctype="multipart/form-data" class="inline-form" id="avatar-form">
                <input type="file" name="avatar" id="f-avatar" accept="image/png,image/jpeg,image/webp" required aria-label="Picture to upload" />
                <button class="button secondary" type="submit">Upload</button>
              </form>
              {user.avatar_key && (
                <form method="post" action="/account/settings/avatar/remove/">
                  <button class="link-button" type="submit">Remove picture and use Gravatar</button>
                </form>
              )}
            </div>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="h-emails">
          <h2 id="h-emails">Email addresses</h2>
          <p class="hint">The primary address is used for your avatar and for messages about your submissions. Addresses are never shown on the site.</p>
          {emails.length > 0 && (
            <ul class="email-list">
              {(emails as EmailRow[]).map((e) => (
                <li>
                  <span class="email-address">{e.email}</span>
                  <span class="email-tags">
                    {e.is_primary ? <span class="tag tag-primary">Primary</span> : null}
                    {e.verified ? <span class="tag">Confirmed</span> : <span class="tag tag-pending">Not confirmed</span>}
                  </span>
                  <span class="email-actions">
                    {e.verified && !e.is_primary ? (
                      <form method="post" action={`/account/settings/emails/${e.id}/primary/`}><button class="link-button" type="submit">Make primary</button></form>
                    ) : null}
                    {!e.verified ? (
                      <form method="post" action={`/account/settings/emails/${e.id}/send/`}><button class="link-button" type="submit">Send link</button></form>
                    ) : null}
                    {!e.is_primary ? (
                      <form method="post" action={`/account/settings/emails/${e.id}/remove/`}><button class="link-button danger" type="submit">Remove</button></form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form method="post" action="/account/settings/emails/" class="inline-form">
            <input type="email" name="email" required aria-label="Email address to add" autocomplete="email" placeholder="name@example.org" />
            <button class="button secondary" type="submit">Add address</button>
          </form>
        </section>

        <section class="settings-section" aria-labelledby="h-signin">
          <h2 id="h-signin">Sign-in methods</h2>
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
            <p class="muted">You sign in with your password from the old site. Sign in once with ORCID, Google or GitHub to link one of them.</p>
          )}
        </section>
      </div>
      <script src="/settings.js" type="module"></script>
    </Layout>
  );
}

settings.get("/account/settings/", requireUser, async (c) => c.html(await renderSettings(c)));

const back = (c: C, notice: string) => c.redirect(`/account/settings/?notice=${notice}`);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

settings.post("/account/settings/profile/", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const body = await c.req.parseBody();
  const values: Profile = Object.fromEntries(Object.entries(body).filter(([, x]) => typeof x === "string").map(([k, x]) => [k, String(x).trim()]));
  const errors: Profile = {};
  const stored = await storedProfile(db, user.id);

  const name = text(body.display_name, 100);
  if (!name) errors.display_name = "Enter your name.";

  let username: string | null = stored.username || null;
  if (values.username && values.username.toLowerCase() !== stored.username) {
    const parsed = parseUsername(values.username);
    if ("error" in parsed) errors.username = parsed.error;
    else {
      const taken = await db.prepare(
        `SELECT 1 FROM users WHERE slug = ?1 AND id != ?2
         UNION SELECT 1 FROM spectra WHERE author_slug = ?1 AND (owner_id IS NULL OR owner_id != ?2)
         UNION SELECT 1 FROM user_slug_history WHERE slug = ?1 AND user_id != ?2`,
      ).bind(parsed.value, user.id).first();
      if (taken) errors.username = "That username is taken.";
      else username = parsed.value;
    }
  } else if (!values.username && stored.username) {
    errors.username = "Your username is part of your author page address, so it cannot be empty.";
  }
  if (values.profile_public && !username && !errors.username) errors.username = "Choose a username for your public profile address.";

  const identities = await db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = 'orcid'").bind(user.id).first();
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

  if (Object.keys(errors).length) return c.html(await renderSettings(c, { values: { ...values, orcid: orcid ?? values.orcid ?? "" }, errors }), 422);

  const statements = [
    db.prepare("UPDATE users SET display_name = ?, job_title = ?, affiliation = ?, orcid = ?, links_json = ?, profile_public = ?, slug = ? WHERE id = ?").bind(
      name, text(body.job_title, 100) || null, text(body.affiliation, 200) || null, orcid,
      Object.keys(links).length ? JSON.stringify(links) : null, values.profile_public ? 1 : 0, username, user.id,
    ),
    // Spectra carry the author's name and address for the API and listings.
    db.prepare("UPDATE spectra SET author_display = ?, author_slug = COALESCE(?, author_slug) WHERE owner_id = ?").bind(name, username, user.id),
  ];
  if (username && stored.username && username !== stored.username) {
    statements.push(
      db.prepare("INSERT OR REPLACE INTO user_slug_history (slug, user_id) VALUES (?, ?)").bind(stored.username, user.id),
      db.prepare("DELETE FROM user_slug_history WHERE slug = ?").bind(username),
    );
  }
  await db.batch(statements);
  return back(c, "profile");
});

settings.post("/account/settings/theme/", requireUser, async (c) => {
  const theme = String((await c.req.parseBody()).theme ?? "");
  if (THEMES.some(([t]) => t === theme)) await c.env.DB.prepare("UPDATE users SET theme = ? WHERE id = ?").bind(theme, c.get("user")!.id).run();
  return back(c, "theme");
});

settings.post("/account/settings/avatar/", requireUser, async (c) => {
  const user = c.get("user")!;
  const file = (await c.req.parseBody()).avatar;
  if (!(file instanceof File) || !file.size || file.size > MAX_AVATAR_BYTES) return back(c, "avatar-bad");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = AVATAR_TYPES.find(([, , magic]) => magic(bytes));
  if (!kind) return back(c, "avatar-bad");
  // A new name each time, so browsers and caches never show the old picture.
  const key = `${user.id}/${crypto.randomUUID()}.${kind[0]}`;
  await c.env.FILES.put(`avatars/${key}`, bytes, { httpMetadata: { contentType: kind[1] } });
  await c.env.DB.prepare("UPDATE users SET avatar_key = ? WHERE id = ?").bind(key, user.id).run();
  if (user.avatar_key) await c.env.FILES.delete(`avatars/${user.avatar_key}`);
  return back(c, "avatar");
});

settings.post("/account/settings/avatar/remove/", requireUser, async (c) => {
  const user = c.get("user")!;
  await c.env.DB.prepare("UPDATE users SET avatar_key = NULL WHERE id = ?").bind(user.id).run();
  if (user.avatar_key) await c.env.FILES.delete(`avatars/${user.avatar_key}`);
  return back(c, "avatar-removed");
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

async function sendVerification(c: C, row: { id: number; email: string }) {
  const token = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO email_verifications (token_hash, email_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), row.id, new Date(Date.now() + VERIFY_HOURS * 3600_000).toISOString())
    .run();
  await sendEmail(c.env, {
    to: row.email,
    subject: "Confirm your email address for the EELS Data Base",
    text: `Someone signed in to the EELS Data Base as "${c.get("user")!.display_name}" and added this address.\n\nIf that was you, open this link while signed in (it works for ${VERIFY_HOURS} hours):\n${new URL(c.req.url).origin}/account/emails/verify/${token}/\n\nIf not, ignore this email.`,
  });
}

/** Rate-limited per user; the same answer whatever happens, so the form cannot tell which addresses have accounts. */
async function allowEmail(c: C) {
  const key = String(c.get("user")!.id);
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'email' AND key = ? AND at > datetime('now', '-1 day')")
    .bind(key).first<number>("n");
  if ((recent ?? 0) >= MAX_EMAILS_PER_DAY) return false;
  await c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('email', ?)").bind(key).run();
  return true;
}

settings.post("/account/settings/emails/", requireUser, async (c) => {
  const user = c.get("user")!;
  const email = text((await c.req.parseBody()).email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back(c, "email-bad");
  if (!(await allowEmail(c))) return back(c, "limit");
  const row = await c.env.DB.prepare(
    "INSERT INTO user_emails (user_id, email) VALUES (?, ?) ON CONFLICT (user_id, email) DO UPDATE SET email = excluded.email RETURNING id, email, verified",
  ).bind(user.id, email).first<{ id: number; email: string; verified: number }>();
  if (row && !row.verified) await sendVerification(c, row);
  return back(c, "sent");
});

const ownEmail = (c: C) =>
  c.env.DB.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE id = ? AND user_id = ?")
    .bind(Number(c.req.param("id")), c.get("user")!.id)
    .first<EmailRow>();

settings.post("/account/settings/emails/:id/send/", requireUser, async (c) => {
  const row = await ownEmail(c);
  if (!row) return c.notFound();
  if (!row.verified && (await allowEmail(c))) await sendVerification(c, row);
  return back(c, "sent");
});

settings.post("/account/settings/emails/:id/primary/", requireUser, async (c) => {
  const row = await ownEmail(c);
  if (!row?.verified) return c.notFound();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user_emails SET is_primary = 0 WHERE user_id = ?").bind(c.get("user")!.id),
    c.env.DB.prepare("UPDATE user_emails SET is_primary = 1 WHERE id = ?").bind(row.id),
  ]);
  return back(c, "primary");
});

settings.post("/account/settings/emails/:id/remove/", requireUser, async (c) => {
  const row = await ownEmail(c);
  if (!row) return c.notFound();
  if (row.is_primary) return back(c, "keep-primary");
  await c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?").bind(row.id).run();
  return back(c, "removed");
});

settings.get("/account/emails/verify/:token/", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const row = await db.prepare(
    `SELECT e.id FROM email_verifications v JOIN user_emails e ON e.id = v.email_id
     WHERE v.token_hash = ? AND e.user_id = ? AND v.expires_at > ?`,
  ).bind(await sha256(c.req.param("token")), user.id, new Date().toISOString()).first<number>("id");
  if (row === null) return back(c, "verify-failed");
  try {
    await db.batch([
      db.prepare("UPDATE user_emails SET verified = 1 WHERE id = ?").bind(row),
      db.prepare("DELETE FROM email_verifications WHERE email_id = ?").bind(row),
    ]);
  } catch {
    // The unique index on confirmed addresses: another account confirmed it first.
    return back(c, "verify-failed");
  }
  // A confirmed address takes over from an unconfirmed primary.
  await db.prepare(
    `UPDATE user_emails SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END
     WHERE user_id = ?2 AND NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = ?2 AND is_primary = 1 AND verified = 1)`,
  ).bind(row, user.id).run();
  await syncEmails(db, user.id);
  return back(c, "verified");
});
