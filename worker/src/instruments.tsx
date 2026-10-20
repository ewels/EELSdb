import { Hono, type Context } from "hono";
import { requireUser, type AppEnv, type User } from "./auth";
import { Layout } from "./pages/layout";

export const instruments = new Hono<AppEnv>();
type C = Context<AppEnv>;

const ROWS = 8;
const SETTING_KEYS = [
  ["kv", "kV"],
  ["mode", "Mode"],
  ["aperture", "Aperture"],
  ["camera_length", "Camera length"],
] as const;

export const isModerator = (u: User | null) => !!u && (u.role === "moderator" || u.role === "admin");

type Version = {
  instrument_id: number;
  version: number;
  name: string;
  facility: string | null;
  manufacturer: string | null;
  spectrometer: string | null;
  voltages_kv_json: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  created_by: number | null;
  author: string | null;
};
type Calibration = { kind: string; settings_json: string | null; value_mrad: number | null; uncertainty_mrad: number | null };

function parseProfile(body: Record<string, unknown>) {
  const s = (k: string, max = 300) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");
  const errors: Record<string, string> = {};
  const name = s("name", 200);
  if (!name) errors.name = "Enter the microscope name.";
  const voltages = s("voltages")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (voltages.some((v) => !Number.isFinite(v) || v <= 0 || v > 3000)) errors.voltages = "Voltages are numbers in kV, separated by commas.";
  const calibrations: { kind: string; settings: Record<string, string>; value: number; uncertainty: number | null }[] = [];
  for (let i = 0; i < ROWS; i++) {
    const value = s(`cal_value_${i}`);
    if (!value) continue;
    const v = Number(value);
    const u = s(`cal_uncertainty_${i}`) ? Number(s(`cal_uncertainty_${i}`)) : null;
    const kind = s(`cal_kind_${i}`);
    if (!["convergence", "collection"].includes(kind) || !Number.isFinite(v) || v < 0 || (u !== null && !Number.isFinite(u))) {
      errors.calibrations = `Row ${i + 1}: choose convergence or collection, and give the angle (and uncertainty) as numbers in mrad.`;
      continue;
    }
    const settings = Object.fromEntries(SETTING_KEYS.map(([k]) => [k, s(`cal_${k}_${i}`, 50)]).filter(([, x]) => x));
    calibrations.push({ kind, settings, value: v, uncertainty: u });
  }
  return {
    errors,
    profile: {
      name,
      facility: s("facility") || null,
      manufacturer: s("manufacturer") || null,
      spectrometer: s("spectrometer") || null,
      voltages_kv_json: voltages.length ? JSON.stringify(voltages) : null,
      notes: s("notes", 2000) || null,
    },
    calibrations,
  };
}

function ProfileForm(props: { values: Partial<Version>; calibrations: Calibration[]; errors: Record<string, string>; action: string; submit: string }) {
  const v = props.values;
  const voltages = v.voltages_kv_json ? (JSON.parse(v.voltages_kv_json) as number[]).join(", ") : "";
  const rows = Array.from({ length: ROWS }, (_, i) => props.calibrations[i]);
  const field = (name: string, label: string, value: string | null | undefined, hint?: string) => (
    <div class={`field${props.errors[name] ? " has-error" : ""}`}>
      <label for={`f-${name}`}>{label}</label>
      <input id={`f-${name}`} name={name} type="text" value={value ?? ""} />
      {hint && <p class="hint">{hint}</p>}
      {props.errors[name] && <p class="error">{props.errors[name]}</p>}
    </div>
  );
  return (
    <form method="post" action={props.action} class="submit-form">
      <div class="grid-2">
        {field("name", "Microscope", v.name, "For example: Titan Themis 60-300 (Nantes)")}
        {field("facility", "Facility", v.facility)}
        {field("manufacturer", "Manufacturer", v.manufacturer)}
        {field("spectrometer", "Spectrometer", v.spectrometer, "For example: Gatan GIF Quantum ER 965")}
        {field("voltages", "Accelerating voltages (kV)", voltages, "Comma-separated, for example 80, 200, 300")}
      </div>
      <h2>Calibrated angles</h2>
      <p class="hint">One row per setting. Convergence angles usually depend on kV, mode and probe aperture; collection angles on camera length and entrance aperture.</p>
      {props.errors.calibrations && <p class="error">{props.errors.calibrations}</p>}
      <div class="table-scroll">
        <table class="cal-table">
          <thead>
            <tr><th>Angle</th>{SETTING_KEYS.map(([, l]) => <th>{l}</th>)}<th>Semi-angle (mrad)</th><th>± (mrad)</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const settings = r?.settings_json ? JSON.parse(r.settings_json) : {};
              return (
                <tr>
                  <td>
                    <select name={`cal_kind_${i}`} aria-label={`Row ${i + 1} angle`}>
                      <option value="convergence" selected={r?.kind !== "collection"}>Convergence</option>
                      <option value="collection" selected={r?.kind === "collection"}>Collection</option>
                    </select>
                  </td>
                  {SETTING_KEYS.map(([k, l]) => (
                    <td><input type="text" name={`cal_${k}_${i}`} value={settings[k] ?? ""} aria-label={`Row ${i + 1} ${l}`} /></td>
                  ))}
                  <td><input type="number" step="any" min="0" name={`cal_value_${i}`} value={r?.value_mrad ?? ""} aria-label={`Row ${i + 1} semi-angle`} /></td>
                  <td><input type="number" step="any" min="0" name={`cal_uncertainty_${i}`} value={r?.uncertainty_mrad ?? ""} aria-label={`Row ${i + 1} uncertainty`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="field">
        <label for="f-notes">Notes</label>
        <textarea id="f-notes" name="notes" rows={3}>{v.notes ?? ""}</textarea>
      </div>
      <p><button class="button" type="submit">{props.submit}</button></p>
      <p class="hint">A moderator approves each new version before it can be picked on the submit form.</p>
    </form>
  );
}

async function saveVersion(c: C, instrumentId: number, parsed: ReturnType<typeof parseProfile>) {
  const db = c.env.DB;
  const version = ((await db.prepare("SELECT MAX(version) AS v FROM instrument_versions WHERE instrument_id = ?").bind(instrumentId).first<number>("v")) ?? 0) + 1;
  const p = parsed.profile;
  await db.batch([
    db.prepare(
      `INSERT INTO instrument_versions (instrument_id, version, name, facility, manufacturer, spectrometer, voltages_kv_json, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(instrumentId, version, p.name, p.facility, p.manufacturer, p.spectrometer, p.voltages_kv_json, p.notes, c.get("user")!.id),
    ...parsed.calibrations.map((k) =>
      db.prepare("INSERT INTO instrument_calibrations (instrument_id, version, kind, settings_json, value_mrad, uncertainty_mrad) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(instrumentId, version, k.kind, JSON.stringify(k.settings), k.value, k.uncertainty),
    ),
  ]);
  return version;
}

instruments.get("/instruments/", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.status, v.name, v.facility, v.spectrometer,
            (SELECT COUNT(*) FROM instrument_versions p WHERE p.instrument_id = i.id AND p.status = 'pending') AS pending
     FROM instruments i
     JOIN instrument_versions v ON v.instrument_id = i.id
       AND v.version = COALESCE(i.current_version, (SELECT MAX(version) FROM instrument_versions WHERE instrument_id = i.id))
     WHERE i.status = 'approved' OR i.created_by = ? OR ?
     ORDER BY v.facility, v.name`,
  ).bind(user?.id ?? -1, isModerator(user) ? 1 : 0).all<any>();
  return c.html(
    <Layout title="Instrument profiles" path="/instruments/" user={user}>
      <h1>Instrument profiles</h1>
      <p class="lede">
        Calibrated convergence and collection angles for microscopes, kept by facility staff. Submitters pick a profile instead of guessing
        the angles; each spectrum records the profile version it used.
      </p>
      <p><a class="button" href="/instruments/new/">Add an instrument</a></p>
      {results.length ? (
        <div class="table-scroll">
          <table>
            <thead><tr><th>Microscope</th><th>Facility</th><th>Spectrometer</th><th>Status</th></tr></thead>
            <tbody>
              {results.map((i) => (
                <tr>
                  <td><a href={`/instruments/${i.id}/`}>{i.name}</a></td>
                  <td>{i.facility}</td>
                  <td>{i.spectrometer}</td>
                  <td>{i.status === "approved" ? (i.pending ? "Approved, edit waiting" : "Approved") : "Waiting for a moderator"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">No instrument profiles yet.</p>
      )}
    </Layout>,
  );
});

instruments.get("/instruments/new/", requireUser, (c) =>
  c.html(
    <Layout title="Add an instrument" path="/instruments/" user={c.get("user")}>
      <h1>Add an instrument</h1>
      <ProfileForm values={{}} calibrations={[]} errors={{}} action="/instruments/new/" submit="Send for approval" />
    </Layout>,
  ),
);

instruments.post("/instruments/new/", requireUser, async (c) => {
  const parsed = parseProfile(await c.req.parseBody());
  if (Object.keys(parsed.errors).length) {
    return c.html(
      <Layout title="Add an instrument" path="/instruments/" user={c.get("user")}>
        <h1>Add an instrument</h1>
        <ProfileForm values={parsed.profile} calibrations={[]} errors={parsed.errors} action="/instruments/new/" submit="Send for approval" />
      </Layout>,
      422,
    );
  }
  const p = parsed.profile;
  const id = (await c.env.DB.prepare(
    "INSERT INTO instruments (facility, name, manufacturer, spectrometer, voltages_kv_json, created_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))",
  ).bind(p.facility, p.name, p.manufacturer, p.spectrometer, p.voltages_kv_json, c.get("user")!.id).run()).meta.last_row_id;
  await saveVersion(c, id, parsed);
  return c.redirect(`/instruments/${id}/`);
});

async function loadInstrument(c: C) {
  const id = Number(c.req.param("id"));
  const instrument = await c.env.DB.prepare("SELECT * FROM instruments WHERE id = ?").bind(id).first<any>();
  if (!instrument) return null;
  const user = c.get("user");
  if (instrument.status !== "approved" && instrument.created_by !== user?.id && !isModerator(user)) return null;
  const { results: versions } = await c.env.DB.prepare(
    `SELECT v.*, u.display_name AS author FROM instrument_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.instrument_id = ? ORDER BY v.version DESC`,
  ).bind(id).all<Version>();
  return { instrument, versions };
}

instruments.get("/instruments/:id/", async (c) => {
  const loaded = await loadInstrument(c);
  if (!loaded) return c.notFound();
  const { instrument, versions } = loaded;
  const user = c.get("user");
  const want = Number(c.req.query("version")) || instrument.current_version || versions[0].version;
  const shown = versions.find((v) => v.version === want) ?? versions[0];
  const { results: cals } = await c.env.DB.prepare(
    "SELECT kind, settings_json, value_mrad, uncertainty_mrad FROM instrument_calibrations WHERE instrument_id = ? AND version = ? ORDER BY kind DESC, value_mrad",
  ).bind(instrument.id, shown.version).all<Calibration>();
  const STATUS: Record<string, string> = { approved: "approved", pending: "waiting for a moderator", rejected: "not approved" };
  return c.html(
    <Layout title={shown.name} path="/instruments/" user={user}>
      <p class="small" style="margin-top:1.25rem"><a href="/instruments/">← Instrument profiles</a></p>
      <h1>{shown.name}</h1>
      <p class="muted">
        {[shown.facility, shown.manufacturer, shown.spectrometer].filter(Boolean).join(" · ")}
        {shown.voltages_kv_json && ` · ${(JSON.parse(shown.voltages_kv_json) as number[]).join(", ")} kV`}
      </p>
      <p>
        Version {shown.version}, {STATUS[shown.status]}
        {shown.version !== instrument.current_version && instrument.current_version && (
          <> · <a href={`/instruments/${instrument.id}/`}>show the current version</a></>
        )}
        {user && <> · <a href={`/instruments/${instrument.id}/edit/`}>Suggest a change</a></>}
      </p>
      {isModerator(user) && shown.status === "pending" && (
        <div class="notice moderation">
          <p><strong>Moderator:</strong> this version needs a decision.</p>
          <form method="post" action={`/instruments/${instrument.id}/versions/${shown.version}/approve/`} style="display:inline">
            <button class="button" type="submit">Approve</button>
          </form>{" "}
          <form method="post" action={`/instruments/${instrument.id}/versions/${shown.version}/reject/`} style="display:inline">
            <button class="button secondary" type="submit">Reject</button>
          </form>
        </div>
      )}
      <h2>Calibrated angles</h2>
      {cals.length ? (
        <div class="table-scroll">
          <table>
            <thead><tr><th>Angle</th>{SETTING_KEYS.map(([, l]) => <th>{l}</th>)}<th class="num">Semi-angle</th></tr></thead>
            <tbody>
              {cals.map((k) => {
                const s = k.settings_json ? JSON.parse(k.settings_json) : {};
                return (
                  <tr>
                    <td>{k.kind === "convergence" ? "Convergence" : "Collection"}</td>
                    {SETTING_KEYS.map(([key]) => <td>{s[key] ?? ""}</td>)}
                    <td class="num">{k.value_mrad} mrad{k.uncertainty_mrad ? ` ± ${k.uncertainty_mrad}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">No calibrations recorded.</p>
      )}
      {shown.notes && <p class="prose">{shown.notes}</p>}
      <h2>Versions</h2>
      <ul>
        {versions.map((v) => (
          <li>
            <a href={`/instruments/${instrument.id}/?version=${v.version}`}>Version {v.version}</a>: {STATUS[v.status]}, {String(v.created_at).slice(0, 10)}
            {v.author && ` by ${v.author}`}
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

instruments.get("/instruments/:id/edit/", requireUser, async (c) => {
  const loaded = await loadInstrument(c);
  if (!loaded) return c.notFound();
  const latest = loaded.versions[0];
  const { results: cals } = await c.env.DB.prepare(
    "SELECT kind, settings_json, value_mrad, uncertainty_mrad FROM instrument_calibrations WHERE instrument_id = ? AND version = ?",
  ).bind(latest.instrument_id, latest.version).all<Calibration>();
  return c.html(
    <Layout title={`Edit ${latest.name}`} path="/instruments/" user={c.get("user")}>
      <h1>Edit {latest.name}</h1>
      <ProfileForm values={latest} calibrations={cals} errors={{}} action={`/instruments/${latest.instrument_id}/edit/`} submit="Send the new version for approval" />
    </Layout>,
  );
});

instruments.post("/instruments/:id/edit/", requireUser, async (c) => {
  const loaded = await loadInstrument(c);
  if (!loaded) return c.notFound();
  const parsed = parseProfile(await c.req.parseBody());
  if (Object.keys(parsed.errors).length) {
    return c.html(
      <Layout title="Edit instrument" path="/instruments/" user={c.get("user")}>
        <h1>Edit {loaded.versions[0].name}</h1>
        <ProfileForm values={parsed.profile} calibrations={[]} errors={parsed.errors} action={`/instruments/${loaded.instrument.id}/edit/`} submit="Send the new version for approval" />
      </Layout>,
      422,
    );
  }
  const version = await saveVersion(c, loaded.instrument.id, parsed);
  return c.redirect(`/instruments/${loaded.instrument.id}/?version=${version}`);
});

instruments.post("/instruments/:id/versions/:version/:decision{approve|reject}/", requireUser, async (c) => {
  const user = c.get("user")!;
  if (!isModerator(user)) return c.text("Only moderators can approve instrument profiles.", 403);
  const id = Number(c.req.param("id"));
  const version = Number(c.req.param("version"));
  const approve = c.req.param("decision") === "approve";
  const v = await c.env.DB.prepare("SELECT * FROM instrument_versions WHERE instrument_id = ? AND version = ? AND status = 'pending'").bind(id, version).first<Version>();
  if (!v) return c.notFound();
  const db = c.env.DB;
  const statements = [
    db.prepare("UPDATE instrument_versions SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE instrument_id = ? AND version = ?")
      .bind(approve ? "approved" : "rejected", user.id, id, version),
  ];
  if (approve) {
    statements.push(
      db.prepare(
        // An older version approved late does not replace a newer current one.
        `UPDATE instruments SET status = 'approved', current_version = ?, name = ?, facility = ?, manufacturer = ?, spectrometer = ?, voltages_kv_json = ?
         WHERE id = ? AND (current_version IS NULL OR current_version < ?)`,
      ).bind(version, v.name, v.facility, v.manufacturer, v.spectrometer, v.voltages_kv_json, id, version),
    );
  }
  await db.batch(statements);
  return c.redirect(`/instruments/${id}/?version=${version}`);
});
