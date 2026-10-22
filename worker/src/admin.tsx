import { Hono } from "hono";
import { raw } from "hono/html";
import { requireUser, type AppEnv } from "./auth";
import { EXPORT_KEY, fileHeaders } from "./files";
import { isModerator } from "./instruments";
import { DECISIONS, PROCESSED_ROLES, QUEUE_SQL, decide, reviewInput, storeProcessed, submissionDetail, type Decision, type ProcessingRecord } from "./moderation";
import { Layout, TypeBadge } from "./pages/layout";
import { MAX_FILE_BYTES } from "./submit/form";

export const admin = new Hono<AppEnv>();

const DECISION_LABELS: Record<Decision, string> = { approve: "Approve", request_changes: "Request changes", reject: "Reject" };

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
      {user.role === "admin" && (
        <>
          <h2>Bulk download</h2>
          <form method="post" action="/admin/exports/" enctype="multipart/form-data" class="inline-form">
            <input type="file" name="file" accept=".zip" aria-label="Archive made by python/export.py" required />
            <button class="button secondary" type="submit">Upload</button>
          </form>
          <p class="hint">The zip made by <code>uv run python/export.py</code>. It replaces the one on the <a href="/downloads/">bulk download</a> page.</p>
        </>
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
  const input = open ? await reviewInput(c.env.DB, d) : null;
  return c.html(
    <Layout title={`Review: ${d.title}`} path="/admin/" user={c.get("user")} head={input?.file && <link rel="stylesheet" href="/vendor/uPlot.min.css" />}>
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
          {input && (
            <section id="review" data-id={d.id} data-file={input.file ? `/admin/submissions/${d.id}/files/${input.file.role}/` : ""}>
              <h2>Checks at review</h2>
              <p class="checks-status muted" aria-live="polite">
                {input.file ? "This page reads the file in your browser when JavaScript is on." : "No file to check."}
              </p>
              <div class="review-plot"></div>
              <ul class="findings" hidden></ul>
              <div class="table-scroll" hidden>
                <table class="review-compare">
                  <thead><tr><th></th><th>Submitted</th><th>In the file</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
              {/* Escaped so a title with "</script>" cannot end the element. */}
              <script type="application/json" id="review-input">{raw(JSON.stringify(input).replace(/</g, "\\u003c"))}</script>
            </section>
          )}
          <h2>Checks at submission</h2>
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
            <form method="post" action={`/admin/submissions/${d.id}/`} class="field" id="decision">
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
      {input?.file && (
        <>
          <script src="/vendor/uPlot.iife.min.js" defer></script>
          <script src="/review.js" type="module"></script>
        </>
      )}
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

/** The files the moderator's browser made at review (see public/review.js), with the processing record. */
admin.post("/admin/submissions/:id/processed/", async (c) => {
  const d = await submissionDetail(c.env.DB, Number(c.req.param("id")));
  if (!d) return c.json({ message: "No such submission." }, 404);
  if (!["pending", "changes_requested"].includes(d.status)) return c.json({ message: "This submission was already decided." }, 409);
  const body = await c.req.parseBody();
  let record: ProcessingRecord | null = null;
  try {
    record = JSON.parse(String(body.record));
  } catch {}
  if (!record || !Array.isArray(record.tools)) return c.json({ message: "Expected a record: {tools: [{tool, version}], warnings, values}." }, 400);
  const files = PROCESSED_ROLES.flatMap((role) => (body[role] instanceof File && body[role].size ? [[role, body[role]] as [string, File]] : []));
  if (files.some(([, f]) => f.size > MAX_FILE_BYTES)) return c.json({ message: "A processed file is too large." }, 400);
  await storeProcessed(c.env, d, files, record);
  return c.json({ ok: true });
});

admin.post("/admin/exports/", async (c) => {
  if (c.get("user")!.role !== "admin") return c.text("Only admins can upload the bulk download.", 403);
  const file = (await c.req.parseBody()).file;
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
  if (!bytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return c.text("Please choose the zip file made by python/export.py.", 400);
  await c.env.FILES.put(EXPORT_KEY, bytes, {
    httpMetadata: { contentType: "application/zip", contentDisposition: 'attachment; filename="eelsdb-spectra.zip"' },
    customMetadata: { uploaded_by: String(c.get("user")!.id) },
  });
  return c.redirect("/downloads/");
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
