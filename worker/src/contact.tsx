import { Hono } from "hono";
import { type AppEnv, type User } from "./auth";
import { sendEmail } from "./email";
import { getSettings, twoStepRequired } from "./settings";
import { Layout } from "./pages/layout";
import { turnstileOk } from "./turnstile";

export const contact = new Hono<AppEnv>();

export const TOPICS: Record<string, string> = {
  spectrum: "A question about a spectrum",
  website: "A problem with the website",
  account: "My account",
  other: "Something else",
};
const MAX_PER_HOUR = 5;
const MAX_NAME = 100;
const MAX_MESSAGE = 5000;
const MIN_MESSAGE = 10;
const KEEP_DAYS = 365;

const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/** Only a path on this site, so the "page" line in the email cannot carry a link elsewhere. */
const safePath = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[^\s\\]*$/.test(v) && v.length <= 200 ? v : "");
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "");

/** Admins who hold the role (with two-step sign-in, unless the admins switch is off, see loadUser), each with their primary confirmed address. */
export async function recipients(env: Env) {
  const need = twoStepRequired(await getSettings(env.DB), "admin");
  const { results } = await env.DB.prepare(
    `SELECT (SELECT e.email FROM user_emails e WHERE e.user_id = u.id AND e.verified = 1 ORDER BY e.is_primary DESC, e.id LIMIT 1) AS email
     FROM users u
     WHERE u.role = 'admin'
       AND (${need ? 0 : 1} OR EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) OR EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id))`,
  ).all<{ email: string | null }>();
  const found = [...new Set(results.map((r) => r.email).filter((e): e is string => !!e))];
  return found.length ? found : env.CONTACT_EMAIL ? [env.CONTACT_EMAIL] : [];
}

type Values = { name: string; email: string; topic: string; message: string; page: string };

async function prefill(c: { env: Env }, user: User | null): Promise<Partial<Values>> {
  if (!user) return {};
  const email = await c.env.DB.prepare("SELECT email FROM user_emails WHERE user_id = ? AND verified = 1 ORDER BY is_primary DESC, id LIMIT 1").bind(user.id).first<string>("email");
  return { name: user.display_name, email: email ?? "" };
}

function ContactPage(props: { user: User | null; v: Partial<Values>; errors: Record<string, string>; siteKey?: string; status?: number }) {
  const { v, errors } = props;
  const Err = (p: { name: string }) => (errors[p.name] ? <p class="error" id={`e-${p.name}`}>{errors[p.name]}</p> : null);
  const cls = (n: string) => `field${errors[n] ? " has-error" : ""}`;
  return (
    <Layout
      title="Contact"
      path="/contact/"
      card="page/contact"
      user={props.user}
      head={props.siteKey && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>}
    >
      <div class="prose contact">
        <h1>Contact</h1>
        <p class="lede">Write to the people who run the EELS Data Base. A person reads every message.</p>
        <p class="hint">
          To report a bug in public or ask for a feature, <a href="https://github.com/ewels/EELSdb/issues">open an issue on GitHub</a> instead, so others can follow it.
        </p>
        {Object.keys(errors).length > 0 && <p class="notice error-summary" role="alert">{errors.form ?? "Please fix the fields marked below."}</p>}
        <form method="post" action="/contact/" novalidate>
          <input type="hidden" name="page" value={v.page ?? ""} />
          <div class={cls("name")}>
            <label for="f-name">Your name</label>
            <input type="text" id="f-name" name="name" value={v.name ?? ""} maxlength={MAX_NAME} required autocomplete="name" aria-invalid={errors.name ? "true" : undefined} />
            <Err name="name" />
          </div>
          <div class={cls("email")}>
            <label for="f-email">Your email address</label>
            <input type="text" inputmode="email" id="f-email" name="email" value={v.email ?? ""} maxlength={254} required autocomplete="email" aria-invalid={errors.email ? "true" : undefined} />
            <p class="hint">We reply to this address. We do not send you a copy of your message.</p>
            <Err name="email" />
          </div>
          <div class={cls("topic")}>
            <label for="f-topic">What is it about?</label>
            <select id="f-topic" name="topic" required>
              {Object.entries(TOPICS).map(([k, label]) => <option value={k} selected={(v.topic ?? "spectrum") === k}>{label}</option>)}
            </select>
            <Err name="topic" />
          </div>
          <div class={cls("message")}>
            <label for="f-message">Message</label>
            <textarea id="f-message" name="message" rows={8} maxlength={MAX_MESSAGE} required aria-invalid={errors.message ? "true" : undefined}>{v.message ?? ""}</textarea>
            <p class="hint">Plain text, up to {MAX_MESSAGE} characters.</p>
            <Err name="message" />
          </div>
          <div class="hp" aria-hidden="true">
            <label for="f-website">Leave this empty</label>
            <input type="text" id="f-website" name="website" tabindex={-1} autocomplete="off" />
          </div>
          {props.siteKey && <div class="cf-turnstile" data-sitekey={props.siteKey}></div>}
          <Err name="turnstile" />
          <p><button class="button" type="submit">Send message</button></p>
        </form>
      </div>
    </Layout>
  );
}

contact.get("/contact/", async (c) => {
  const user = c.get("user");
  let page = safePath(c.req.query("from"));
  if (!page) {
    const ref = c.req.header("Referer");
    try {
      const u = ref ? new URL(ref) : null;
      if (u && u.origin === new URL(c.req.url).origin && !u.pathname.startsWith("/contact/")) page = safePath(u.pathname);
    } catch {}
  }
  return c.html(<ContactPage user={user} v={{ ...(await prefill(c, user)), page }} errors={{}} siteKey={c.env.TURNSTILE_SITE_KEY} />);
});

contact.get("/contact/sent/", (c) =>
  c.html(
    <Layout title="Message sent" path="/contact/" user={c.get("user")}>
      <div class="prose">
        <h1>Message sent</h1>
        <p class="lede">Thank you. The administrators have your message.</p>
        <p>A person will reply from their own address, so look for the answer in your inbox (and in spam). We did not send you a copy.</p>
        <p><a href="/">Back to the home page</a></p>
      </div>
    </Layout>,
  ),
);

contact.post("/contact/", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const v: Values = {
    name: oneLine(body.name, MAX_NAME),
    email: oneLine(body.email, 254).toLowerCase(),
    topic: typeof body.topic === "string" ? body.topic : "",
    message: typeof body.message === "string" ? body.message.replace(/\r\n/g, "\n").trim() : "",
    page: safePath(body.page),
  };
  const show = (errors: Record<string, string>, status: 422 | 429) => c.html(<ContactPage user={user} v={v} errors={errors} siteKey={c.env.TURNSTILE_SITE_KEY} />, status);

  // A bot that fills the hidden field is told it worked; nothing is stored or sent.
  if (typeof body.website === "string" && body.website !== "") return c.redirect("/contact/sent/", 303);

  const errors: Record<string, string> = {};
  if (!v.name) errors.name = "Please enter your name.";
  if (!validEmail(v.email)) errors.email = "Please enter a valid email address, so we can reply.";
  if (!(v.topic in TOPICS)) errors.topic = "Please choose a topic.";
  if (v.message.length < MIN_MESSAGE) errors.message = "Please write a message.";
  else if (v.message.length > MAX_MESSAGE) errors.message = `Please keep the message under ${MAX_MESSAGE} characters.`;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await turnstileOk(c.env, ip, typeof body["cf-turnstile-response"] === "string" ? body["cf-turnstile-response"] : null))) {
    errors.turnstile = "The anti-spam check failed. Please try again.";
  }
  if (Object.keys(errors).length) return show(errors, 422);

  const count = (kind: string, key: string) =>
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = ? AND key = ? AND at > datetime('now', '-1 hour')").bind(kind, key).first<number>("n");
  if (((await count("contact_ip", ip)) ?? 0) >= MAX_PER_HOUR || ((await count("contact_email", v.email)) ?? 0) >= MAX_PER_HOUR) {
    return show({ form: "You have sent several messages in the last hour. Please try again later." }, 429);
  }
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO contact_messages (name, email, topic, message, user_id, page, status) VALUES (?, ?, ?, ?, ?, ?, 'unsent')",
  ).bind(v.name, v.email, v.topic, v.message, user?.id ?? null, v.page || null).run();
  const id = meta.last_row_id;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('contact_ip', ?)").bind(ip),
    c.env.DB.prepare("INSERT INTO rate_events (kind, key) VALUES ('contact_email', ?)").bind(v.email),
  ]);

  const origin = new URL(c.req.url).origin;
  const to = await recipients(c.env);
  const text = [
    `From: ${v.name} <${v.email}>`,
    `Signed in: ${user ? `yes, ${user.display_name}, ${origin}/admin/users/${user.id}/` : "no"}`,
    `Topic: ${TOPICS[v.topic]}`,
    `Page: ${v.page ? origin + v.page : "unknown"}`,
    `All messages: ${origin}/admin/messages/`,
    "",
    v.message,
  ].join("\n");
  let delivered = 0;
  for (const address of to) {
    try {
      await sendEmail(c.env, { to: address, subject: `[EELSdb contact] ${TOPICS[v.topic]}`, text, replyTo: v.email, footer: "You received this email because you are an administrator of the EELS Data Base. Reply to answer the sender." });
      delivered++;
    } catch (e) {
      console.error("contact email failed", e instanceof Error ? e.message : e);
    }
  }
  const status = !to.length ? "no_recipient" : delivered === to.length ? "sent" : delivered ? "partial" : "failed";
  await c.env.DB.prepare("UPDATE contact_messages SET status = ?, recipients = ?, delivered = ? WHERE id = ?").bind(status, to.length, delivered, id).run();
  return c.redirect("/contact/sent/", 303);
});

export const deleteOldMessages = (env: Env) =>
  env.DB.prepare(`DELETE FROM contact_messages WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`).run();

const STATUS_LABELS: Record<string, string> = {
  sent: "Emailed",
  partial: "Emailed to some",
  failed: "Email failed",
  no_recipient: "No one to email",
  unsent: "Not sent",
};

export async function MessagesPage(props: { c: { env: Env }; user: User }) {
  const { results } = await props.c.env.DB.prepare(
    "SELECT id, name, email, topic, message, user_id, page, status, recipients, delivered, created_at FROM contact_messages ORDER BY id DESC LIMIT 100",
  ).all<any>();
  return (
    <Layout title="Contact messages" path="/admin/" user={props.user}>
      <h1>Contact messages</h1>
      <p class="hint prose">
        Messages from the <a href="/contact/">contact form</a>, newest first, last 100. They are also emailed to every administrator with two-step sign-in, and deleted after a year.
        Reply to the sender's address.
      </p>
      {results.length ? (
        <ul class="messages">
          {results.map((m) => (
            <li>
              <p>
                <strong>{m.name}</strong> <a href={`mailto:${m.email}`}>{m.email}</a>
                {m.user_id && <> · <a href={`/admin/users/${m.user_id}/`}>account</a></>}
              </p>
              <p class="muted small">
                {String(m.created_at).slice(0, 16)} UTC · {TOPICS[m.topic] ?? m.topic} · {STATUS_LABELS[m.status] ?? m.status}
                {m.recipients > 0 && ` (${m.delivered} of ${m.recipients})`}
                {m.page && <> · from {m.page}</>}
              </p>
              <p class="message-text">{m.message}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No messages yet.</p>
      )}
    </Layout>
  );
}
