import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { checkUpload, parseForm, slugify } from "../src/submit/form";
import { sessionFor } from "./helpers/session";

const MSA = `#FORMAT      : EMSA/MAS Spectral Data File
#NPOINTS     : 3
#DATATYPE    : XY
#SPECTRUM    : Spectral Data Starts Here
280.0, 100
280.1, 120
280.2, 150
#ENDOFDATA   :
`;

const fields = {
  title: "Test graphite",
  type: "coreloss",
  formula: "C",
  edges: "C_K",
  beam_energy_choice: "200",
  convergence: "21.5",
  collection_unknown: "1",
  microscope: "Titan",
  ref_doi: "https://doi.org/10.1017/S1431927616000179",
  agreement: "1",
};

function formData(values: Record<string, string>, file: File | null = new File([MSA], "graphite.msa")) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  if (file) fd.append("file", file);
  return fd;
}

const postSubmit = (cookie: string, fd: FormData) =>
  exports.default.fetch("https://eelsdb.eu/submit-data/", { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: "https://eelsdb.eu" }, body: fd });

describe("form parsing", () => {
  it("records where each acquisition value came from", () => {
    const { form, errors } = parseForm({ ...fields, convergence_approx: "1", convergence_uncertainty: "2", collection: "30", collection_unknown: "", collection_source: "profile" });
    expect(errors).toEqual({});
    expect(form.acquisition).toMatchObject({
      beam_energy_kv: 200, beam_energy_source: "user",
      convergence_mrad: 21.5, convergence_source: "estimate", convergence_uncertainty: 2,
      collection_mrad: 30, collection_source: "profile",
    });
    expect(form.elements).toEqual(["C"]);
    expect(form.reference.doi).toBe("10.1017/S1431927616000179");
  });

  it("treats unknown as a valid answer but requires an answer", () => {
    expect(parseForm({ ...fields, beam_energy_choice: "unknown" }).form.acquisition.beam_energy_source).toBe("unknown");
    const { errors } = parseForm({ ...fields, beam_energy_choice: "", convergence: "", convergence_approx: "1" });
    expect(Object.keys(errors).sort()).toEqual(["beam_energy", "convergence"]);
  });

  it("needs an uncertainty for approximate values", () => {
    expect(parseForm({ ...fields, convergence_approx: "1" }).errors).toHaveProperty("convergence_uncertainty");
  });

  it("validates edges, numbers and DOIs", () => {
    const { errors } = parseForm({ ...fields, edges: "C_K; Qq_K", resolution_ev: "-1", ref_doi: "nope" });
    expect(Object.keys(errors).sort()).toEqual(["edges", "ref_doi", "resolution_ev"]);
  });

  it("does not require angles for X-ray absorption", () => {
    expect(parseForm({ title: "x", type: "xrayabs", formula: "C" }).errors).toEqual({});
  });

  it.each([
    ["fe2o3", []],
    ["Zircaloy-4", []],
    ["Fe2O3 @ Xx#", ["Fe", "O"]],
    ["(La0.7,Sr0.3MnO3", ["La", "Sr", "Mn", "O"]],
  ])("accepts the odd formula %s and keeps only real elements", (formula, elements) => {
    const { form, errors } = parseForm({ ...fields, formula, elements: "" });
    expect(errors).toEqual({});
    expect(form.spectrum.formula).toBe(formula);
    expect(form.elements).toEqual(elements);
  });

  it("slugifies titles", () => {
    expect(slugify("α-MoO₃ (rutile) – 2 nm")).toBe("moo3-rutile-2-nm");
  });
});

describe("upload checks", () => {
  it("accepts real files and rejects empty or mislabelled ones", async () => {
    expect(await checkUpload(new File([MSA], "a.msa"), ["msa"], "File")).toBeNull();
    expect(await checkUpload(new File([""], "a.msa"), ["msa"], "File")).toMatch(/no file/);
    expect(await checkUpload(new File(["hello"], "a.exe"), ["msa"], "File")).toMatch(/not accepted/);
    expect(await checkUpload(new File(["no numbers here"], "a.txt"), ["txt"], "File")).toMatch(/rows of numbers/);
    expect(await checkUpload(new File(["not hdf5"], "a.hspy"), ["hspy"], "File")).toMatch(/HDF5/);
    expect(await checkUpload(new File([new Uint8Array([0, 0, 0, 4, 1])], "a.dm4"), ["dm4"], "File")).toBeNull();
  });
});

describe("submitting", () => {
  it("stores a pending spectrum, its files and the submission", async () => {
    const cookie = await sessionFor({ id: 6000001, display_name: "Sub Mitter" });
    const res = await postSubmit(cookie, formData({ ...fields, browser_checks: '{"findings":[]}' }));
    expect(res.status).toBe(302);
    const id = Number(new URL(res.headers.get("location")!, "https://x").searchParams.get("submitted"));
    const spectrum = await env.DB.prepare("SELECT * FROM spectra WHERE id = ?").bind(id).first<any>();
    expect(spectrum).toMatchObject({ slug: "test-graphite", status: "pending", owner_id: 6000001, author_slug: "sub-mitter", licence: "ODbL-1.0", completeness: "partial" });
    expect(id).toBeGreaterThan(22237);
    const file = await env.DB.prepare("SELECT * FROM files WHERE spectrum_id = ?").bind(id).first<any>();
    expect(await (await env.FILES.get(file.r2_key))!.text()).toBe(MSA);
    const checks = await env.DB.prepare("SELECT browser_checks_json FROM submissions WHERE spectrum_id = ?").bind(id).first<string>("browser_checks_json");
    expect(JSON.parse(checks!).findings).toEqual([]);
    expect(await env.DB.prepare("SELECT edge FROM spectrum_edges WHERE spectrum_id = ?").bind(id).first("edge")).toBe("K");

    // Pending spectra are not public.
    expect((await exports.default.fetch("https://eelsdb.eu/spectra/test-graphite/")).status).toBe(404);
    expect((await exports.default.fetch("https://api.eelsdb.eu/spectra/test-graphite/")).status).toBe(404);

    const list = await (await exports.default.fetch("https://eelsdb.eu/account/submissions/", { headers: { Cookie: cookie } })).text();
    expect(list).toContain("Test graphite");
    expect(list).toContain("Waiting for review");

    const again = await postSubmit(cookie, formData(fields));
    const second = Number(new URL(again.headers.get("location")!, "https://x").searchParams.get("submitted"));
    expect(await env.DB.prepare("SELECT slug FROM spectra WHERE id = ?").bind(second).first("slug")).toBe("test-graphite-2");
  });

  it("stores processed versions next to the spectrum", async () => {
    const cookie = await sessionFor({ id: 6000009, display_name: "Variant Web" });
    const fd = formData(fields);
    fd.append("variant_os_smoothed_file", new File([MSA], "os-smooth.msa"));
    const id = Number(new URL((await postSubmit(cookie, fd)).headers.get("location")!, "https://x").searchParams.get("submitted"));
    const { results } = await env.DB.prepare("SELECT role, variant, r2_key FROM files WHERE spectrum_id = ? ORDER BY id").bind(id).all<any>();
    expect(results.map((f) => [f.role, f.variant])).toEqual([["original", null], ["variant", "os_smoothed"]]);
    expect(results[1].r2_key).toBe(`submissions/${id}/variant-os_smoothed/os-smooth.msa`);
  });

  it("shows errors, keeps typed values and stores nothing", async () => {
    const cookie = await sessionFor({ id: 6000002, display_name: "Err Or" });
    const res = await postSubmit(cookie, formData({ ...fields, title: "", agreement: "" }, null));
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Enter the specimen name.");
    expect(html).toContain("Please agree to the licence");
    expect(html).toContain('value="Titan"');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE owner_id = 6000002").first("n")).toBe(0);
  });

  it("answers the stepped form's background posts with JSON", async () => {
    const cookie = await sessionFor({ id: 6000004, display_name: "Json Sender" });
    const post = (fd: FormData) =>
      exports.default.fetch("https://eelsdb.eu/submit-data/", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://eelsdb.eu", Accept: "application/json" },
        body: fd,
      });
    const bad = await post(formData({ ...fields, title: "" }));
    expect(bad.status).toBe(422);
    expect((await bad.json<any>()).errors.title).toBe("Enter the specimen name.");
    const good = await post(formData({ ...fields, title: "Json graphite" }));
    expect(good.status).toBe(200);
    expect((await good.json<any>()).redirect).toMatch(/^\/account\/submissions\/\?submitted=\d+$/);
  });

  it("limits submissions per day", async () => {
    const cookie = await sessionFor({ id: 6000003, display_name: "Busy Bee" });
    await env.DB.batch(
      Array.from({ length: 20 }, () =>
        env.DB.prepare("INSERT INTO submissions (spectrum_id, submitted_by, status) VALUES (22236, 6000003, 'rejected')"),
      ),
    );
    const res = await postSubmit(cookie, formData(fields));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("up to 20 spectra a day");
  });
});

describe("X-ray absorption", () => {
  const XDI = "# XDI/1.0\n# Column.1: energy eV\n# Column.2: mutrans\n# Facility.name: APS\n#----\n8779 1.0\n8789 1.1\n8799 1.3\n";

  it("accepts XDI files and stores the XAS fields", async () => {
    const cookie = await sessionFor({ id: 6000010, display_name: "Xas Person" });
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      title: "Cu foil", type: "xrayabs", formula: "Cu", edges: "Cu_K", intensity_units: "mu", agreement: "1",
      xas_facility: "APS", xas_beamline: "13ID", xas_monochromator: "Si 111", xas_detection_mode: "transmission", xas_resolving_power: "7000",
    })) fd.append(k, v);
    fd.append("file", new File([XDI], "cu.xdi"));
    const res = await postSubmit(cookie, fd);
    expect(res.status).toBe(302);
    const id = Number(new URL(res.headers.get("location")!, "https://x").searchParams.get("submitted"));
    expect(await env.DB.prepare("SELECT technique, intensity_units, completeness FROM spectra WHERE id = ?").bind(id).first()).toEqual({
      technique: "xas", intensity_units: "mu", completeness: null,
    });
    expect(await env.DB.prepare("SELECT facility, beamline, monochromator, resolving_power FROM xas_acquisition WHERE spectrum_id = ?").bind(id).first()).toEqual({
      facility: "APS", beamline: "13ID", monochromator: "Si 111", resolving_power: 7000,
    });
    const page = await (await exports.default.fetch("https://eelsdb.eu/spectra/cu-foil/", { headers: { Cookie: cookie } })).text();
    expect(page).toContain("Si 111");
  });

  it("rejects a file named .xdi that is not XDI", async () => {
    expect(await checkUpload(new File(["1 2\n3 4\n"], "a.xdi"), ["xdi"], "File")).toMatch(/not an XDI file/);
  });
});
