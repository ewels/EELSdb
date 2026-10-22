// API v2 request and response schemas. They validate requests, generate the OpenAPI file (/api/openapi-v2.json)
// and, in the tests, check every response, so the documentation cannot drift from the code.
import { createRoute, z } from "@hono/zod-openapi";
import { ELEMENTS } from "../elements";

export const MAX_PER_PAGE = 500;
export const SORTS = ["formula", "title", "published_at", "min_energy_ev", "max_energy_ev", "beam_energy_kv", "resolution_ev", "author", "id"] as const;
export const SOURCES = ["file", "companion", "profile", "user", "estimate", "unknown"] as const;

export const TYPES = ["coreloss", "lowloss", "zeroloss", "xrayabs"] as const;
const TECHNIQUES = ["eels", "xas"] as const;
const PHASES = ["solid", "liquid", "gas"] as const;
const INTENSITY_UNITS = ["counts", "oscillator_strength", "mu", "optical_density", "normalised"] as const;

// Hono gives a repeated query parameter as an array and a single one as a string.
// Query descriptions go on the parameter only: on the schema as well, the reference shows each one twice.
const repeated = (description: string, example: string, check?: (v: string) => boolean, message?: string) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => [v].flat())
    .refine((list) => !check || list.every(check), { message })
    .optional()
    .openapi({ example: [example], type: "array", items: { type: "string" }, param: { description, style: "form", explode: true } });

const number = (description: string, example?: number) => z.coerce.number().optional().openapi({ example, type: "number", param: { description } });

export const ListQuery = z
  .strictObject({
    type: repeated("Spectrum type. Repeat to include several.", "coreloss", (v) => (TYPES as readonly string[]).includes(v), `is not one of ${TYPES.join(", ")}`),
    technique: z.enum(TECHNIQUES).optional().openapi({ param: { description: "Measurement technique." } }),
    phase: z.enum(PHASES).optional().openapi({ param: { description: "Specimen phase. Gas-phase spectra are listed only when `phase=gas` is given." } }),
    element: repeated(
      "Element symbol. Repeat to require several: a spectrum must contain all of them.",
      "Fe",
      (v) => ELEMENTS.has(v),
      "is not an element symbol",
    ),
    edge: repeated("Edge, matched whole: `L2,3` (any element) or `Fe_L2,3`. Repeat to require several.", "Fe_L2,3"),
    formula: z.string().optional().openapi({ param: { description: "Text that the formula contains." }, example: "TiO2" }),
    q: z.string().optional().openapi({ param: { description: "Text in the title or description." }, example: "graphite" }),
    author: repeated("Part of the contributor's name, or their profile name. Repeat to include several contributors.", "Sigle"),
    keyword: repeated("A keyword the contributor gave, matched whole and ignoring case. Repeat to require several.", "nanotube"),
    complete: z.enum(["true"]).optional().openapi({ param: { description: "`true`: only spectra whose beam energy and both angles are known." } }),
    monochromated: z.enum(["true", "false"]).optional().openapi({ param: { description: "Monochromated or not." } }),
    min_energy_ev: number("Spectra that start at or above this energy (eV).", 400),
    max_energy_ev: number("Spectra that end at or below this energy (eV).", 900),
    covers_ev: number("Spectra whose energy range includes this energy (eV).", 708),
    beam_energy_kv: number("Beam energy (kV).", 200),
    max_resolution_ev: number("Spectra with this energy resolution or better (eV).", 0.5),
    sort: z.enum(SORTS).default("formula").openapi({ param: { description: "Sort key. Spectra with no value for it come last." } }),
    order: z.enum(["asc", "desc"]).default("asc").openapi({ param: { description: "Sort direction." } }),
    page: z.coerce.number().int().min(1).default(1).openapi({ param: { description: "Page number, from 1." }, type: "integer", default: 1 }),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .default(50)
      .transform((n) => Math.min(n, MAX_PER_PAGE))
      .openapi({ param: { description: `Spectra per page, at most ${MAX_PER_PAGE}. Larger values give ${MAX_PER_PAGE}.` }, type: "integer", default: 50 }),
  })
  .refine((q) => (q.element?.length ?? 0) + (q.edge?.length ?? 0) + (q.keyword?.length ?? 0) <= 20, { message: "Give at most 20 element, edge and keyword filters." });

const text = z.string().nullable();
const num = z.number().nullable();
const flag = z.boolean().nullable();

const measured = (unit: "kv" | "mrad", what: string) =>
  z
    .strictObject({
      [`value_${unit}`]: num,
      source: z.enum(SOURCES),
      [`uncertainty_${unit}`]: num.optional(),
    })
    .nullable()
    .openapi({
      description: `${what}, with where the value came from. \`value_${unit}\` is null when the source is \`unknown\`.`,
    });

export const Spectrum = z
  .strictObject({
    id: z.number().int().openapi({ description: "Numeric id. Spectra from the old site keep their WordPress id." }),
    slug: z.string().openapi({ description: "The name in the spectrum's web address." }),
    url: z.string().openapi({ description: "The spectrum page." }),
    api_url: z.string().openapi({ description: "This record in API v2." }),
    title: z.string().openapi({ description: "The specimen name." }),
    type: z.enum(TYPES),
    technique: z.enum(TECHNIQUES),
    phase: z.enum(PHASES),
    intensity_units: z.enum(INTENSITY_UNITS),
    formula: text.openapi({ description: "The formula as the contributor typed it." }),
    elements: z.array(z.string()),
    edges: z.array(z.strictObject({ element: z.string(), edge: z.string() })),
    keywords: z.array(z.string()),
    description: text,
    source_purity: text,
    licence: text.openapi({ description: "SPDX identifier, for example `ODbL-1.0`. Null for spectra migrated from the old site." }),
    completeness: z.enum(["full", "partial"]).nullable().openapi({ description: "`full` when the beam energy and both angles are known. Null for X-ray absorption." }),
    published_at: text,
    updated_at: text,
    author: z.strictObject({ name: text, profile_url: z.string() }),
    energy: z.strictObject({ min_ev: num, max_ev: num, step_ev: num }),
    acquisition: z
      .strictObject({
        microscope: text,
        gun_type: text,
        mode: text,
        detector: text,
        beam_energy: measured("kv", "Beam energy"),
        convergence_angle: measured("mrad", "Convergence semi-angle"),
        collection_angle: measured("mrad", "Collection semi-angle"),
        resolution_ev: num,
        monochromated: flag,
        dispersion_ev: num,
        probe_size_nm2: num,
        beam_current: text,
        integration_time_s: num,
        readouts: num,
        instrument_profile: z
          .strictObject({ id: z.number().int(), version: z.number().int().nullable(), url: z.string() })
          .nullable()
          .openapi({ description: "The instrument profile version that supplied angles." }),
      })
      .nullable()
      .openapi({ description: "EELS acquisition settings." }),
    xas: z
      .strictObject({
        facility: text,
        beamline: text,
        source_type: text,
        monochromator: text,
        resolving_power: num,
        detection_mode: text,
        polarisation: text,
        polarisation_angle_deg: num,
        calibration_reference: text,
        i0_normalisation: text,
      })
      .nullable()
      .openapi({ description: "X-ray absorption settings. Null for EELS spectra." }),
    treatment: z
      .strictObject({
        dark_current_corrected: flag,
        gain_variation_corrected: flag,
        calibration: text,
        thickness: z.strictObject({ value_t_lambda: num, source: text }).nullable(),
        deconvolutions: z.array(z.string()).openapi({ description: "For example `fourier_log`, `fourier_ratio`, `stephens`, `richardson_lucy` or `maximum_entropy`." }),
      })
      .nullable(),
    reference: z
      .strictObject({
        doi: text,
        doi_url: text,
        url: text,
        authors: text,
        title: text,
        journal: text,
        volume: text,
        issue: text,
        pages: text,
        year: z.number().int().nullable(),
        freetext: text.openapi({ description: "A reference with no structured fields." }),
      })
      .nullable(),
    associated: z
      .array(z.strictObject({ id: z.number().int(), title: z.string(), type: z.string(), api_url: z.string() }))
      .openapi({ description: "Related EELSdb spectra, for example the low-loss spectrum of the same specimen." }),
    links: z.array(z.strictObject({ url: z.string(), title: text })),
    files: z.array(
      z.strictObject({
        role: z.enum(["legacy", "original", "lowloss", "variant", "msa", "hspy", "metadata"]).openapi({
          description: "`variant` is a processed version from the contributor, named in `variant`; `metadata` is every tag read from the original file at review, as JSON, not checked by a person.",
        }),
        variant: z.enum(["os", "os_smoothed", "smoothed", "impurity_removed"]).nullable().openapi({ description: "For a `variant` file: oscillator strength, smoothed, or with an impurity (often air) removed." }),
        intensity_units: z.enum(INTENSITY_UNITS).nullable().openapi({ description: "For a `variant` file whose units differ from the spectrum's." }),
        url: z.string(),
        filename: z.string(),
        bytes: z.number().int().nullable(),
        sha256: text,
        media_type: text,
      }),
    ),
    download_url: text.openapi({ description: "The main data file: the old upload, else the reviewed MSA, else the submitted file." }),
    processing: z
      .array(z.strictObject({ tool: z.string(), version: text, run_at: text }))
      .openapi({ description: "The tools and versions the moderator used at review." }),
  })
  .openapi("Spectrum");

export const SpectrumPage = z
  .strictObject({
    total: z.number().int().openapi({ description: "Spectra that match the filters, on all pages." }),
    page: z.number().int(),
    per_page: z.number().int(),
    next: text.openapi({ description: "The next page, or null on the last page." }),
    previous: text.openapi({ description: "The previous page, or null on the first page." }),
    results: z.array(Spectrum),
  })
  .openapi("SpectrumPage");

export const ApiError = z
  .strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) })
  .openapi("Error", { example: { error: { code: "unknown_parameter", message: "Unknown query parameter 'colour'." } } });

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } });

export const listRoute = createRoute({
  method: "get",
  path: "/spectra",
  operationId: "listSpectra",
  summary: "List spectra",
  description:
    "Published spectra that match all the given filters, with a total count and links to the next and previous pages. An unknown query parameter returns 400.",
  request: { query: ListQuery },
  responses: { 200: json(SpectrumPage, "A page of spectra."), 400: json(ApiError, "Unknown or invalid parameter.") },
});

export const oneRoute = createRoute({
  method: "get",
  path: "/spectra/{id}",
  operationId: "getSpectrum",
  summary: "Get one spectrum",
  description: "One published spectrum, by numeric id or by slug.",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" }, description: "Numeric id, or the slug from the spectrum's web address.", example: "21751" }),
    }),
  },
  responses: { 200: json(Spectrum, "A spectrum."), 404: json(ApiError, "No published spectrum with this id or slug.") },
});

const field = (description: string, example?: string) => z.string().optional().openapi({ description, example });
const measuredField = (what: string, unit: string, example: string) =>
  field(`${what} in ${unit}. Leave it out when it is not known: the draft then records it as unknown. Never guess.`, example);

// Every field is optional here: the handler checks the token first, then the fields, and names each problem.
export const DraftForm = z
  .looseObject({
    file: z.custom<File>((v) => v instanceof File).optional().openapi({ type: "string", format: "binary", description: "Required. The spectrum file: .msa, .dm3, .dm4, .emd, .hspy, .txt, .csv or .xdi." }),
    title: field("The specimen name. Default: the file name.", "Hematite"),
    type: z.enum(TYPES).optional().openapi({ description: "Required. Spectrum type." }),
    formula: field("Required. Chemical formula.", "Fe2O3"),
    elements: field("Element symbols, separated by commas. Default: from the formula.", "Fe, O"),
    edges: field("Edges, separated by semicolons.", "Fe_L2,3; O_K"),
    beam_energy: measuredField("Beam energy", "kV", "200"),
    convergence: measuredField("Convergence semi-angle", "mrad", "10"),
    collection: measuredField("Collection semi-angle", "mrad", "16"),
    beam_energy_source: z.enum(["file", "user"]).optional().openapi({
      description: "Where the value came from: `file` if read from the file's header, `user` if the person gave it. The same field exists for `convergence` and `collection`.",
    }),
    ref_doi: field("DOI of the paper the spectrum comes from.", "10.1016/j.jssc.2009.07.037"),
    description: field("Free text: how the specimen was prepared and measured."),
    lowloss_file: z.custom<File>((v) => v instanceof File).optional().openapi({ type: "string", format: "binary", description: "A low-loss spectrum of the same area." }),
  })
  .openapi("DraftForm", {
    description:
      "The fields of the submit form, under the same names: see the field reference at https://eelsdb.eu/docs/reference/fields/. Any form field not listed here is accepted too.",
  });

export const Draft = z
  .strictObject({
    id: z.number().int(),
    slug: z.string(),
    status: z.literal("draft"),
    review_url: z.string().openapi({ description: "Where the owner checks the draft and submits it for review." }),
  })
  .openapi("Draft");

export const DraftError = z
  .strictObject({
    error: z.strictObject({
      code: z.string(),
      message: z.string(),
      fields: z.record(z.string(), z.string()).optional().openapi({ description: "A message for each field with a problem." }),
    }),
  })
  .openapi("DraftError");

export const draftRoute = createRoute({
  method: "post",
  path: "/drafts",
  operationId: "createDraft",
  summary: "Create a draft",
  description:
    "Saves a spectrum as a draft in the token owner's account. A draft is not public and is not reviewed: the owner checks it on the website and submits it. Drafts that are not submitted are deleted after 30 days. Needs an API token from https://eelsdb.eu/account/settings/tokens/. At most 200 drafts an hour.",
  security: [{ apiToken: [] }],
  request: { body: { content: { "multipart/form-data": { schema: DraftForm } }, required: true } },
  responses: {
    201: json(Draft, "The draft was saved."),
    400: json(DraftError, "The draft has errors; nothing was saved."),
    401: json(DraftError, "No valid API token."),
    429: json(DraftError, "Too many drafts in the last hour."),
  },
});

export const DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "EELS Data Base API v2",
    version: "2",
    description:
      "JSON API with typed values. It is read-only, except that a contributor's assistant can create drafts (`POST /drafts`) for the contributor to check and submit on the website. Values are typed: numbers are numbers, units are in the field names, and acquisition values say where they came from. No key is needed to read. Responses have `Access-Control-Allow-Origin: *`. Errors return `{\"error\": {\"code\", \"message\"}}`. Field names follow HyperSpy's metadata where they can (beam energy in kV, angles in mrad).",
  },
  servers: [{ url: "https://api.eelsdb.eu/v2" }],
};
