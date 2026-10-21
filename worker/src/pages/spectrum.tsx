import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { API_HOST, SITE, loadBundle, type SpectrumBundle } from "../api/format";
import { EELSDB_BIBTEX, EELSDB_CITATION } from "./citation";
import { isModerator } from "../instruments";
import { Formula, Layout, TypeBadge, fmt } from "./layout";

type Row = Record<string, any>;

/** CrossRef titles carry HTML (<i>, <sub>); citations need plain text. */
const stripTags = (v: unknown) => String(v ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const SOURCE_NOTE: Record<string, string> = {
  file: "from the data file",
  companion: "from a companion file",
  profile: "from the instrument profile",
  estimate: "approximate",
};

/** A value with its uncertainty and, unless the submitter typed it, where it came from. */
function measured(value: number | null, unit: string, source: string | null, uncertainty: number | null) {
  if (source === "unknown") return <span class="muted">Unknown</span>;
  if (value === null || value === undefined) return null;
  const note = source && SOURCE_NOTE[source];
  return (
    <>
      {fmt(value, unit)}
      {uncertainty ? ` ± ${uncertainty} ${unit}` : ""}
      {note && <span class="muted small"> ({note})</span>}
    </>
  );
}

const yesNo = (v: unknown) => (v === null || v === undefined ? null : Number(v) ? "Yes" : "No");

function MetaList(props: { items: [string, unknown][] }) {
  const items = props.items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!items.length) return <p class="muted">Not recorded.</p>;
  return (
    <dl class="meta">
      {items.map(([k, v]) => (
        <>
          <dt>{k}</dt>
          <dd>{v as any}</dd>
        </>
      ))}
    </dl>
  );
}

function CopyButton(props: { target: string; what: string }) {
  return (
    <button class="copy" type="button" data-copy={props.target} aria-label={`Copy ${props.what}`}>
      <svg class="i-copy" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6.5" y="6.5" width="10" height="11" rx="1.5" />
        <path d="M13.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h1.5" />
      </svg>
      <svg class="i-done" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 10.5l4 4 8-9" />
      </svg>
      <span class="copy-label" role="status">Copy</span>
    </button>
  );
}

/** Stored edges typeset as "Fe L<sub>2,3</sub>". */
function EdgeList(props: { b: SpectrumBundle }) {
  if (!props.b.edges.length) return null;
  return (
    <span class="formula">
      {props.b.edges.map((e, i) => {
        const [, shell, sub] = String(e.edge).match(/^([A-Z])(.*)$/) ?? [, e.edge, ""];
        return <>{i > 0 && ", "}{e.element} {shell}{sub && <sub>{sub}</sub>}</>;
      })}
    </span>
  );
}

function referenceText(r: Row | null) {
  if (!r) return null;
  if (!r.authors && !r.title && r.freetext) return String(r.freetext);
  const parts = [
    r.authors,
    r.title && `“${stripTags(r.title)}”`,
    [r.journal, r.volume && (r.issue ? `${r.volume}(${r.issue})` : r.volume), r.page].filter(Boolean).join(", "),
    r.year && `(${r.year})`,
    r.doi && `doi:${r.doi}`,
  ].filter(Boolean);
  return parts.length ? parts.join(". ").replace(/\.\s*\(/, " (") : null;
}

function bibKey(s: Row) {
  const first = String(s.author_display ?? "eelsdb").split(" ").pop()!.replace(/[^A-Za-z]/g, "");
  return `${first}${String(s.published_at ?? "").slice(0, 4)}eelsdb${s.id}`;
}

export function spectrumCitation(b: SpectrumBundle) {
  const s = b.spectrum;
  const year = String(s.published_at ?? "").slice(0, 4);
  const url = `${SITE}/spectra/${encodeURIComponent(s.slug)}/`;
  const ref = referenceText(b.reference);
  const text = [
    `${s.author_display}. ${s.title}${s.formula ? ` (${s.formula})` : ""}. EELS Data Base, spectrum ${s.id}${year ? `, ${year}` : ""}. ${url}`,
    ref,
    EELSDB_CITATION,
  ].filter(Boolean).join("\n\n");

  const r = b.reference;
  const bib = [
    `@misc{${bibKey(s)},
  author = {${s.author_display}},
  title = {${s.title}},
  howpublished = {EELS Data Base, spectrum ${s.id}},
  year = {${year}},
  url = {${url}}
}`,
    r && (r.doi || r.title) &&
      `@article{${bibKey(s)}ref,
  author = {${r.authors ?? ""}},
  title = {${stripTags(r.title)}},
  journal = {${r.journal ?? ""}},
  volume = {${r.volume ?? ""}},
  number = {${r.issue ?? ""}},
  pages = {${String(r.page ?? "").replace("-", "--")}},
  year = {${r.year ?? ""}},
  doi = {${r.doi ?? ""}}
}`,
    EELSDB_BIBTEX,
  ].filter(Boolean).join("\n\n");
  return { text, bib };
}

export async function spectrumPage(c: Context<AppEnv>) {
  const slug = c.req.param("slug")!;
  const user = c.get("user");
  // Submitters and moderators can see a spectrum before it is published.
  const row = await c.env.DB.prepare("SELECT id, status, owner_id FROM spectra WHERE slug = ?").bind(slug).first<any>();
  const visible = row && (row.status === "published" || (row.status === "pending" && user && (row.owner_id === user.id || isModerator(user))));
  const id: number | null = visible ? row.id : null;
  const b = id === null ? null : await loadBundle(c.env.DB, id);
  if (!b) return c.notFound();
  const favourite = user
    ? await c.env.DB.prepare("SELECT 1 FROM favourites WHERE user_id = ? AND spectrum_id = ?").bind(user.id, id).first()
    : null;

  const s = b.spectrum;
  const a = b.acquisition ?? {};
  const t = b.treatment ?? {};
  const r = b.reference;
  const fileUrl = b.legacyFile ? `/${b.legacyFile.split("/").map(encodeURIComponent).join("/")}` : null;
  const fileName = b.legacyFile?.split("/").pop();
  const cite = spectrumCitation(b);
  const deconv = [
    Number(t.deconv_fourier_log) && "Fourier-log",
    Number(t.deconv_fourier_ratio) && "Fourier-ratio",
    Number(t.deconv_stephens) && "Stephens",
    Number(t.deconv_richardson_lucy) && "Richardson-Lucy",
    Number(t.deconv_maximum_entropy) && "Maximum entropy",
    t.deconv_other,
  ].filter(Boolean).join(", ");
  const canEdit = !!user && (s.owner_id === user.id || isModerator(user));
  const authorLink = <a href={`/author/${s.author_slug}/`}>{s.author_display}</a>;

  return c.html(
    <Layout user={c.get("user")}
      title={s.title}
      path="/spectra/"
      description={`${s.title}${s.formula ? ` (${s.formula})` : ""}: ${s.type} spectrum in the EELS Data Base.`}
      head={
        <>
          <link rel="stylesheet" href="/vendor/uPlot.min.css" />
          {b.spectrum.status === "published" && (
            <>
              <link rel="alternate" type="text/markdown" href={`/spectra/${encodeURIComponent(s.slug)}.md`} />
              <link rel="alternate" type="application/json" href={`${API_HOST}/v2/spectra/${s.id}`} />
            </>
          )}
        </>
      }
    >
      <p class="small back-link">
        <a href="/spectra/">← All spectra</a>
      </p>
      {b.spectrum.status !== "published" && (
        <p class="notice" role="status">Not published yet: this spectrum is waiting for a moderator. Only you and the moderators can see this page.</p>
      )}
      <div class="spectrum-head">
        <div>
          <h1>{s.title}</h1>
          <p class="byline">
            <TypeBadge type={s.type} /> <Formula formula={s.formula} /> · {authorLink} · added {String(s.published_at ?? "").slice(0, 10)}
            {s.completeness === "full" && (
              <> · <span class="badge-complete" title="Beam energy, convergence and collection angles are all recorded">Beam energy and angles known</span></>
            )}
            {" · "}
            <a href={`/spectra/${encodeURIComponent(s.slug)}/history/`}>History</a>
          </p>
        </div>
        <div class="head-actions">
        {canEdit && (
          <a class="button secondary" href={`/spectra/${encodeURIComponent(s.slug)}/edit/`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
            Edit
          </a>
        )}
        {user ? (
          <form method="post" action={`/favourites/${s.id}/`}>
            <button class="button secondary" type="submit" aria-pressed={favourite ? "true" : "false"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill={favourite ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
              </svg>
              {favourite ? "Saved" : "Save"}
            </button>
          </form>
        ) : (
          <a class="button secondary" href={`/login/?next=${encodeURIComponent(`/spectra/${s.slug}/`)}`}>Sign in to save</a>
        )}
        {fileUrl && (
          <button class="button" type="button" data-open="download-dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
            </svg>
            Download
          </button>
        )}
        </div>
      </div>

      <div class="plot-panel">
        <div
          id="plot"
          class="plot"
          data-src={fileUrl ?? ""}
          data-elements={JSON.stringify(b.elements)}
          data-edges={JSON.stringify(b.edges.map((e) => `${e.element}_${e.edge}`))}
          data-type={s.type}
        >
          <p class="plot-message">{fileUrl ? "Loading spectrum…" : "No data file for this spectrum."}</p>
        </div>
        <div class="plot-tools">
          <label><input type="checkbox" id="show-edges" checked /> Edge onsets (exSpy)</label>
          <label><input type="checkbox" id="show-minor" /> Minor edges</label>
          <span class="plot-hint">Drag to zoom, double-click to reset</span>
        </div>
      </div>

      {s.description && <p class="prose" style="margin-top:1.25rem">{s.description}</p>}

      {fileUrl?.toLowerCase().endsWith(".msa") && (
        <details class="snippet">
          <summary>Use in HyperSpy</summary>
          <pre>{`import exspy

spectra = exspy.data.eelsdb(title=${JSON.stringify(s.title)}${s.formula ? `, formula=${JSON.stringify(s.formula)}` : ""})
s = next(sp for sp in spectra if sp.original_metadata.json.id == ${s.id})
s.plot(plot_edges=True)`}</pre>
        </details>
      )}

      <div class="spectrum-cols">
        <section>
          <h2>Specimen</h2>
          <MetaList
            items={[
              ["Formula", s.formula && <Formula formula={s.formula} />],
              ["Elements", b.elements.join(", ")],
              ["Edges", b.edges.length ? <EdgeList b={b} /> : null],
              ["Source and purity", s.source_purity],
              ["Energy range", s.min_energy_ev !== null && s.max_energy_ev !== null ? `${Number(s.min_energy_ev.toFixed(2))} – ${Number(s.max_energy_ev.toFixed(2))} eV` : null],
              ["Step", fmt(s.step_ev, "eV", 4)],
              ["Phase", s.phase !== "solid" ? s.phase : null],
              ["Intensity", s.intensity_units !== "counts" ? s.intensity_units.replace("_", " ") : null],
            ]}
          />
          {b.keywords.length > 0 && (
            <>
              <h3>Keywords</h3>
              <ul class="tags">
                {b.keywords.map((k) => <li class="chip">{k}</li>)}
              </ul>
            </>
          )}
          <h2>Treatment</h2>
          <MetaList
            items={[
              ["Dark current corrected", yesNo(t.dark_current)],
              ["Gain variation corrected", yesNo(t.gain_variation)],
              ["Calibration", t.calibration],
              ["Thickness", t.thickness_t_lambda && `${t.thickness_t_lambda} t/λ`],
              ["Deconvolution", deconv],
            ]}
          />
        </section>
        <section>
          {b.xas && (
            <>
              <h2>X-ray absorption</h2>
              <MetaList
                items={[
                  ["Facility", b.xas.facility],
                  ["Beamline", b.xas.beamline],
                  ["Source", b.xas.source_type],
                  ["Monochromator", b.xas.monochromator],
                  ["Resolving power", b.xas.resolving_power],
                  ["Detection", b.xas.detection_mode],
                  ["Polarisation", [b.xas.polarisation, b.xas.polarisation_angle_deg != null && `${b.xas.polarisation_angle_deg}°`].filter(Boolean).join(", ")],
                  ["Calibration reference", b.xas.calibration_reference],
                  ["I0 normalisation", b.xas.i0_normalisation],
                ]}
              />
            </>
          )}
          <h2>Acquisition</h2>
          <MetaList
            items={[
              [s.type === "xrayabs" ? "Beamline" : "Microscope", a.microscope],
              ["Gun", a.gun_type],
              ["Beam energy", measured(a.beam_energy_kv, "kV", a.beam_energy_source, a.beam_energy_uncertainty)],
              ["Convergence semi-angle", measured(a.convergence_mrad, "mrad", a.convergence_source, a.convergence_uncertainty)],
              ["Collection semi-angle", measured(a.collection_mrad, "mrad", a.collection_source, a.collection_uncertainty)],
              ["Instrument profile", a.instrument_profile_id && (
                <a href={`/instruments/${a.instrument_profile_id}/?version=${a.instrument_profile_version}`}>version {a.instrument_profile_version}</a>
              )],
              ["Resolution", fmt(a.resolution_ev, "eV", 3)],
              ["Monochromated", yesNo(a.monochromated)],
              ["Mode", a.acquisition_mode],
              ["Detector", a.detector],
              ["Probe size", fmt(a.probe_size_nm2, "nm²")],
              ["Beam current", a.beam_current],
              ["Integration time", fmt(a.integration_time_s, "s", 3)],
              ["Readouts", a.readouts],
            ]}
          />
          {r && (
            <>
              <h2>Reference</h2>
              <p>
                {referenceText(r)}
                {r.doi && (
                  <>
                    {" "}
                    <a href={`https://doi.org/${r.doi}`}>Article</a>
                  </>
                )}
                {!r.doi && r.url && /^https?:\/\//.test(r.url) && (
                  <>
                    {" "}
                    <a href={r.url}>Link</a>
                  </>
                )}
              </p>
            </>
          )}
          {b.links.length > 0 && (
            <>
              <h2>Associated spectra</h2>
              <ul class="plain-list">
                {b.links.map((l) => (
                  <li>
                    <a href={`/spectra/${encodeURIComponent(l.slug)}/`}>{l.title}</a> <TypeBadge type={l.type} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.otherUrls.length > 0 && (
            <>
              <h2>Other links</h2>
              <ul class="plain-list">
                {b.otherUrls.map((u) => (
                  <li><a href={u.url}>{u.title || u.url}</a></li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {fileUrl && (
        <dialog id="download-dialog" aria-labelledby="download-title">
          <h2 id="download-title">Cite this spectrum</h2>
          <p class="muted small">
            If you use this spectrum, cite the contributor{r ? "'s paper" : ""} and the EELS Data Base.
          </p>
          <div class="cite-block">
            <div id="cite-text" class="cite-text">{cite.text}</div>
            <CopyButton target="cite-text" what="citation" />
          </div>
          <details class="cite-bib">
            <summary>BibTeX</summary>
            <div class="cite-block">
              <pre id="cite-bib">{cite.bib}</pre>
              <CopyButton target="cite-bib" what="BibTeX" />
            </div>
          </details>
          <div class="dialog-actions">
            <button class="button secondary" type="button" data-close>Close</button>
            <a class="button" href={fileUrl} download={fileName} autofocus>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
              </svg>
              <span class="dl-name">Download {fileName}</span>
            </a>
          </div>
        </dialog>
      )}
      <script src="/vendor/uPlot.iife.min.js" defer></script>
      <script src="/spectrum.js" defer></script>
    </Layout>,
  );
}
