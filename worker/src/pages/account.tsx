import { Hono } from "hono";
import { PROVIDERS, createSession, finishSignIn, requireUser, safeNext, sha256, signOut, startSignIn, type AppEnv } from "../auth";
import { sendEmail } from "../email";
import { pbkdf2Hash, verifyLegacyPassword } from "../legacy-password";
import { Formula, Layout, TypeBadge } from "./layout";

export const account = new Hono<AppEnv>();

const ERRORS: Record<string, string> = {
  state: "The sign-in took too long or was started in another tab. Please try again.",
  provider: "The sign-in service did not confirm who you are. Please try again, or use another service.",
  password: "That username or email and password do not match an account from the old site.",
};
const CLAIM_HOURS = 24;

account.get("/login/", (c) => {
  if (c.get("user")) return c.redirect(safeNext(c.req.query("next")));
  const next = c.req.query("next");
  const providers = Object.entries(PROVIDERS).filter(([, p]) => p.configured(c.env));
  const error = ERRORS[c.req.query("error") ?? ""];
  return c.html(
    <Layout title="Sign in" path="/login/" user={null}>
      <div class="prose">
        <h1>Sign in</h1>
        {error && <p class="notice" role="alert">{error}</p>}
        <p>Sign in to save favourite spectra and, soon, to submit your own. EELSdb never sees your password.</p>
        {providers.length ? (
          <div class="sign-in-buttons">
            {providers.map(([key, p]) => (
              <a class="button secondary" href={`/auth/${key}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
                Continue with {p.label}
              </a>
            ))}
          </div>
        ) : (
          <p class="notice">Sign-in is not set up on this server yet (no OAuth client IDs in its settings).</p>
        )}
        {c.env.LEGACY_PASSWORD_LOGIN === "1" && (
          <form method="post" action="/login/password/" class="password-login">
            <h2>Sign in with your old EELSdb password</h2>
            {next && <input type="hidden" name="next" value={next} />}
            <label for="login">Username or email</label>
            <input id="login" name="login" type="text" autocomplete="username" required />
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required />
            <button class="button" type="submit">Sign in</button>
          </form>
        )}
        <h2>Had an account on the old site?</h2>
        <p>
          Sign in with Google or GitHub using the same email address, and your old account (favourites and spectra) is linked
          automatically. With ORCID, or a different address, you can claim your old account from your account page.
        </p>
      </div>
    </Layout>,
  );
});

account.post("/login/password/", async (c) => {
  if (c.env.LEGACY_PASSWORD_LOGIN !== "1") return c.notFound();
  const body = await c.req.parseBody();
  const login = String(body.login ?? "").trim();
  const password = String(body.password ?? "");
  const user = login
    ? await c.env.DB.prepare(
        `SELECT id, legacy_password_hash AS hash FROM users WHERE legacy_password_hash IS NOT NULL
         AND (legacy_login = ? OR legacy_email = ? COLLATE NOCASE) ORDER BY id LIMIT 1`,
      ).bind(login, login).first<{ id: number; hash: string }>()
    : null;
  if (!user || !(await verifyLegacyPassword(password, user.hash))) return c.redirect("/login/?error=password");
  if (!user.hash.startsWith("$pbkdf2-")) {
    await c.env.DB.prepare("UPDATE users SET legacy_password_hash = ? WHERE id = ?").bind(await pbkdf2Hash(password), user.id).run();
  }
  await createSession(c, user.id);
  return c.redirect(safeNext(typeof body.next === "string" ? body.next : undefined));
});

account.get("/wp-login.php", (c) => c.redirect("/login/", 301));
account.get("/auth/:provider/start", startSignIn);
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
    <Layout title="Your account" path="/account/" user={user}>
      <h1>{user.display_name}</h1>
      <p class="muted">
        Signed in with {identities.map((i: any) => PROVIDERS[i.provider]?.label ?? i.provider).join(", ") || "an old-site account"}
        {user.orcid && <> · ORCID <a href={`https://orcid.org/${user.orcid}`}>{user.orcid}</a></>}
        {owned[0].n > 0 && user.slug && <> · <a href={`/author/${user.slug}/`}>{owned[0].n} contributed spectra</a></>}
      </p>
      {notice === "sent" && (
        <p class="notice" role="status">If an old account uses that address, we have emailed it a link. The link works for {CLAIM_HOURS} hours.</p>
      )}
      {notice === "done" && <p class="notice" role="status">Your old account is now linked. Its favourites and spectra are below.</p>}

      <p>
        <a class="button" href="/submit-data/">Submit a spectrum</a> <a class="button secondary" href="/account/submissions/">Your submissions</a>{" "}
        <a class="button secondary" href="/account/tokens/">API tokens</a>
        {(user.role === "moderator" || user.role === "admin") && <> <a class="button secondary" href="/admin/">Moderation</a></>}
      </p>

      <h2>Favourite spectra</h2>
      {favourites.length ? (
        <div class="table-scroll">
          <table>
            <tbody>
              {favourites.map((s: any) => (
                <tr>
                  <td><TypeBadge type={s.type} /></td>
                  <td><a href={`/spectra/${encodeURIComponent(s.slug)}/`}>{s.title}</a></td>
                  <td><Formula formula={s.formula} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">No favourites yet. Use the star on a spectrum's page to keep it here.</p>
      )}

      <div class="prose">
        <h2>Claim your account from the old site</h2>
        <p>Enter the email address of your old EELSdb account. We will send a link to that address; open it while signed in here.</p>
        <form method="post" action="/account/claim/" class="inline-form">
          <input type="email" name="email" required aria-label="Email address of your old account" autocomplete="email" />
          <button class="button secondary" type="submit">Send link</button>
        </form>
        <h2>Sign out</h2>
        <form method="post" action="/logout/">
          <button class="button secondary" type="submit">Sign out</button>
        </form>
      </div>
    </Layout>,
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
    <Layout title="Link your old account" path="/account/" user={c.get("user")}>
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
    </Layout>,
    claim ? 200 : 404,
  );
});

/** Moves the current sign-ins and favourites onto the old account, then removes the new, empty one. */
account.post("/account/claim/:token/", requireUser, async (c) => {
  const claim = await findClaim(c);
  if (!claim) return c.redirect("/account/");
  const from = c.get("user")!.id;
  const to = claim.legacy_user_id;
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE identities SET user_id = ? WHERE user_id = ?").bind(to, from),
    db.prepare("INSERT OR IGNORE INTO favourites (user_id, spectrum_id, created_at) SELECT ?, spectrum_id, created_at FROM favourites WHERE user_id = ?").bind(to, from),
    db.prepare("UPDATE spectra SET owner_id = ? WHERE owner_id = ?").bind(to, from),
    db.prepare("UPDATE users SET orcid = COALESCE(orcid, (SELECT orcid FROM users WHERE id = ?)) WHERE id = ?").bind(from, to),
    db.prepare("DELETE FROM account_claims WHERE legacy_user_id = ? OR user_id = ?").bind(to, from),
    db.prepare("DELETE FROM users WHERE id = ?").bind(from),
  ]);
  await createSession(c, to);
  return c.redirect("/account/?claim=done");
});
