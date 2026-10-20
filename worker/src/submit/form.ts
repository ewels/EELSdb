// Parses and validates the submit/edit form into typed rows.
import { ELEMENTS } from "../elements";

export const SOURCES = ["file", "companion", "profile", "user", "estimate", "unknown"] as const;
export const BEAM_ENERGIES = [60, 80, 120, 200, 300];
export const SPECTRUM_EXTENSIONS = ["dm3", "dm4", "msa", "emsa", "emd", "hspy", "txt", "csv"];
export const COMPANION_EXTENSIONS = ["emd", "ser", "emi", "dm3", "dm4"];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

type Body = Record<string, string | File | (string | File)[]>;
export type Measured = { value: number | null; source: string; uncertainty: number | null };

export type ParsedForm = {
  spectrum: {
    title: string;
    type: string;
    formula: string | null;
    source_purity: string | null;
    description: string | null;
    phase: string;
  };
  elements: string[];
  edges: { element: string; edge: string }[];
  keywords: string[];
  otherUrls: { url: string; title: string | null }[];
  associated: string[];
  acquisition: Record<string, unknown>;
  treatment: Record<string, unknown>;
  reference: Record<string, string | null>;
  instrument: { id: number; version: number } | null;
};

const TYPES = ["coreloss", "lowloss", "zeroloss", "xrayabs"];
const EDGE = /^([A-Z][a-z]?)[_ ]((?:K|L1|L2,3|L2|L3|M1|M2,3|M4,5|M|N2,3|N4,5|N6,7|O2,3|O4,5))$/;

const text = (body: Body, key: string, max = 2000): string | null => {
  const v = body[key];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

export const formulaElements = (formula: string | null) => [...new Set((formula ?? "").match(/[A-Z][a-z]?/g) ?? [])].filter((e) => ELEMENTS.has(e));

export function parseForm(body: Body): { form: ParsedForm; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const num = (key: string, min: number, max: number, label: string): number | null => {
    const raw = text(body, key);
    if (raw === null) return null;
    const v = Number(raw.replace(",", "."));
    if (!Number.isFinite(v) || v < min || v > max) {
      errors[key] = `${label} must be a number from ${min} to ${max}.`;
      return null;
    }
    return v;
  };

  /** A value with where it came from. "unknown" is a valid answer; "approximate" needs an uncertainty. */
  const measured = (key: string, min: number, max: number, label: string, required: boolean): Measured => {
    const choice = text(body, `${key}_choice`);
    if (choice === "unknown" || text(body, `${key}_unknown`)) return { value: null, source: "unknown", uncertainty: null };
    const value = choice && choice !== "other" ? num(`${key}_choice`, min, max, label) : num(key, min, max, label);
    if (value === null) {
      if (required && !errors[key]) errors[key] = `Enter the ${label.toLowerCase()}, or mark it as unknown.`;
      return { value: null, source: "unknown", uncertainty: null };
    }
    const approximate = !!text(body, `${key}_approx`);
    const claimed = text(body, `${key}_source`);
    const source = approximate ? "estimate" : SOURCES.includes(claimed as any) && claimed !== "unknown" ? claimed! : "user";
    const uncertainty = num(`${key}_uncertainty`, 0, max, `${label} uncertainty`);
    if (approximate && uncertainty === null && !errors[`${key}_uncertainty`]) {
      errors[`${key}_uncertainty`] = `Give an uncertainty for the approximate ${label.toLowerCase()}.`;
    }
    return { value, source, uncertainty };
  };

  const title = text(body, "title", 200);
  if (!title) errors.title = "Enter the specimen name.";
  const type = text(body, "type");
  if (!type || !TYPES.includes(type)) errors.type = "Choose the spectrum type.";
  const formula = text(body, "formula", 200);
  if (!formula) errors.formula = "Enter the chemical formula.";

  const elementsRaw = text(body, "elements");
  const elements = elementsRaw ? [...new Set(elementsRaw.split(/[\s,;]+/).filter(Boolean))] : formulaElements(formula);
  const badElements = elements.filter((e) => !ELEMENTS.has(e));
  if (badElements.length) errors.elements = `Not element symbols: ${badElements.join(", ")}.`;

  const edges: ParsedForm["edges"] = [];
  for (const raw of (text(body, "edges") ?? "").split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(EDGE);
    if (!m || !ELEMENTS.has(m[1])) errors.edges = `Edges look like "Fe_L2,3" or "O K", separated by semicolons. "${raw}" does not.`;
    else edges.push({ element: m[1], edge: m[2] });
  }

  const xas = type === "xrayabs";
  const beam = measured("beam_energy", 0.1, 3000, "Beam energy", !xas);
  const convergence = measured("convergence", 0, 1000, "Convergence semi-angle", !xas);
  const collection = measured("collection", 0, 1000, "Collection semi-angle", !xas);

  const otherUrls: ParsedForm["otherUrls"] = [];
  for (const line of (text(body, "other_urls", 4000) ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [url, ...title] = line.split(/\s+/);
    if (!/^https?:\/\/\S+$/.test(url)) errors.other_urls = `"${url}" is not a web address (http:// or https://).`;
    else otherUrls.push({ url, title: title.join(" ") || null });
  }
  const associated = (text(body, "associated", 4000) ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((u) => u.replace(/^https?:\/\/[^/]+\/spectra\//, "").replace(/\/$/, ""));

  const doi = text(body, "ref_doi", 200)?.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, "") ?? null;
  if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) errors.ref_doi = "A DOI looks like 10.1234/abcd.";

  const instrumentRaw = text(body, "instrument");
  const [iid, iversion] = (instrumentRaw ?? "").split(":").map(Number);

  const deconv = (key: string) => (text(body, key) ? 1 : null);
  const yesNo = (key: string) => {
    const v = text(body, key);
    return v === "1" ? 1 : v === "0" ? 0 : null;
  };

  return {
    errors,
    form: {
      spectrum: {
        title: title ?? "",
        type: type ?? "",
        formula,
        source_purity: text(body, "source_purity", 500),
        description: text(body, "description", 5000),
        phase: ["solid", "liquid", "gas"].includes(text(body, "phase") ?? "") ? text(body, "phase")! : "solid",
      },
      elements,
      edges,
      keywords: [...new Set((text(body, "keywords", 500) ?? "").split(",").map((k) => k.trim()).filter(Boolean))],
      otherUrls,
      associated,
      acquisition: {
        microscope: text(body, "microscope", 200),
        gun_type: text(body, "gun_type", 100),
        acquisition_mode: text(body, "acquisition_mode", 100),
        detector: text(body, "detector", 200),
        beam_energy_kv: beam.value,
        beam_energy_source: beam.source,
        beam_energy_uncertainty: beam.uncertainty,
        convergence_mrad: convergence.value,
        convergence_source: convergence.source,
        convergence_uncertainty: convergence.uncertainty,
        collection_mrad: collection.value,
        collection_source: collection.source,
        collection_uncertainty: collection.uncertainty,
        resolution_ev: num("resolution_ev", 0, 100, "Resolution"),
        monochromated: yesNo("monochromated"),
        probe_size_nm2: num("probe_size_nm2", 0, 1e9, "Probe size"),
        beam_current: text(body, "beam_current", 50),
        integration_time_s: num("integration_time_s", 0, 1e6, "Integration time"),
        readouts: num("readouts", 0, 1e9, "Number of readouts"),
        dispersion_ev: num("dispersion_ev", 0, 100, "Dispersion"),
        instrument_profile_id: iid || null,
        instrument_profile_version: iid ? iversion || null : null,
      },
      treatment: {
        dark_current: yesNo("dark_current"),
        gain_variation: yesNo("gain_variation"),
        calibration: text(body, "calibration", 200),
        thickness_t_lambda: num("thickness_t_lambda", 0, 20, "Thickness"),
        thickness_source: text(body, "thickness_t_lambda") ? "user" : null,
        deconv_fourier_log: deconv("deconv_fourier_log"),
        deconv_fourier_ratio: deconv("deconv_fourier_ratio"),
        deconv_stephens: deconv("deconv_stephens"),
        deconv_richardson_lucy: deconv("deconv_richardson_lucy"),
        deconv_maximum_entropy: deconv("deconv_maximum_entropy"),
        deconv_other: text(body, "deconv_other", 200),
      },
      reference: {
        doi,
        url: text(body, "ref_url", 500),
        authors: text(body, "ref_authors", 2000),
        journal: text(body, "ref_journal", 300),
        volume: text(body, "ref_volume", 50),
        issue: text(body, "ref_issue", 50),
        page: text(body, "ref_page", 50),
        year: text(body, "ref_year", 4),
        title: text(body, "ref_title", 1000),
        freetext: text(body, "ref_freetext", 2000),
      },
      instrument: iid ? { id: iid, version: iversion || 1 } : null,
    },
  };
}

/** "full" when beam energy and both angles are known (any source but unknown); not used for XAS. */
export function completeness(type: string, a: Record<string, unknown>) {
  if (type === "xrayabs") return null;
  return a.beam_energy_kv != null && a.convergence_mrad != null && a.collection_mrad != null ? "full" : "partial";
}

export function slugify(title: string) {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s || "spectrum";
}

/** Cheap checks on an uploaded file; the real reading happens in the browser and at review. */
export async function checkUpload(file: File | null, allowed: string[], label: string): Promise<string | null> {
  if (!file || !file.size) return `${label}: no file was uploaded.`;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowed.includes(ext)) return `${label}: .${ext} files are not accepted (use ${allowed.map((e) => `.${e}`).join(", ")}).`;
  if (file.size > MAX_FILE_BYTES) return `${label}: the file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (["msa", "emsa", "txt", "csv"].includes(ext)) {
    const sample = new TextDecoder("latin1").decode(head);
    if (!/^\s*[-+]?\d*\.?\d+([eE][-+]?\d+)?[\s,;]+[-+]?\d*\.?\d+/m.test(sample)) {
      return `${label}: no rows of numbers found at the start of the file.`;
    }
  }
  if (ext === "hspy" || ext === "emd") {
    const hdf5 = [0x89, 0x48, 0x44, 0x46];
    if (!hdf5.every((b, i) => head[i] === b)) return `${label}: this is not an HDF5 file.`;
  }
  if (ext === "dm3" && !(head[0] === 0 && head[1] === 0 && head[2] === 0 && head[3] === 3)) {
    return `${label}: this is not a DigitalMicrograph 3 file.`;
  }
  if (ext === "dm4" && !(head[0] === 0 && head[1] === 0 && head[2] === 0 && head[3] === 4)) {
    return `${label}: this is not a DigitalMicrograph 4 file.`;
  }
  return null;
}
