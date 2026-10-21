// Parses and validates the submit/edit form into typed rows.
import { ELEMENTS } from "../elements";

export const SOURCES = ["file", "companion", "profile", "user", "estimate", "unknown"] as const;
export const BEAM_ENERGIES = [60, 80, 120, 200, 300];
export const SPECTRUM_EXTENSIONS = ["dm3", "dm4", "msa", "emsa", "emd", "hspy", "txt", "csv", "xdi"];
export const INTENSITY_UNITS = ["counts", "oscillator_strength", "mu", "optical_density", "normalised"];
export const UNIT_LABELS: Record<string, string> = {
  counts: "Counts",
  oscillator_strength: "Oscillator strength",
  mu: "Absorption coefficient (μ)",
  optical_density: "Optical density",
  normalised: "Normalised",
};
export const XAS_FIELDS = ["facility", "beamline", "source_type", "monochromator", "resolving_power", "detection_mode", "polarisation", "polarisation_angle_deg", "calibration_reference", "i0_normalisation"];
export const COMPANION_EXTENSIONS = ["emd", "ser", "emi", "dm3", "dm4"];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Processed versions a contributor may upload next to the spectrum, each as its own file. */
export const VARIANTS: Record<string, string> = {
  os: "Oscillator strength",
  os_smoothed: "Oscillator strength, smoothed",
  smoothed: "Smoothed",
  impurity_removed: "Impurity removed",
};
export const variantUnits = (variant: string) => (variant.startsWith("os") ? "oscillator_strength" : null);
const MAX_ASSOCIATED = 20;

/** The browser's check results, kept only if they have the expected shape (moderators' pages read them). */
export function cleanBrowserChecks(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 200_000) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const findings = Array.isArray(v.findings)
      ? v.findings
          .filter((f: any) => f && typeof f.message === "string" && ["error", "warning", "info"].includes(f.severity))
          .slice(0, 200)
          .map((f: any) => ({ code: String(f.code ?? ""), severity: f.severity, message: f.message.slice(0, 500) }))
      : [];
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return JSON.stringify({
      error: typeof v.error === "string" ? v.error.slice(0, 500) : undefined,
      points: n(v.points),
      energy_min: n(v.energy_min),
      energy_max: n(v.energy_max),
      meta: v.meta && typeof v.meta === "object" ? Object.fromEntries(Object.entries(v.meta).map(([k, x]) => [k, n(x)]).slice(0, 20)) : undefined,
      findings,
      tool: typeof v.rsciio === "string" ? v.rsciio.slice(0, 50) : v.cli === true ? "eelsdb CLI" : undefined,
    });
  } catch {
    return null;
  }
}

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
    intensity_units: string;
  };
  elements: string[];
  edges: { element: string; edge: string }[];
  keywords: string[];
  otherUrls: { url: string; title: string | null }[];
  associated: string[];
  acquisition: Record<string, unknown>;
  xas: Record<string, unknown> | null;
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
  const associated = [
    ...new Set(
      (text(body, "associated", 4000) ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((u) => u.replace(/^https?:\/\/[^/]+\/spectra\//, "").replace(/\/$/, ""))
        .map((u) => {
          try {
            return decodeURIComponent(u);
          } catch {
            return u;
          }
        }),
    ),
  ];
  if (associated.length > MAX_ASSOCIATED) errors.associated = `Link at most ${MAX_ASSOCIATED} associated spectra.`;

  const refUrl = text(body, "ref_url", 500);
  if (refUrl && !/^https?:\/\/\S+$/.test(refUrl)) errors.ref_url = "The web link must start with http:// or https://.";

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
        intensity_units: INTENSITY_UNITS.includes(text(body, "intensity_units") ?? "") ? text(body, "intensity_units")! : "counts",
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
      xas: xas
        ? {
            facility: text(body, "xas_facility", 200),
            beamline: text(body, "xas_beamline", 200) ?? text(body, "microscope", 200),
            source_type: text(body, "xas_source_type", 200),
            monochromator: text(body, "xas_monochromator", 200),
            resolving_power: num("xas_resolving_power", 0, 1e7, "Resolving power"),
            detection_mode: text(body, "xas_detection_mode", 100),
            polarisation: text(body, "xas_polarisation", 100),
            polarisation_angle_deg: num("xas_polarisation_angle_deg", -360, 360, "Polarisation angle"),
            calibration_reference: text(body, "xas_calibration_reference", 300),
            i0_normalisation: text(body, "xas_i0_normalisation", 300),
          }
        : null,
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
        url: refUrl && /^https?:\/\//.test(refUrl) ? refUrl : null,
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
/** The variant files in a submission (form fields `variant_<code>_file`), checked like the spectrum file. */
export async function variantUploads(body: Record<string, unknown>, errors: Record<string, string>) {
  const out: [string, File][] = [];
  for (const [code, label] of Object.entries(VARIANTS)) {
    const f = body[`variant_${code}_file`];
    if (!(f instanceof File) || !f.size) continue;
    const e = await checkUpload(f, SPECTRUM_EXTENSIONS, `${label} file`);
    if (e) errors[`variant_${code}_file`] = e;
    else out.push([code, f]);
  }
  return out;
}

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
  if (ext === "xdi" && !new TextDecoder().decode(head.slice(0, 16)).startsWith("# XDI/")) {
    return `${label}: this is not an XDI file (it should start with "# XDI/").`;
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
