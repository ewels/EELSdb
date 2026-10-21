import { Hono, type Context } from "hono";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { requireUser, type AppEnv } from "../auth";
import { mediaType } from "../files";
import { Layout, TYPE_NAMES } from "../pages/layout";
import { BEAM_ENERGIES, COMPANION_EXTENSIONS, MAX_FILE_BYTES, SPECTRUM_EXTENSIONS, checkUpload, cleanBrowserChecks, parseForm } from "./form";
import { createSpectrum, instrumentOk } from "./store";

export const submit = new Hono<AppEnv>();
type C = Context<AppEnv>;
type Values = Record<string, string>;

const MAX_PER_DAY = 20;
const MAX_FILE_MB = MAX_FILE_BYTES / 1024 / 1024;
const UNIT_LABELS: Record<string, string> = {
  counts: "Counts",
  oscillator_strength: "Oscillator strength",
  mu: "Absorption coefficient (μ)",
  optical_density: "Optical density",
  normalised: "Normalised",
};
const XAS_LABELS: [string, string, string?][] = [
  ["facility", "Facility", "For example: SOLEIL, Canadian Light Source"],
  ["beamline", "Beamline"],
  ["source_type", "Source", "Bending magnet, undulator…"],
  ["monochromator", "Monochromator", "For example: Si(111), 1200 l/mm grating"],
  ["resolving_power", "Resolving power (E/ΔE)"],
  ["detection_mode", "Detection mode", "Transmission, total electron yield, fluorescence yield…"],
  ["polarisation", "Polarisation", "Linear, circular left, circular right…"],
  ["polarisation_angle_deg", "Polarisation angle (degrees)"],
  ["calibration_reference", "Energy calibration reference"],
  ["i0_normalisation", "I0 normalisation"],
];

async function turnstileOk(c: C, token: string | null) {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured (local development)
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: c.req.header("CF-Connecting-IP") ?? "" }),
  });
  return ((await res.json<{ success: boolean }>()).success) === true;
}

type Instrument = { id: number; version: number; name: string; facility: string | null; voltages_kv_json: string | null; calibrations: string };

export async function approvedInstruments(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT i.id, v.version, v.name, v.facility, v.voltages_kv_json,
              (SELECT json_group_array(json_object('kind', kind, 'settings', json(settings_json), 'value', value_mrad, 'uncertainty', uncertainty_mrad))
               FROM instrument_calibrations k WHERE k.instrument_id = i.id AND k.version = v.version) AS calibrations
       FROM instruments i JOIN instrument_versions v ON v.instrument_id = i.id AND v.version = i.current_version
       WHERE i.status = 'approved' ORDER BY v.facility, v.name`,
    )
    .all<Instrument>();
  return results;
}

function Field(props: { name: string; label: string; errors: Record<string, string>; hint?: string; children: Child }) {
  const error = props.errors[props.name];
  return (
    <div class={`field${error ? " has-error" : ""}`}>
      <label for={`f-${props.name}`}>{props.label}</label>
      {props.children}
      {props.hint && <p class="hint">{props.hint}</p>}
      {error && <p class="error" id={`e-${props.name}`}>{error}</p>}
    </div>
  );
}

const input = (name: string, v: Values, attrs: Record<string, unknown> = {}) => (
  <input id={`f-${name}`} name={name} type="text" value={v[name] ?? ""} {...attrs} />
);

function Measured(props: { name: string; label: string; unit: string; v: Values; errors: Record<string, string>; hint: string }) {
  const { name, v } = props;
  return (
    <fieldset class={`field measured${props.errors[name] || props.errors[`${name}_uncertainty`] ? " has-error" : ""}`} data-measured={name}>
      <legend>{props.label}</legend>
      <div class="measured-row">
        <input id={`f-${name}`} name={name} type="number" step="any" min="0" value={v[name] ?? ""} aria-label={`${props.label} (${props.unit})`} />
        <span class="unit">{props.unit}</span>
        <label class="check"><input type="checkbox" name={`${name}_approx`} value="1" checked={!!v[`${name}_approx`]} /> Approximate</label>
        <label class="check"><input type="checkbox" name={`${name}_unknown`} value="1" checked={!!v[`${name}_unknown`]} /> Unknown</label>
      </div>
      <div class="measured-uncertainty">
        <label for={`f-${name}_uncertainty`}>± uncertainty ({props.unit})</label>
        <input id={`f-${name}_uncertainty`} name={`${name}_uncertainty`} type="number" step="any" min="0" value={v[`${name}_uncertainty`] ?? ""} />
      </div>
      <input type="hidden" name={`${name}_source`} value={v[`${name}_source`] ?? "user"} />
      <p class="hint provenance" data-provenance={name}>{props.hint}</p>
      {props.errors[name] && <p class="error">{props.errors[name]}</p>}
      {props.errors[`${name}_uncertainty`] && <p class="error">{props.errors[`${name}_uncertainty`]}</p>}
    </fieldset>
  );
}

const STEPS: [id: string, title: string, hint: string][] = [
  ["files", "Files", "Upload and check"],
  ["specimen", "Specimen", "What you measured"],
  ["xas", "X-ray absorption", "Beamline and detection"],
  ["acquisition", "Acquisition", "Instrument and settings"],
  ["treatment", "Treatment", "Corrections and processing"],
  ["reference", "Reference", "Paper and links"],
  ["review", "Review", "Check and submit"],
];

function StepNav(props: { back?: boolean; next?: string }) {
  return (
    <div class="step-nav">
      {props.back && <button type="button" class="button secondary" data-back>Back</button>}
      {props.next && <button type="button" class="button" data-next>{props.next}</button>}
    </div>
  );
}

function Step(props: { id: string; hidden?: boolean; children: Child }) {
  const [, title] = STEPS.find(([id]) => id === props.id)!;
  return (
    <section class="form-section step" id={`step-${props.id}`} data-step={props.id} data-show-for={props.id === "xas" ? "xrayabs" : undefined} hidden={props.hidden}>
      <h2>{title}</h2>
      {props.children}
    </section>
  );
}

export function SubmitPage(props: { c: C; v: Values; errors: Record<string, string>; instruments: Instrument[]; edit?: { slug: string; title: string } }) {
  const { c, v, errors } = props;
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  const choice = v.beam_energy_choice ?? "";
  const count = Object.keys(errors).length;
  const accept = SPECTRUM_EXTENSIONS.map((e) => `.${e}`).join(",");
  return (
    <Layout
      title={props.edit ? `Edit ${props.edit.title}` : "Submit a spectrum"}
      path={props.edit ? "/spectra/" : "/submit-data/"}
      user={c.get("user")}
      head={
        <>
          {/* Before first paint, so the steps do not flash as one long page. */}
          <script>{raw('document.documentElement.classList.add("js")')}</script>
          <link rel="stylesheet" href="/vendor/uPlot.min.css" />
          {siteKey && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>}
        </>
      }
    >
      {props.edit && (
        <p class="small back-link"><a href={`/spectra/${encodeURIComponent(props.edit.slug)}/`}>← {props.edit.title}</a></p>
      )}
      <h1>{props.edit ? `Edit ${props.edit.title}` : "Submit a spectrum"}</h1>
      <p class="lede">
        {props.edit
          ? "Changes to the title, description, keywords, reference and links are published straight away. Changes to the data file, the specimen or how it was measured go to a moderator first."
          : "A moderator checks every submission before it is published."}
      </p>
      {count > 0 && (
        <div class="notice error-summary" role="alert" tabindex={-1} id="errors">
          <strong>{count === 1 ? "One field needs attention" : `${count} fields need attention`}.</strong> Files are not kept after an
          error, so please attach them again.
          {errors.rate && <p>{errors.rate}</p>}
        </div>
      )}
      <div class="wizard">
        <nav class="steps" aria-label="Steps">
          <ol>
            {STEPS.map(([id, title, hint]) => (
              <li data-step={id} data-show-for={id === "xas" ? "xrayabs" : undefined} hidden={id === "xas" && v.type !== "xrayabs"}>
                <a href={`#step-${id}`}>
                  <span class="step-title">{title}</span>
                  <span class="step-hint">{hint}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <form method="post" enctype="multipart/form-data" class="submit-form" id="submit-form" novalidate data-edit={props.edit ? "1" : undefined}>
          <Step id="files">
            <div class="dropzone" id="dropzone" hidden>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
              </svg>
              <p>
                <strong>{props.edit ? "Drop a new spectrum file here" : "Drop your files here"}</strong> or{" "}
                <button type="button" class="link-button" id="browse">choose files</button>
              </p>
              <p class="hint">
                {props.edit
                  ? "Only to replace the spectrum file. To keep the current file, continue."
                  : "The spectrum (DM3/DM4, MSA, Velox EMD, HyperSpy HSPY, XDI, or two columns of numbers), and optionally a matching low-loss spectrum and a companion file from the same session."}{" "}
                Up to {MAX_FILE_MB} MB each.
              </p>
              <input type="file" id="f-drop" multiple hidden accept={[...new Set([...SPECTRUM_EXTENSIONS, ...COMPANION_EXTENSIONS])].map((e) => `.${e}`).join(",")} />
            </div>
            <ul class="file-list" id="file-list" aria-live="polite"></ul>
            <div class="fallback-files">
              <Field
                name="file"
                label={props.edit ? "Replace the spectrum file (optional)" : "Spectrum file"}
                errors={errors}
                hint="DM3/DM4, MSA, Velox EMD, HyperSpy HSPY, XDI, or two columns of numbers (.txt, .csv)."
              >
                <input id="f-file" name="file" type="file" required={!props.edit} accept={accept} />
              </Field>
              <Field name="lowloss_file" label="Matching low-loss spectrum (optional)" errors={errors} hint="Used to estimate the thickness.">
                <input id="f-lowloss_file" name="lowloss_file" type="file" accept={accept} />
              </Field>
              <Field name="companion_file" label="Companion file from the same session (optional)" errors={errors} hint="For example a Velox .emd or TIA .ser survey: it often records the beam energy and convergence angle.">
                <input id="f-companion_file" name="companion_file" type="file" accept={COMPANION_EXTENSIONS.map((e) => `.${e}`).join(",")} />
              </Field>
            </div>
            <input type="hidden" name="browser_checks" id="browser-checks" value="" />
            <StepNav next="Continue" />
          </Step>

          <Step id="specimen">
            <p class="hint step-intro" data-prefilled hidden>Some fields are filled in from your file. Please check them.</p>
            <div class="grid-2">
              <Field name="title" label="Specimen name" errors={errors}>{input("title", v, { required: true, maxlength: 200 })}</Field>
              <Field name="type" label="Spectrum type" errors={errors}>
                <select id="f-type" name="type" required>
                  <option value="">Choose…</option>
                  {Object.entries(TYPE_NAMES).map(([code, name]) => (
                    <option value={code} selected={v.type === code}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field name="formula" label="Chemical formula" errors={errors} hint="For example Fe2O3 or (La0.7,Sr0.3)MnO3.">{input("formula", v, { required: true })}</Field>
              <Field name="elements" label="Elements" errors={errors} hint="Filled from the formula; correct it if needed.">{input("elements", v, { placeholder: "Fe, O" })}</Field>
              <Field name="edges" label="Edges" errors={errors} hint='Separate with semicolons, for example "Fe_L2,3; O_K".'>{input("edges", v)}</Field>
              <Field name="keywords" label="Keywords" errors={errors} hint="Comma-separated.">{input("keywords", v)}</Field>
            </div>
            <div class="grid-2">
              <Field name="phase" label="Phase" errors={errors}>
                <select id="f-phase" name="phase">
                  {["solid", "liquid", "gas"].map((p) => <option value={p} selected={(v.phase ?? "solid") === p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
              </Field>
              <Field name="intensity_units" label="Intensity units" errors={errors}>
                <select id="f-intensity_units" name="intensity_units">
                  {Object.entries(UNIT_LABELS).map(([u, label]) => <option value={u} selected={(v.intensity_units ?? "counts") === u}>{label}</option>)}
                </select>
              </Field>
            </div>
            <Field name="source_purity" label="Source and purity" errors={errors}>{input("source_purity", v)}</Field>
            <Field name="description" label="Comments" errors={errors}>
              <textarea id="f-description" name="description" rows={4}>{v.description ?? ""}</textarea>
            </Field>
            <StepNav back next="Continue" />
          </Step>

          <Step id="xas" hidden={v.type !== "xrayabs"}>
            <p class="hint">XDI files fill these in. The beam energy and angles in the next step do not apply to X-ray absorption.</p>
            <div class="grid-2">
              {XAS_LABELS.map(([key, label, hint]) => (
                <Field name={`xas_${key}`} label={label} errors={errors} hint={hint}>{input(`xas_${key}`, v)}</Field>
              ))}
            </div>
            <StepNav back next="Continue" />
          </Step>

          <Step id="acquisition">
            {props.instruments.length > 0 && (
              <Field name="instrument" label="Instrument profile" errors={errors} hint="Facility calibrations for this microscope. Choosing one fills the angles below.">
                <select id="f-instrument" name="instrument">
                  <option value="">None</option>
                  {props.instruments.map((i) => (
                    <option value={`${i.id}:${i.version}`} selected={v.instrument === `${i.id}:${i.version}`} data-name={i.name} data-calibrations={i.calibrations}>
                      {i.facility ? `${i.facility}: ` : ""}{i.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div class="grid-2">
              <Field name="microscope" label="Microscope (or beamline)" errors={errors}>{input("microscope", v)}</Field>
              <Field name="detector" label="Spectrometer / detector" errors={errors}>{input("detector", v)}</Field>
              <Field name="gun_type" label="Gun type" errors={errors}>{input("gun_type", v, { placeholder: "e.g. Schottky FEG" })}</Field>
              <Field name="acquisition_mode" label="Acquisition mode" errors={errors}>{input("acquisition_mode", v, { placeholder: "STEM, TEM image, diffraction…" })}</Field>
            </div>

            <fieldset class={`field${errors.beam_energy || errors.beam_energy_uncertainty || errors.beam_energy_choice ? " has-error" : ""}`} data-measured="beam_energy">
              <legend>Beam energy</legend>
              <div class="choice-buttons" role="radiogroup" aria-label="Beam energy">
                {BEAM_ENERGIES.map((kv) => (
                  <label><input type="radio" name="beam_energy_choice" value={String(kv)} checked={choice === String(kv)} /><span>{kv} kV</span></label>
                ))}
                <label><input type="radio" name="beam_energy_choice" value="other" checked={choice === "other"} /><span>Other</span></label>
                <label><input type="radio" name="beam_energy_choice" value="unknown" checked={choice === "unknown"} /><span>Unknown</span></label>
              </div>
              <div class="measured-row beam-other">
                <input id="f-beam_energy" name="beam_energy" type="number" step="any" min="0" value={v.beam_energy ?? ""} aria-label="Other beam energy (kV)" />
                <span class="unit">kV</span>
                <label class="check"><input type="checkbox" name="beam_energy_approx" value="1" checked={!!v.beam_energy_approx} /> Approximate</label>
                <label for="f-beam_energy_uncertainty" class="inline-label">±</label>
                <input id="f-beam_energy_uncertainty" name="beam_energy_uncertainty" type="number" step="any" min="0" value={v.beam_energy_uncertainty ?? ""} aria-label="Beam energy uncertainty (kV)" />
              </div>
              <input type="hidden" name="beam_energy_source" value={v.beam_energy_source ?? "user"} />
              <p class="hint provenance" data-provenance="beam_energy">Where it came from: you.</p>
              {errors.beam_energy && <p class="error">{errors.beam_energy}</p>}
              {errors.beam_energy_choice && <p class="error">{errors.beam_energy_choice}</p>}
              {errors.beam_energy_uncertainty && <p class="error">{errors.beam_energy_uncertainty}</p>}
            </fieldset>

            <div class="grid-2">
              <Measured name="convergence" label="Convergence semi-angle" unit="mrad" v={v} errors={errors} hint="Where it came from: you." />
              <Measured name="collection" label="Collection semi-angle" unit="mrad" v={v} errors={errors} hint="Where it came from: you." />
            </div>

            <div class="grid-3">
              <Field name="resolution_ev" label="Energy resolution (eV)" errors={errors}>{input("resolution_ev", v, { type: "number", step: "any", min: 0 })}</Field>
              <Field name="dispersion_ev" label="Dispersion (eV/channel)" errors={errors}>{input("dispersion_ev", v, { type: "number", step: "any", min: 0 })}</Field>
              <Field name="monochromated" label="Monochromated" errors={errors}>
                <select id="f-monochromated" name="monochromated">
                  <option value="">Not stated</option>
                  <option value="1" selected={v.monochromated === "1"}>Yes</option>
                  <option value="0" selected={v.monochromated === "0"}>No</option>
                </select>
              </Field>
              <Field name="integration_time_s" label="Integration time (s)" errors={errors}>{input("integration_time_s", v, { type: "number", step: "any", min: 0 })}</Field>
              <Field name="readouts" label="Number of readouts" errors={errors}>{input("readouts", v, { type: "number", step: "1", min: 0 })}</Field>
              <Field name="probe_size_nm2" label="Probe size (nm²)" errors={errors}>{input("probe_size_nm2", v, { type: "number", step: "any", min: 0 })}</Field>
              <Field name="beam_current" label="Beam current" errors={errors}>{input("beam_current", v)}</Field>
            </div>
            <StepNav back next="Continue" />
          </Step>

          <Step id="treatment">
            <div class="grid-3">
              <Field name="dark_current" label="Dark current corrected" errors={errors}>
                <select id="f-dark_current" name="dark_current">
                  <option value="">Not stated</option>
                  <option value="1" selected={v.dark_current === "1"}>Yes</option>
                  <option value="0" selected={v.dark_current === "0"}>No</option>
                </select>
              </Field>
              <Field name="gain_variation" label="Gain variation corrected" errors={errors}>
                <select id="f-gain_variation" name="gain_variation">
                  <option value="">Not stated</option>
                  <option value="1" selected={v.gain_variation === "1"}>Yes</option>
                  <option value="0" selected={v.gain_variation === "0"}>No</option>
                </select>
              </Field>
              <Field name="thickness_t_lambda" label="Relative thickness (t/λ)" errors={errors}>{input("thickness_t_lambda", v, { type: "number", step: "any", min: 0 })}</Field>
            </div>
            <Field name="calibration" label="Energy calibration" errors={errors}>{input("calibration", v, { placeholder: "e.g. zero-loss peak at 0 eV" })}</Field>
            <fieldset class="field">
              <legend>Deconvolution</legend>
              <div class="checks-row">
                {[
                  ["deconv_fourier_log", "Fourier-log"],
                  ["deconv_fourier_ratio", "Fourier-ratio"],
                  ["deconv_stephens", "Stephens"],
                  ["deconv_richardson_lucy", "Richardson-Lucy"],
                  ["deconv_maximum_entropy", "Maximum entropy"],
                ].map(([name, label]) => (
                  <label class="check"><input type="checkbox" name={name} value="1" checked={!!v[name]} /> {label}</label>
                ))}
              </div>
              {input("deconv_other", v, { placeholder: "Other method", "aria-label": "Other deconvolution method" })}
            </fieldset>
            <StepNav back next="Continue" />
          </Step>

          <Step id="reference">
            <Field name="ref_doi" label="DOI of the paper" errors={errors} hint="Paste a DOI and press Look up to fill in the rest from CrossRef.">
              <div class="inline-form">
                {input("ref_doi", v, { placeholder: "10.1017/S1431927616000179" })}
                <button class="button secondary" type="button" id="doi-lookup">Look up</button>
              </div>
              <p class="hint" id="doi-status" aria-live="polite"></p>
            </Field>
            <div class="grid-2">
              <Field name="ref_title" label="Title" errors={errors}>{input("ref_title", v)}</Field>
              <Field name="ref_authors" label="Authors" errors={errors}>{input("ref_authors", v)}</Field>
              <Field name="ref_journal" label="Journal" errors={errors}>{input("ref_journal", v)}</Field>
              <div class="grid-4">
                <Field name="ref_year" label="Year" errors={errors}>{input("ref_year", v, { inputmode: "numeric" })}</Field>
                <Field name="ref_volume" label="Volume" errors={errors}>{input("ref_volume", v)}</Field>
                <Field name="ref_issue" label="Issue" errors={errors}>{input("ref_issue", v)}</Field>
                <Field name="ref_page" label="Pages" errors={errors}>{input("ref_page", v)}</Field>
              </div>
            </div>
            <Field name="ref_url" label="Web link (if no DOI)" errors={errors}>{input("ref_url", v, { type: "url" })}</Field>
            <Field name="associated" label="Associated EELSdb spectra" errors={errors} hint="Addresses of related spectra on this site, for example the low-loss of the same specimen.">
              {input("associated", v)}
            </Field>
            <Field name="other_urls" label="Other links" errors={errors} hint="One per line: the address, then an optional title.">
              <textarea id="f-other_urls" name="other_urls" rows={2}>{v.other_urls ?? ""}</textarea>
            </Field>
            <StepNav back next="Review" />
          </Step>

          <Step id="review">
            <div id="summary" class="summary"></div>
            <div id="final-checks" class="final-checks" hidden>
              <h3>File checks</h3>
              <p class="checks-status muted"></p>
              <ul class="findings"></ul>
            </div>
            {!props.edit && (
              <div class={`field${errors.agreement ? " has-error" : ""}`}>
                <label class="check agreement">
                  <input type="checkbox" name="agreement" value="1" required checked={!!v.agreement} /> I agree to publish this data under the{" "}
                  <a href="https://opendatacommons.org/licenses/odbl/">Open Data Commons Open Database Licence (ODbL)</a>: others may reuse it if they
                  credit me and the EELS Data Base.
                </label>
                {errors.agreement && <p class="error">{errors.agreement}</p>}
              </div>
            )}
            {siteKey && !props.edit && <div class="cf-turnstile" data-sitekey={siteKey}></div>}
            {errors.turnstile && <p class="error">{errors.turnstile}</p>}
            <p class="error" id="submit-error" role="alert" hidden></p>
            <div class="step-nav">
              <button type="button" class="button secondary" data-back>Back</button>
              <button class="button" type="submit" id="submit-button">{props.edit ? "Save changes" : "Submit for review"}</button>
              {props.edit && <a class="button secondary" href={`/spectra/${encodeURIComponent(props.edit.slug)}/`}>Cancel</a>}
            </div>
          </Step>
        </form>
      </div>
      <script src="/vendor/uPlot.iife.min.js" defer></script>
      <script src="/submit.js" type="module"></script>
    </Layout>
  );
}

export const formValues = (body: Record<string, unknown>): Values =>
  Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "string")) as Values;

// The stepped form posts in the background so the browser keeps the chosen files; it asks for JSON.
const wantsJson = (c: C) => c.req.header("Accept")?.includes("application/json") ?? false;

export async function rejectForm(c: C, errors: Record<string, string>, status: 409 | 422, page: () => Promise<ReturnType<typeof SubmitPage>>) {
  return wantsJson(c) ? c.json({ errors }, status) : c.html(await page(), status);
}

export const finishForm = (c: C, url: string) => (wantsJson(c) ? c.json({ redirect: url }) : c.redirect(url));

submit.get("/submit-data/", requireUser, async (c) =>
  c.html(<SubmitPage c={c} v={{}} errors={{}} instruments={await approvedInstruments(c.env.DB)} />),
);

submit.post("/submit-data/", requireUser, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const { form, errors } = parseForm(body as any);
  const file = body.file instanceof File ? body.file : null;
  const lowloss = body.lowloss_file instanceof File && body.lowloss_file.size ? body.lowloss_file : null;
  const companion = body.companion_file instanceof File && body.companion_file.size ? body.companion_file : null;

  const fileError = await checkUpload(file, SPECTRUM_EXTENSIONS, "Spectrum file");
  if (fileError) errors.file = fileError;
  if (lowloss) {
    const e = await checkUpload(lowloss, SPECTRUM_EXTENSIONS, "Low-loss file");
    if (e) errors.lowloss_file = e;
  }
  if (companion) {
    const e = await checkUpload(companion, COMPANION_EXTENSIONS, "Companion file");
    if (e) errors.companion_file = e;
  }
  if (!(await instrumentOk(c.env.DB, form))) errors.instrument = "Choose an approved instrument profile.";
  if (!body.agreement) errors.agreement = "Please agree to the licence to publish your data.";
  if (!(await turnstileOk(c, typeof body["cf-turnstile-response"] === "string" ? body["cf-turnstile-response"] : null))) {
    errors.turnstile = "The anti-spam check failed. Please try again.";
  }
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitted_by = ? AND created_at > datetime('now', '-1 day')")
    .bind(user.id)
    .first<number>("n");
  if ((recent ?? 0) >= MAX_PER_DAY) errors.rate = `You can submit up to ${MAX_PER_DAY} spectra a day. Please try again tomorrow.`;

  if (Object.keys(errors).length) {
    return rejectForm(c, errors, 422, async () => <SubmitPage c={c} v={formValues(body)} errors={errors} instruments={await approvedInstruments(c.env.DB)} />);
  }

  const { id, slug } = await createSpectrum(c.env.DB, form, user);
  const files: [string, File][] = [["original", file!]];
  if (lowloss) files.push(["lowloss", lowloss]);
  if (companion) files.push(["companion", companion]);
  const fileRows = [];
  for (const [role, f] of files) {
    const bytes = await f.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = `submissions/${id}/${role}/${f.name.replace(/[^\w.\-]+/g, "_")}`;
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mediaType(f.name) }, sha256 });
    fileRows.push(
      c.env.DB.prepare("INSERT INTO files (spectrum_id, role, r2_key, filename, media_type, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, role, key, f.name, mediaType(f.name), f.size, sha256),
    );
  }
  const checks = cleanBrowserChecks(body.browser_checks);
  await c.env.DB.batch([
    ...fileRows,
    c.env.DB.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status, kind, browser_checks_json) VALUES (?, ?, 'pending', 'new', ?)")
      .bind(id, user.id, checks),
    c.env.DB.prepare("INSERT INTO history (spectrum_id, user_id, change_json) VALUES (?, ?, ?)")
      .bind(id, user.id, JSON.stringify({ action: "submitted", slug })),
  ]);
  return finishForm(c, `/account/submissions/?submitted=${id}`);
});

submit.get("/account/submissions/", requireUser, async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.slug, s.title, s.status AS spectrum_status, b.status, b.kind, b.created_at, b.moderator_notes
     FROM submissions b JOIN spectra s ON s.id = b.spectrum_id WHERE b.submitted_by = ? ORDER BY b.created_at DESC, b.id DESC`,
  ).bind(user.id).all<any>();
  const just = c.req.query("submitted");
  const STATUS: Record<string, string> = {
    pending: "Waiting for review",
    changes_requested: "Changes requested",
    approved: "Published",
    rejected: "Not accepted",
  };
  return c.html(
    <Layout title="Your submissions" path="/account/" user={user}>
      <h1>Your submissions</h1>
      {just && <p class="notice" role="status">Thank you. Your spectrum is in the review queue; you will see its status here.</p>}
      {results.length ? (
        <div class="table-scroll">
          <table>
            <thead><tr><th>Spectrum</th><th>Kind</th><th>Status</th><th>Moderator notes</th><th class="num">Sent</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr>
                  <td>{r.spectrum_status === "published" ? <a href={`/spectra/${encodeURIComponent(r.slug)}/`}>{r.title}</a> : r.title}</td>
                  <td>{r.kind === "edit" ? "Edit" : "New"}</td>
                  <td>{STATUS[r.status] ?? r.status}</td>
                  <td>{r.moderator_notes ?? ""}</td>
                  <td class="num">{String(r.created_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p class="muted">You have not submitted any spectra yet.</p>
          <p><a class="button" href="/submit-data/">Submit a spectrum</a></p>
        </>
      )}
    </Layout>,
  );
});
