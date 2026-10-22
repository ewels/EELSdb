// Spectrum metadata for harvesters and search engines: Dublin Core and DataCite (OAI-PMH), DCAT-AP and schema.org.
// EELSdb mints no DOIs, so in every format a spectrum is identified by its page URL and the paper's DOI is a relation.
import { EELSDB_CITATION, referenceText, stripTags } from "../pages/citation";
import { variantUnits } from "../submit/form";
import { isoTime, modifiedAt } from "./dates";
import { API_HOST, SITE, loadMany, type SpectrumBundle } from "./format";

export const PUBLISHER = "EELSdb";
export const CONTACT_URL = `${SITE}/contact/`;
export const CATALOG_DESCRIPTION =
  "A public database of electron energy-loss (EELS) and X-ray absorption (XAS) spectra, shared by the community and checked by moderators.";

const LICENCES: Record<string, { name: string; url: string; eu: string }> = {
  "ODbL-1.0": {
    name: "Open Data Commons Open Database License v1.0",
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
    eu: "http://publications.europa.eu/resource/authority/licence/ODC_BL",
  },
};
// The site footer puts all data under the ODbL; migrated spectra have no licence stored.
const DEFAULT_LICENCE = "ODbL-1.0";

const TYPE_NAMES: Record<string, string> = {
  coreloss: "Core-loss EELS spectrum",
  lowloss: "Low-loss EELS spectrum",
  zeroloss: "Zero-loss EELS spectrum",
  xrayabs: "X-ray absorption spectrum",
};
const TECHNIQUES: Record<string, string> = { eels: "Electron energy-loss spectroscopy", xas: "X-ray absorption spectroscopy" };
const INTENSITY_LABELS: Record<string, string> = {
  counts: "Counts",
  oscillator_strength: "Oscillator strength",
  mu: "Absorption coefficient (mu)",
  optical_density: "Optical density",
  normalised: "Normalised intensity",
};
// EU file-type vocabulary; MSA, XDI and DM files have no entry, so text files are TXT and the rest go without.
const EU_FILE_TYPES: Record<string, string> = { msa: "TXT", emsa: "TXT", txt: "TXT", xdi: "TXT", csv: "CSV", json: "JSON", hspy: "HDF", emd: "HDF" };

export type MetaRecord = {
  id: number;
  url: string;
  apiUrl: string;
  title: string;
  description: string;
  formula: string | null;
  elements: string[];
  edges: string[];
  keywords: string[];
  type: string;
  typeLabel: string;
  technique: string;
  phase: string;
  intensityUnits: string;
  creator: { name: string; orcid: string | null; url: string };
  issued: string;
  modified: string;
  licence: { id: string; name: string; url: string; eu: string | null };
  reference: { doi: string | null; url: string | null; citation: string | null } | null;
  files: { url: string; filename: string; mediaType: string; bytes: number | null; sha256: string | null; main: boolean; title: string }[];
  energy: { min: number | null; max: number | null; step: number | null };
};

const fileUrl = (key: string) => `${SITE}/${key.split("/").map(encodeURIComponent).join("/")}`;
const plain = (v: unknown) => stripTags(String(v ?? "").replace(/<br\s*\/?>|<\/p>/gi, "\n"));

const FILE_TITLES: Record<string, string> = {
  legacy: "Spectrum",
  original: "Spectrum as uploaded",
  msa: "Spectrum (MSA)",
  hspy: "Spectrum (HyperSpy)",
  lowloss: "Low-loss spectrum",
  metadata: "Tags read from the original file",
};

/** A published spectrum as one format-neutral record; `orcid` only for authors who show it on their profile. */
export function toRecord(b: SpectrumBundle, orcid: string | null = null): MetaRecord {
  const s = b.spectrum;
  const r = b.reference;
  const licenceId = s.licence || DEFAULT_LICENCE;
  const licence = LICENCES[licenceId] ?? { name: licenceId, url: `https://spdx.org/licenses/${licenceId}.html`, eu: null };
  const typeLabel = TYPE_NAMES[s.type] ?? `${s.type} spectrum`;
  return {
    id: s.id,
    url: `${SITE}/spectra/${encodeURIComponent(s.slug)}/`,
    apiUrl: `${API_HOST}/v2/spectra/${s.id}`,
    title: s.title,
    description: plain(s.description) || `${typeLabel} of ${s.formula || s.title} in the EELS Data Base.`,
    formula: s.formula || null,
    elements: b.elements,
    edges: b.edges.map((e) => `${e.element} ${e.edge}`),
    keywords: b.keywords,
    type: s.type,
    typeLabel,
    technique: s.technique,
    phase: s.phase,
    intensityUnits: s.intensity_units,
    creator: { name: s.author_display || PUBLISHER, orcid, url: `${SITE}/author/${s.author_slug}/` },
    issued: isoTime(s.published_at),
    modified: isoTime(modifiedAt(s)!),
    licence: { id: licenceId, ...licence },
    reference: r && (r.doi || r.url || referenceText(r)) ? { doi: r.doi || null, url: /^https?:\/\//.test(r.url ?? "") ? r.url : null, citation: referenceText(r) } : null,
    files: b.files
      .filter((f) => f.role !== "companion")
      .map((f) => ({
        url: fileUrl(f.r2_key),
        filename: f.filename,
        mediaType: String(f.media_type ?? "application/octet-stream").split(";")[0],
        bytes: f.bytes ?? null,
        sha256: f.sha256 ?? null,
        main: f.r2_key === b.legacyFile,
        title: f.variant ? `Processed: ${f.variant.replaceAll("_", " ")}${variantUnits(f.variant) ? " (oscillator strength)" : ""}` : (FILE_TITLES[f.role] ?? f.role),
      }))
      .sort((x, y) => Number(y.main) - Number(x.main)),
    energy: { min: s.min_energy_ev ?? null, max: s.max_energy_ev ?? null, step: s.step_ev ?? null },
  };
}

/** ORCID iDs of the spectra's owners who show their links on their public profile. */
export async function creatorOrcids(db: D1Database, ids: number[]) {
  const { results } = await db
    .prepare(
      `SELECT s.id, i.subject AS orcid FROM spectra s JOIN users u ON u.id = s.owner_id AND u.show_links
       JOIN identities i ON i.user_id = u.id AND i.provider = 'orcid' WHERE s.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: number; orcid: string }>();
  return new Map(results.map((r) => [r.id, r.orcid]));
}

/** Records for published spectra, in the order of `ids`. */
export async function loadRecords(db: D1Database, ids: number[]): Promise<MetaRecord[]> {
  if (!ids.length) return [];
  const [bundles, orcids] = await Promise.all([loadMany(db, ids), creatorOrcids(db, ids)]);
  return bundles.filter((b) => b.spectrum.status === "published").map((b) => toRecord(b, orcids.get(b.spectrum.id) ?? null));
}

export const subjects = (r: MetaRecord) => [TECHNIQUES[r.technique], r.typeLabel, r.formula, ...r.elements, ...r.edges, ...r.keywords].filter((x): x is string => !!x);

// ---- XML (OAI-PMH) ----

export const xml = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const el = (name: string, value: unknown, attrs = "") => (value === null || value === undefined || value === "" ? "" : `<${name}${attrs}>${xml(value)}</${name}>`);

export function dublinCore(r: MetaRecord) {
  return [
    `<oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">`,
    el("dc:title", r.title),
    el("dc:creator", r.creator.name),
    ...subjects(r).map((x) => el("dc:subject", x)),
    el("dc:description", r.description),
    el("dc:publisher", PUBLISHER),
    el("dc:date", r.issued.slice(0, 10)),
    el("dc:type", "Dataset"),
    ...[...new Set(r.files.map((f) => f.mediaType))].map((x) => el("dc:format", x)),
    el("dc:identifier", r.url),
    r.reference?.doi ? el("dc:relation", `https://doi.org/${r.reference.doi}`) : el("dc:relation", r.reference?.url),
    el("dc:source", r.reference?.citation),
    el("dc:language", "en"),
    el("dc:rights", r.licence.url),
    "</oai_dc:dc>",
  ].join("");
}

/**
 * DataCite kernel 4. DataCite's documentation expects a DOI in `identifier`, but the schema allows any type, so the
 * page URL goes there. Harvesters that insist on a DOI will reject these records.
 */
export function dataCite(r: MetaRecord) {
  const orcid = r.creator.orcid
    ? `<nameIdentifier nameIdentifierScheme="ORCID" schemeURI="https://orcid.org">https://orcid.org/${xml(r.creator.orcid)}</nameIdentifier>`
    : "";
  const related = [
    r.reference?.doi && `<relatedIdentifier relatedIdentifierType="DOI" relationType="IsSupplementTo">${xml(r.reference.doi)}</relatedIdentifier>`,
    !r.reference?.doi && r.reference?.url && `<relatedIdentifier relatedIdentifierType="URL" relationType="IsSupplementTo">${xml(r.reference.url)}</relatedIdentifier>`,
    `<relatedIdentifier relatedIdentifierType="URL" relationType="IsPartOf">${SITE}/</relatedIdentifier>`,
  ].filter(Boolean);
  return [
    `<resource xmlns="http://datacite.org/schema/kernel-4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://datacite.org/schema/kernel-4 http://schema.datacite.org/meta/kernel-4/metadata.xsd">`,
    `<identifier identifierType="URL">${xml(r.url)}</identifier>`,
    `<creators><creator>${el("creatorName", r.creator.name)}${orcid}</creator></creators>`,
    `<titles>${el("title", r.title)}</titles>`,
    el("publisher", PUBLISHER),
    el("publicationYear", r.issued.slice(0, 4)),
    `<resourceType resourceTypeGeneral="Dataset">${xml(r.typeLabel)}</resourceType>`,
    `<subjects>${subjects(r).map((x) => el("subject", x)).join("")}</subjects>`,
    `<dates><date dateType="Issued">${r.issued.slice(0, 10)}</date><date dateType="Updated">${r.modified.slice(0, 10)}</date></dates>`,
    el("language", "en"),
    `<relatedIdentifiers>${related.join("")}</relatedIdentifiers>`,
    r.files.length ? `<formats>${[...new Set(r.files.map((f) => f.mediaType))].map((x) => el("format", x)).join("")}</formats>` : "",
    `<rightsList><rights rightsURI="${xml(r.licence.url)}" rightsIdentifier="${xml(r.licence.id)}" rightsIdentifierScheme="SPDX">${xml(r.licence.name)}</rights></rightsList>`,
    `<descriptions>${el("description", r.description, ' descriptionType="Abstract"')}</descriptions>`,
    "</resource>",
  ].join("");
}

// ---- JSON-LD ----

/** JSON for a `<script type="application/ld+json">` element: `<` is escaped so user text cannot close the element. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

const catalogRef = { "@type": "DataCatalog", name: "EELS Data Base", url: `${SITE}/` };

export function schemaOrg(r: MetaRecord) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": r.url,
    name: r.title,
    description: r.description,
    url: r.url,
    identifier: r.url,
    creator: { "@type": "Person", name: r.creator.name, url: r.creator.url, ...(r.creator.orcid && { "@id": `https://orcid.org/${r.creator.orcid}`, sameAs: `https://orcid.org/${r.creator.orcid}` }) },
    publisher: { "@type": "Organization", name: PUBLISHER, url: `${SITE}/` },
    license: r.licence.url,
    isAccessibleForFree: true,
    datePublished: r.issued,
    dateModified: r.modified,
    keywords: subjects(r),
    measurementTechnique: TECHNIQUES[r.technique],
    variableMeasured: [
      { "@type": "PropertyValue", name: r.technique === "xas" ? "Photon energy" : "Energy loss", unitText: "eV", minValue: r.energy.min ?? undefined, maxValue: r.energy.max ?? undefined },
      { "@type": "PropertyValue", name: INTENSITY_LABELS[r.intensityUnits] ?? r.intensityUnits },
    ],
    ...(r.reference && { citation: r.reference.doi ? `https://doi.org/${r.reference.doi}` : (r.reference.url ?? r.reference.citation) }),
    distribution: r.files.map((f) => ({ "@type": "DataDownload", name: f.title, contentUrl: f.url, encodingFormat: f.mediaType, ...(f.bytes && { contentSize: `${f.bytes} B` }) })),
    includedInDataCatalog: catalogRef,
  };
}

export const schemaOrgCatalog = () => ({
  "@context": "https://schema.org",
  ...catalogRef,
  alternateName: "EELSdb",
  description: CATALOG_DESCRIPTION,
  publisher: { "@type": "Organization", name: PUBLISHER, url: `${SITE}/` },
  license: LICENCES[DEFAULT_LICENCE].url,
  citation: EELSDB_CITATION,
});

// DCAT-AP 3.0, compacted with these prefixes.
export const DCAT_CONTEXT = {
  dcat: "http://www.w3.org/ns/dcat#",
  dct: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  vcard: "http://www.w3.org/2006/vcard/ns#",
  spdx: "http://spdx.org/rdf/terms#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  hydra: "http://www.w3.org/ns/hydra/core#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

const EU = "http://publications.europa.eu/resource/authority";
const literal = (value: string | number, type: string) => ({ "@value": String(value), "@type": type });
// Referenced resources carry their class, as the DCAT-AP shapes check it without loading the vocabularies.
const iri = (id: string, type?: string) => ({ "@id": id, ...(type && { "@type": type }) });
const page = (url: string) => iri(url, "foaf:Document");
const ENGLISH = iri(`${EU}/language/ENG`, "dct:LinguisticSystem");

export const dcatPublisher = () => ({ "@id": `${SITE}/#publisher`, "@type": "foaf:Agent", "foaf:name": PUBLISHER, "foaf:homepage": page(`${SITE}/`) });
const contactPoint = () => ({ "@type": ["vcard:Organization", "vcard:Kind"], "vcard:fn": PUBLISHER, "vcard:hasURL": iri(CONTACT_URL) });

export function dcatDataset(r: MetaRecord) {
  return {
    "@id": r.url,
    "@type": "dcat:Dataset",
    "dct:title": r.title,
    "dct:description": r.description,
    "dct:identifier": r.url,
    "dct:issued": literal(r.issued, "xsd:dateTime"),
    "dct:modified": literal(r.modified, "xsd:dateTime"),
    "dcat:keyword": subjects(r),
    "dcat:theme": { ...iri(`${EU}/data-theme/TECH`, "skos:Concept"), "skos:prefLabel": { "@value": "Science and technology", "@language": "en" } },
    "dct:language": ENGLISH,
    "dct:publisher": dcatPublisher(),
    "dct:creator": {
      "@id": r.creator.orcid ? `https://orcid.org/${r.creator.orcid}` : r.creator.url,
      "@type": "foaf:Agent",
      "foaf:name": r.creator.name,
    },
    "dcat:contactPoint": contactPoint(),
    "dcat:landingPage": page(r.url),
    ...(r.reference?.doi && { "dct:isReferencedBy": iri(`https://doi.org/${r.reference.doi}`) }),
    ...(!r.reference?.doi && r.reference?.url && { "dct:isReferencedBy": iri(r.reference.url) }),
    ...(r.reference?.citation && { "dct:bibliographicCitation": r.reference.citation }),
    "dcat:distribution": r.files.map((f) => {
      const ext = f.filename.split(".").pop()!.toLowerCase();
      return {
        "@id": f.url,
        "@type": "dcat:Distribution",
        "dct:title": f.title,
        "dcat:accessURL": iri(r.url),
        "dcat:downloadURL": iri(f.url),
        "dcat:mediaType": iri(`https://www.iana.org/assignments/media-types/${f.mediaType}`, "dct:MediaType"),
        ...(EU_FILE_TYPES[ext] && { "dct:format": iri(`${EU}/file-type/${EU_FILE_TYPES[ext]}`, "dct:MediaTypeOrExtent") }),
        "dct:license": iri(r.licence.eu ?? r.licence.url, "dct:LicenseDocument"),
        ...(f.bytes !== null && { "dcat:byteSize": literal(f.bytes, "xsd:nonNegativeInteger") }),
        ...(f.sha256 && {
          "spdx:checksum": {
            "@type": "spdx:Checksum",
            "spdx:algorithm": iri("spdx:checksumAlgorithm_sha256", "spdx:ChecksumAlgorithm"),
            "spdx:checksumValue": literal(f.sha256, "xsd:hexBinary"),
          },
        }),
      };
    }),
  };
}

export const dcatCatalog = (datasets: object[]) => ({
  "@id": `${SITE}/#catalog`,
  "@type": "dcat:Catalog",
  "dct:title": "EELS Data Base",
  "dct:description": CATALOG_DESCRIPTION,
  "dct:publisher": dcatPublisher(),
  "foaf:homepage": page(`${SITE}/`),
  "dct:license": iri(LICENCES[DEFAULT_LICENCE].eu, "dct:LicenseDocument"),
  "dct:language": ENGLISH,
  "dcat:themeTaxonomy": { ...iri(`${EU}/data-theme`, "skos:ConceptScheme"), "dct:title": "Data theme" },
  "dcat:contactPoint": contactPoint(),
  "dcat:dataset": datasets,
});
