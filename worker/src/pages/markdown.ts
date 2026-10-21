// Markdown versions of the spectrum, author and news pages, at the page address with ".md" in place of the
// trailing slash. Each HTML page links to its version with <link rel="alternate" type="text/markdown">.
import { SITE, loadBundle } from "../api/format";
import { formatV2 } from "../api/v2";
import { decodeEntities } from "./entities";
import { TYPE_NAMES } from "./layout";
import { spectrumCitation } from "./spectrum";

type Row = Record<string, any>;

export const markdownHeaders = { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" };

const list = (items: [string, unknown][]) =>
  items
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("\n");

const SOURCE: Record<string, string> = {
  file: "from the data file",
  companion: "from a companion file",
  profile: "from an instrument profile",
  user: "typed by the contributor",
  estimate: "approximate",
};

function measured(m: Row | null, unit: "kv" | "mrad", label: string) {
  if (!m) return null;
  if (m.source === "unknown") return "unknown";
  const value = `${m[`value_${unit}`]} ${label}${m[`uncertainty_${unit}`] ? ` ± ${m[`uncertainty_${unit}`]} ${label}` : ""}`;
  return SOURCE[m.source] ? `${value} (${SOURCE[m.source]})` : value;
}

export async function spectrumMarkdown(db: D1Database, slug: string) {
  const id = await db.prepare("SELECT id FROM spectra WHERE slug = ? AND status = 'published'").bind(slug).first<number>("id");
  const b = id === null ? null : await loadBundle(db, id);
  if (!b) return null;
  const s = formatV2(b);
  const a = s.acquisition;
  const t = s.treatment;
  const r = s.reference;
  const cite = spectrumCitation(b);
  const sections = [
    `# ${s.title}`,
    `${TYPE_NAMES[s.type] ?? s.type} spectrum${s.formula ? ` of ${s.formula}` : ""}, contributed by ${s.author.name}${s.published_at ? `, published ${s.published_at.slice(0, 10)}` : ""}.`,
    list([
      ["Web page", s.url],
      ["API v2 record (JSON)", s.api_url],
      ["Data file", s.download_url],
      ["Licence", s.licence ?? "none recorded (from the old site, which stated the ODbL for all its data)"],
    ]),
    "## Specimen",
    list([
      ["Formula", s.formula],
      ["Elements", s.elements],
      ["Edges", s.edges.map((e) => `${e.element} ${e.edge}`)],
      ["Phase", s.phase],
      ["Intensity units", s.intensity_units],
      ["Source and purity", s.source_purity],
      ["Keywords", s.keywords],
      ["Energy range", s.energy.min_ev !== null ? `${s.energy.min_ev} to ${s.energy.max_ev} eV, step ${s.energy.step_ev} eV` : null],
    ]),
    s.description?.trim() ?? "",
    a &&
      [
        "## Acquisition",
        list([
          ["Microscope", a.microscope],
          ["Detector", a.detector],
          ["Gun type", a.gun_type],
          ["Mode", a.mode],
          ["Beam energy", measured(a.beam_energy, "kv", "kV")],
          ["Convergence semi-angle", measured(a.convergence_angle, "mrad", "mrad")],
          ["Collection semi-angle", measured(a.collection_angle, "mrad", "mrad")],
          ["Resolution", a.resolution_ev !== null ? `${a.resolution_ev} eV` : null],
          ["Monochromated", a.monochromated === null ? null : a.monochromated ? "yes" : "no"],
          ["Dispersion", a.dispersion_ev !== null ? `${a.dispersion_ev} eV` : null],
          ["Integration time", a.integration_time_s !== null ? `${a.integration_time_s} s` : null],
          ["Readouts", a.readouts],
        ]),
      ].join("\n\n"),
    s.xas && ["## X-ray absorption", list(Object.entries(s.xas))].join("\n\n"),
    t &&
      [
        "## Treatment",
        list([
          ["Dark current corrected", t.dark_current_corrected === null ? null : t.dark_current_corrected ? "yes" : "no"],
          ["Gain variation corrected", t.gain_variation_corrected === null ? null : t.gain_variation_corrected ? "yes" : "no"],
          ["Calibration", t.calibration],
          ["Thickness", t.thickness ? `${t.thickness.value_t_lambda} t/λ` : null],
          ["Deconvolutions", t.deconvolutions],
        ]),
      ].join("\n\n"),
    r && ["## Reference", list([["Title", r.title], ["Authors", r.authors], ["Journal", r.journal], ["Year", r.year], ["DOI", r.doi_url], ["Link", r.url], ["Reference", r.freetext]])].join("\n\n"),
    s.associated.length && ["## Associated spectra", s.associated.map((x) => `- ${x.title} (${TYPE_NAMES[x.type] ?? x.type}): ${x.api_url}`).join("\n")].join("\n\n"),
    s.files.length &&
      ["## Files\n", "| Role | File | Bytes | SHA-256 |\n| --- | --- | --- | --- |", ...s.files.map((f) => `| ${f.role} | [${f.filename}](${f.url}) | ${f.bytes ?? ""} | ${f.sha256 ?? ""} |`)].join("\n"),
    "## Cite this spectrum",
    "Cite the contributor's paper, if there is one, and the EELS Data Base:",
    "```text\n" + cite.text + "\n```",
    "```bibtex\n" + cite.bib + "\n```",
  ];
  return sections.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export async function authorMarkdown(db: D1Database, slug: string) {
  const person = await db.prepare("SELECT id, display_name, job_title, affiliation, orcid, profile_public FROM users WHERE slug = ?").bind(slug).first<Row>();
  const { results } = await db.prepare(
    `SELECT slug, title, type, formula, author_display, published_at FROM spectra
     WHERE status = 'published' AND (author_slug = ? OR owner_id = ?) ORDER BY published_at DESC, id DESC`,
  ).bind(slug, person?.id ?? -1).all<Row>();
  const profile = !!person?.profile_public;
  if (!results.length && !profile) return null;
  const name = person?.display_name ?? results[0].author_display;
  return [
    `# ${name}`,
    profile && list([["Job title", person!.job_title], ["Affiliation", person!.affiliation], ["ORCID", person!.orcid && `https://orcid.org/${person!.orcid}`]]),
    `- Web page: ${SITE}/author/${slug}/`,
    `## Contributed spectra (${results.length})`,
    results.map((s) => `- [${s.title}](${SITE}/spectra/${encodeURIComponent(s.slug)}.md): ${TYPE_NAMES[s.type] ?? s.type}${s.formula ? `, ${s.formula}` : ""}, ${String(s.published_at).slice(0, 10)}`).join("\n"),
  ].filter(Boolean).join("\n\n") + "\n";
}

/** The news archive holds only p, a, br, strong, em, sup and blockquote (see eelsdb.legacy.record_news). */
export function htmlToMarkdown(html: string) {
  return decodeEntities(
    html
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, "[$2]($1)")
      .replace(/<\/?(strong|b)>/g, "**")
      .replace(/<\/?(em|i)>/g, "*")
      .replace(/<sup>([\s\S]*?)<\/sup>/g, "^$1")
      .replace(/<br\s*\/?>/g, "  \n")
      .replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, q) => q.replace(/<\/?p>/g, "\n").trim().split("\n").map((l: string) => `> ${l.trim()}`).join("\n") + "\n\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, "$1\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function newsMarkdown(db: D1Database, slug: string) {
  const post = await db.prepare("SELECT title, published_at, body_html, legacy_v1 FROM news WHERE slug = ?").bind(slug).first<Row>();
  if (!post) return null;
  const author = JSON.parse(post.legacy_v1).author?.name;
  return [`# ${post.title}`, `${String(post.published_at).slice(0, 10)}${author ? `, ${author}` : ""}. ${SITE}/${slug}/`, htmlToMarkdown(post.body_html ?? "")].join("\n\n") + "\n";
}
