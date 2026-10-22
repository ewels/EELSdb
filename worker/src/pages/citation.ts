export const EELSDB_CITATION =
  "Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie. “A Complete Overhaul of the Electron Energy-Loss Spectroscopy and X-Ray Absorption Spectroscopy Database: eelsdb.eu.” Microscopy and Microanalysis 22, 717–724 (2016). doi:10.1017/S1431927616000179";

export const EELSDB_BIBTEX = `@article{ewels2016eelsdb,
  author = {Ewels, Philip and Sikora, Thierry and Serin, Virginie and Ewels, Chris P. and Lajaunie, Luc},
  title = {A Complete Overhaul of the Electron Energy-Loss Spectroscopy and X-Ray Absorption Spectroscopy Database: eelsdb.eu},
  journal = {Microscopy and Microanalysis},
  volume = {22},
  pages = {717--724},
  year = {2016},
  doi = {10.1017/S1431927616000179}
}`;

/** CrossRef titles carry HTML (<i>, <sub>); citations need plain text. */
export const stripTags = (v: unknown) => String(v ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** A paper reference as one line of plain text, or null when there is nothing to show. */
export function referenceText(r: Record<string, any> | null) {
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
