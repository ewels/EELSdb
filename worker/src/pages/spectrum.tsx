import type { Context } from "hono";
import { SITE, loadBundle, type SpectrumBundle } from "../api/format";
import { EELSDB_BIBTEX, EELSDB_CITATION } from "./citation";
import { Formula, Layout, TypeBadge, fmt } from "./layout";

type Row = Record<string, any>;

/** CrossRef titles carry HTML (<i>, <sub>); citations need plain text. */
const stripTags = (v: unknown) => String(v ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

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

/** "Fe L2,3" style labels for the stored edges. */
const edgeLabels = (b: SpectrumBundle) => b.edges.map((e) => `${e.element} ${e.edge}`);

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

export async function spectrumPage(c: Context<{ Bindings: Env }>) {
  const slug = c.req.param("slug")!;
  const id = await c.env.DB.prepare("SELECT id FROM spectra WHERE slug = ? AND status = 'published'").bind(slug).first<number>("id");
  const b = id === null ? null : await loadBundle(c.env.DB, id);
  if (!b) return c.notFound();

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
  const authorLink = <a href={`/author/${s.author_slug}/`}>{s.author_display}</a>;

  return c.html(
    <Layout
      title={s.title}
      path="/spectra/"
      description={`${s.title}${s.formula ? ` (${s.formula})` : ""}: ${s.type} spectrum in the EELS Data Base.`}
      head={<link rel="stylesheet" href="/vendor/uPlot.min.css" />}
    >
      <p class="small" style="margin-top:1.25rem">
        <a href="/spectra/">← All spectra</a>
      </p>
      <div class="spectrum-head">
        <div>
          <h1>{s.title}</h1>
          <p class="byline">
            <TypeBadge type={s.type} /> <Formula formula={s.formula} /> · {authorLink} · added {String(s.published_at ?? "").slice(0, 10)}
          </p>
        </div>
        {fileUrl && (
          <button class="button" type="button" data-open="download-dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
            </svg>
            Download
          </button>
        )}
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
          <span>Drag to zoom, double-click to reset.</span>
        </div>
      </div>

      {s.description && <p class="prose" style="margin-top:1.25rem">{s.description}</p>}

      <div class="spectrum-cols">
        <section>
          <h2>Specimen</h2>
          <MetaList
            items={[
              ["Formula", s.formula && <Formula formula={s.formula} />],
              ["Elements", b.elements.join(", ")],
              ["Edges", edgeLabels(b).join(", ")],
              ["Source and purity", s.source_purity],
              ["Energy range", s.min_energy_ev !== null && s.max_energy_ev !== null ? `${Number(s.min_energy_ev.toFixed(2))} – ${Number(s.max_energy_ev.toFixed(2))} eV` : null],
              ["Step", fmt(s.step_ev, "eV", 4)],
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
          <h2>Acquisition</h2>
          <MetaList
            items={[
              [s.type === "xrayabs" ? "Beamline" : "Microscope", a.microscope],
              ["Gun", a.gun_type],
              ["Beam energy", fmt(a.beam_energy_kv, "kV")],
              ["Convergence semi-angle", fmt(a.convergence_mrad, "mrad")],
              ["Collection semi-angle", fmt(a.collection_mrad, "mrad")],
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
                {!r.doi && r.url && (
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
              <ul>
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
              <ul>
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
          <h2 id="download-title">Please cite this spectrum</h2>
          <p class="muted small">
            If you use this spectrum, cite the contributor{r ? "'s paper" : ""} and the EELS Data Base.
          </p>
          <div class="cite-block">
            <pre id="cite-text">{cite.text}</pre>
            <button class="button secondary copy" type="button" data-copy="cite-text">Copy</button>
          </div>
          <details>
            <summary>BibTeX</summary>
            <div class="cite-block">
              <pre id="cite-bib">{cite.bib}</pre>
              <button class="button secondary copy" type="button" data-copy="cite-bib">Copy</button>
            </div>
          </details>
          <div class="dialog-actions">
            <button class="button secondary" type="button" data-close>Close</button>
            <a class="button" href={fileUrl} download={fileName}>Download {fileName}</a>
          </div>
        </dialog>
      )}
      <script src="/vendor/uPlot.iife.min.js" defer></script>
      <script src="/spectrum.js" defer></script>
    </Layout>,
  );
}
