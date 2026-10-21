import { Hono, type Context } from "hono";
import { requireUser, sha256, type AppEnv } from "./auth";
import { fileHeaders } from "./files";
import { isModerator } from "./instruments";
import { DECISIONS, QUEUE_SQL, decide, submissionDetail, type Decision } from "./moderation";
import { Layout, TypeBadge } from "./pages/layout";

export const admin = new Hono<AppEnv>();
type C = Context<AppEnv>;

const DECISION_LABELS: Record<Decision, string> = { approve: "Approve", request_changes: "Request changes", reject: "Reject" };

// ---- API tokens (any signed-in user) -------------------------------------------------------

admin.get("/account/tokens/", requireUser, async (c) => tokensPage(c, null));

async function tokensPage(c: C, created: string | null) {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare("SELECT id, label, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC")
    .bind(user.id).all<any>();
  return c.html(
    <Layout title="API tokens" path="/account/" user={user}>
      <h1>API tokens</h1>
      <p class="prose">
        Tokens let the <code>eelsdb</code> command-line tool act as you: submit spectra and, for moderators, review them. Treat a token like a
        password. Run <code>eelsdb login</code> and paste it when asked.
      </p>
      {created && (
        <div class="notice" role="status">
          <p><strong>Your new token.</strong> Copy it now: it is not shown again.</p>
          <pre id="new-token">{created}</pre>
        </div>
      )}
      <form method="post" action="/account/tokens/" class="inline-form" style="max-width:32rem">
        <input type="text" name="label" placeholder="What is it for? e.g. laptop" aria-label="Token label" maxlength={80} />
        <button class="button" type="submit">Create a token</button>
      </form>
      {results.length > 0 && (
        <div class="table-scroll" style="margin-top:1.5rem">
          <table>
            <thead><tr><th>Label</th><th>Created</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {results.map((t) => (
                <tr>
                  <td>{t.label || <span class="muted">No label</span>}</td>
                  <td>{String(t.created_at).slice(0, 10)}</td>
                  <td>{t.last_used_at ? String(t.last_used_at).slice(0, 10) : "Never"}</td>
                  <td>
                    <form method="post" action={`/account/tokens/${t.id}/revoke/`}>
                      <button class="button secondary" type="submit">Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>,
  );
}

admin.post("/account/tokens/", requireUser, async (c) => {
  const user = c.get("user")!;
  const label = String((await c.req.parseBody()).label ?? "").trim().slice(0, 80) || null;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = "eelsdb_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await c.env.DB.prepare("INSERT INTO api_tokens (user_id, hash, label) VALUES (?, ?, ?)").bind(user.id, await sha256(token), label).run();
  return tokensPage(c, token);
});

admin.post("/account/tokens/:id/revoke/", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").bind(Number(c.req.param("id")), c.get("user")!.id).run();
  return c.redirect("/account/tokens/");
});

// ---- Moderation (moderators and admins) ----------------------------------------------------

admin.use("/admin/*", requireUser, async (c, next) => {
  if (!isModerator(c.get("user"))) return c.text("Only moderators can see this page.", 403);
  await next();
});

admin.get("/admin/", async (c) => {
  const db = c.env.DB;
  const [{ results: queue }, { results: profiles }, { results: recent }] = await db.batch<any>([
    db.prepare(`${QUEUE_SQL} WHERE b.status = 'pending' ORDER BY b.created_at, b.id`),
    db.prepare(
      `SELECT v.instrument_id, v.version, v.name, v.created_at FROM instrument_versions v WHERE v.status = 'pending' ORDER BY v.created_at`,
    ),
    db.prepare(`${QUEUE_SQL} WHERE b.status != 'pending' ORDER BY b.decided_at DESC LIMIT 10`),
  ]);
  const user = c.get("user")!;
  return c.html(
    <Layout title="Moderation" path="/admin/" user={user}>
      <h1>Moderation</h1>
      <p class="muted">Decide here, or with <code>eelsdb review</code> to reprocess files with pinned RosettaSciIO and exSpy versions.</p>
      {user.role === "admin" && <p><a href="/admin/users/">Users and roles</a></p>}
      <h2>Submissions waiting ({queue.length})</h2>
      {queue.length ? (
        <div class="table-scroll">
          <table>
            <thead><tr><th>Spectrum</th><th>Kind</th><th>Type</th><th>Submitter</th><th class="num">Sent</th></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr>
                  <td><a href={`/admin/submissions/${q.id}/`}>{q.title}</a></td>
                  <td>{q.kind === "edit" ? "Edit" : "New"}</td>
                  <td><TypeBadge type={q.type} /></td>
                  <td>{q.submitter}</td>
                  <td class="num">{String(q.created_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">Nothing to review.</p>
      )}
      <h2>Instrument profile versions waiting ({profiles.length})</h2>
      {profiles.length ? (
        <ul>
          {profiles.map((p) => (
            <li><a href={`/instruments/${p.instrument_id}/?version=${p.version}`}>{p.name}, version {p.version}</a></li>
          ))}
        </ul>
      ) : (
        <p class="muted">Nothing to review.</p>
      )}
      {recent.length > 0 && (
        <>
          <h2>Recent decisions</h2>
          <ul>
            {recent.map((q) => (
              <li><a href={`/admin/submissions/${q.id}/`}>{q.title}</a>: {q.status.replace("_", " ")}</li>
            ))}
          </ul>
        </>
      )}
    </Layout>,
  );
});

admin.get("/admin/submissions/:id/", async (c) => {
  const d = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!d) return c.notFound();
  const findings: any[] = Array.isArray(d.browser_checks?.findings) ? d.browser_checks.findings : [];
  const n = (x: unknown) => (typeof x === "number" ? x.toFixed(2) : "?");
  const open = ["pending", "changes_requested"].includes(d.status);
  return c.html(
    <Layout title={`Review: ${d.title}`} path="/admin/" user={c.get("user")}>
      <p class="small back-link"><a href="/admin/">← Moderation</a></p>
      <h1>{d.title}</h1>
      <p class="muted">
        {d.kind === "edit" ? "Edit of a published spectrum" : "New spectrum"} from {d.submitter}, {String(d.created_at).slice(0, 10)} · status:{" "}
        {d.status.replace("_", " ")} · <a href={`/spectra/${encodeURIComponent(d.slug)}/`}>{d.kind === "edit" ? "Published page" : "Preview the page"}</a>
      </p>
      <div class="spectrum-cols">
        <section>
          <h2>Files</h2>
          <ul>
            {d.files.map((f: any) => (
              <li>
                <a href={`/admin/submissions/${d.id}/files/${f.role}/`}>{f.filename}</a> ({f.role}, {f.bytes ? `${Math.round(f.bytes / 1024)} kB` : "size unknown"})
              </li>
            ))}
            {d.change?.file && <li>New file in this edit: {d.change.file.name}</li>}
          </ul>
          <h2>Browser checks</h2>
          {d.browser_checks === null ? (
            <p class="muted">None: the submitter's browser did not run them.</p>
          ) : d.browser_checks.error ? (
            <p class="muted">The browser could not read the file: {String(d.browser_checks.error)}</p>
          ) : (
            <>
              <p>
                {String(d.browser_checks.points ?? "?")} points, {n(d.browser_checks.energy_min)} to {n(d.browser_checks.energy_max)} eV.
              </p>
              <ul class="findings">
                {findings.length ? findings.map((f) => <li class={f.severity}>{f.message}</li>) : <li class="info">No problems found.</li>}
              </ul>
            </>
          )}
        </section>
        <section>
          {d.kind === "edit" && d.change && (
            <>
              <h2>Proposed values</h2>
              <pre>{JSON.stringify({ ...d.change.form.spectrum, elements: d.change.form.elements, edges: d.change.form.edges, acquisition: d.change.form.acquisition }, null, 1)}</pre>
            </>
          )}
          <h2>Decision</h2>
          {open ? (
            <form method="post" action={`/admin/submissions/${d.id}/`} class="field">
              <label for="notes">Notes for the submitter (needed to request changes or reject)</label>
              <textarea id="notes" name="notes" rows={4}>{d.moderator_notes ?? ""}</textarea>
              <div class="filter-actions">
                {DECISIONS.map((x) => (
                  <button class={x === "approve" ? "button" : "button secondary"} type="submit" name="decision" value={x}>{DECISION_LABELS[x]}</button>
                ))}
              </div>
            </form>
          ) : (
            <p>Decided: {d.status.replace("_", " ")}. {d.moderator_notes}</p>
          )}
        </section>
      </div>
    </Layout>,
  );
});

admin.post("/admin/submissions/:id/", async (c) => {
  const body = await c.req.parseBody();
  const decision = String(body.decision) as Decision;
  const notes = String(body.notes ?? "").trim() || null;
  const id = Number(c.req.param("id"));
  if (!DECISIONS.includes(decision)) return c.text("Unknown decision.", 400);
  if (decision !== "approve" && !notes) return c.text("Please add notes for the submitter when requesting changes or rejecting.", 400);
  const error = await decide(c.env, id, decision, notes, c.get("user")!);
  if (error) return c.text(error, 409);
  return c.redirect("/admin/");
});

admin.get("/admin/submissions/:id/files/:role/", async (c) => {
  const d = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  const file = d?.files.find((f: any) => f.role === c.req.param("role"));
  const object = file && (await c.env.FILES.get(file.r2_key));
  if (!object) return c.notFound();
  return new Response(object.body, { headers: fileHeaders(file.filename) });
});

admin.get("/admin/users/", async (c) => {
  if (c.get("user")!.role !== "admin") return c.text("Only admins can change roles.", 403);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.role, u.slug, (SELECT COUNT(*) FROM spectra s WHERE s.owner_id = u.id AND s.status = 'published') AS spectra
     FROM users u WHERE u.role != 'user' OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id) ORDER BY u.role != 'admin', u.role != 'moderator', u.display_name`,
  ).all<any>();
  return c.html(
    <Layout title="Users and roles" path="/admin/" user={c.get("user")}>
      <h1>Users and roles</h1>
      <p class="muted">Signed-in users, moderators and admins.</p>
      <div class="table-scroll admin-users">
        <table>
          <thead><tr><th>Name</th><th class="num">Spectra</th><th>Role</th></tr></thead>
          <tbody>
            {results.map((u) => (
              <tr>
                <td>{u.slug ? <a href={`/author/${u.slug}/`}>{u.display_name}</a> : u.display_name}</td>
                <td class="num">{u.spectra}</td>
                <td>
                  <form method="post" action={`/admin/users/${u.id}/`} class="inline-form role-form">
                    <select name="role" aria-label={`Role for ${u.display_name}`}>
                      {["user", "moderator", "admin"].map((r) => <option value={r} selected={u.role === r}>{r}</option>)}
                    </select>
                    <button class="button secondary" type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>,
  );
});

admin.post("/admin/users/:id/", async (c) => {
  const me = c.get("user")!;
  if (me.role !== "admin") return c.text("Only admins can change roles.", 403);
  const role = String((await c.req.parseBody()).role);
  const id = Number(c.req.param("id"));
  if (!["user", "moderator", "admin"].includes(role)) return c.text("Unknown role.", 400);
  if (id === me.id && role !== "admin") return c.text("You cannot remove your own admin role.", 400);
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return c.redirect("/admin/users/");
});
