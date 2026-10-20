// Submit form: checks the file in the browser with Pyodide (RosettaSciIO + eelsdb.checks), pre-fills
// acquisition values found in the files, looks up DOIs on CrossRef, and applies instrument profiles.
// Everything here is optional: the form submits without it, and moderators re-check every file.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const RSCIIO = "rosettasciio==0.15.0";
const TIMEOUT_MS = 90_000;

const $ = (sel) => document.querySelector(sel);
const form = $("#submit-form");
const checksBox = $("#checks");
const statusEl = checksBox.querySelector(".checks-status");
const findingsEl = checksBox.querySelector(".findings");
// Not form.elements: the form has a field called "elements", which shadows it.
const field = (name) => form.querySelector(`[name="${name}"]`);

const SOURCE_TEXT = {
  file: "From the spectrum file. Please check it is right: DigitalMicrograph often keeps old values.",
  companion: "From the companion file. Please check it is right.",
  profile: "From the instrument profile.",
  user: "Where it came from: you.",
};

function setProvenance(name, source) {
  field(`${name}_source`).value = source;
  const note = form.querySelector(`[data-provenance="${name}"]`);
  note.textContent = SOURCE_TEXT[source] ?? SOURCE_TEXT.user;
  note.classList.toggle("from-file", source !== "user");
}

// Typing over a pre-filled value makes it the submitter's own.
for (const name of ["beam_energy", "convergence", "collection"]) {
  form.querySelector(`[data-measured="${name}"]`).addEventListener("input", (e) => {
    if (!e.target.name?.endsWith("_uncertainty")) setProvenance(name, "user");
  });
}

/** Fill a measured value only if the submitter has not given one. */
function prefill(name, value, source) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return false;
  if (name === "beam_energy") {
    const chosen = form.querySelector('input[name="beam_energy_choice"]:checked');
    if (chosen && chosen.value !== "other") return false;
    if (chosen && field("beam_energy").value) return false;
    const preset = form.querySelector(`input[name="beam_energy_choice"][value="${Math.round(value)}"]`);
    if (preset && Math.abs(value - Math.round(value)) < 0.01) preset.checked = true;
    else {
      form.querySelector('input[name="beam_energy_choice"][value="other"]').checked = true;
      field("beam_energy").value = +value.toFixed(3);
    }
  } else {
    if (field(name).value || field(`${name}_unknown`).checked) return false;
    field(name).value = +value.toFixed(3);
  }
  setProvenance(name, source);
  return true;
}

const fillIfEmpty = (name, value) => {
  if (value !== null && value !== undefined && field(name) && !field(name).value) field(name).value = value;
};

// Elements from the formula, until the submitter edits them.
let elementsTouched = !!field("elements").value;
field("elements").addEventListener("input", () => (elementsTouched = true));
field("formula").addEventListener("input", () => {
  if (elementsTouched) return;
  const symbols = [...new Set(field("formula").value.match(/[A-Z][a-z]?/g) ?? [])];
  field("elements").value = symbols.join(", ");
});

// The X-ray absorption section only applies to that type.
const xasSection = form.querySelector('[data-show-for="xrayabs"]');
field("type").addEventListener("change", () => (xasSection.hidden = field("type").value !== "xrayabs"));

// Beam energy "Other" box only matters when "Other" is chosen.
const beamOther = form.querySelector(".beam-other");
const syncBeam = () => {
  const v = form.querySelector('input[name="beam_energy_choice"]:checked')?.value;
  beamOther.hidden = v !== "other" && !field("beam_energy").value;
};
form.addEventListener("change", (e) => e.target.name === "beam_energy_choice" && syncBeam());
syncBeam();

// DOI lookup on CrossRef (it allows browser requests).
$("#doi-lookup").addEventListener("click", async () => {
  const status = $("#doi-status");
  const doi = field("ref_doi").value.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, "");
  if (!doi) return (status.textContent = "Enter a DOI first.");
  status.textContent = "Looking up…";
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!res.ok) throw new Error(res.status === 404 ? "CrossRef does not know this DOI." : `CrossRef answered ${res.status}.`);
    const w = (await res.json()).message;
    const set = (name, value) => value && (field(name).value = value);
    set("ref_title", (w.title?.[0] ?? "").replace(/<[^>]+>/g, ""));
    set("ref_authors", (w.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(" ") || a.name).join(", "));
    set("ref_journal", w["container-title"]?.[0]);
    set("ref_volume", w.volume);
    set("ref_issue", w.issue);
    set("ref_page", w.page);
    set("ref_year", String((w.issued ?? w.published)?.["date-parts"]?.[0]?.[0] ?? ""));
    field("ref_doi").value = doi;
    status.textContent = "Filled from CrossRef. Please check.";
  } catch (e) {
    status.textContent = `${e.message} You can type the reference in.`;
  }
});

// Instrument profiles: the name, and the calibrated angles as one-click choices.
const instrument = field("instrument");
if (instrument) {
  const helper = document.createElement("div");
  helper.className = "hint";
  instrument.closest(".field").append(helper);
  instrument.addEventListener("change", () => {
    helper.replaceChildren();
    const opt = instrument.selectedOptions[0];
    if (!opt?.value) return;
    fillIfEmpty("microscope", opt.dataset.name);
    const calibrations = JSON.parse(opt.dataset.calibrations || "[]").filter((k) => k.value != null);
    if (!calibrations.length) return;
    helper.append("Calibrated angles: ");
    for (const k of calibrations) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      const settings = Object.entries(k.settings ?? {}).map(([key, val]) => `${key} ${val}`).join(", ");
      b.textContent = `${k.kind} ${k.value} mrad${settings ? ` (${settings})` : ""}`;
      b.addEventListener("click", () => {
        field(k.kind).value = k.value;
        field(`${k.kind}_unknown`).checked = false;
        if (k.uncertainty) field(`${k.kind}_uncertainty`).value = k.uncertainty;
        setProvenance(k.kind, "profile");
      });
      helper.append(b, " ");
    }
  });
}

// ---- Browser checks with Pyodide -------------------------------------------------------------

const READ_PY = `
import json, numpy as np
from eelsdb import checks
from eelsdb.io import read_any

def clean(v):
    try:
        v = float(v)
        return v if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None

def run(path, kind, formula, elements, edges, thickness, table_json):
    elements, edges = list(elements.to_py()), list(edges.to_py())
    sp = read_any(path)
    keys = ("beam_energy_kv", "convergence_mrad", "collection_mrad", "exposure_s", "frames")
    out = {"meta": {k: clean(sp.header.get(k)) for k in keys}, "xas": sp.header.get("xas") or {}}
    if sp.energy is None:
        return json.dumps(out)
    energy, intensity = sp.energy, sp.intensity
    findings = checks.run_all(energy, intensity, spectrum_type=kind or None, formula=formula or None,
                              elements=elements, edges=edges, edge_table=json.loads(table_json), thickness=thickness,
                              header_axis=sp.header_axis)
    step = max(1, energy.size // 2000)
    out.update({
        "points": int(energy.size),
        "energy_min": float(energy.min()), "energy_max": float(energy.max()),
        "dispersion": float((energy[-1] - energy[0]) / (energy.size - 1)) if energy.size > 1 else None,
        "findings": [f.as_dict() for f in findings],
        "x": energy[::step].tolist(), "y": np.nan_to_num(intensity[::step]).tolist(),
    })
    return json.dumps(out)
`;

let pyodidePromise;
function pyodideReady() {
  pyodidePromise ??= (async () => {
    const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: PYODIDE });
    await py.loadPackage(["numpy", "micropip", "h5py"]);
    await py.pyimport("micropip").install(RSCIIO);
    py.FS.mkdirTree("/home/pyodide/eelsdb");
    py.FS.writeFile("/home/pyodide/eelsdb/__init__.py", "");
    for (const f of ["checks.py", "io.py", "_elements.py"]) {
      py.FS.writeFile(`/home/pyodide/eelsdb/${f}`, await (await fetch(`/py/eelsdb/${f}`)).text());
    }
    const table = await (await fetch("/eels_binding_energies.json")).json();
    py.globals.set("TABLE_JSON", JSON.stringify(table.elements));
    await py.runPythonAsync(READ_PY);
    return py;
  })();
  return pyodidePromise;
}

const withTimeout = (p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);

// Start loading early, in idle time, so checks are ready by the time a file is chosen.
(window.requestIdleCallback ?? setTimeout)(() => pyodideReady().catch(() => {}));

let plot;
async function check(input, role) {
  const file = input.files?.[0];
  if (!file) return;
  if (role === "original") {
    checksBox.hidden = false;
    findingsEl.replaceChildren();
    statusEl.textContent = "Reading your file in the browser…";
  }
  let result;
  try {
    const py = await withTimeout(pyodideReady());
    const path = `/tmp/${role}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    py.FS.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    const edges = field("edges").value.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
    const elements = field("elements").value.split(/[\s,;]+/).filter(Boolean);
    const thickness = parseFloat(field("thickness_t_lambda").value) || null;
    const run = py.globals.get("run");
    result = JSON.parse(run(path, role === "lowloss" ? "lowloss" : field("type").value, field("formula").value, elements, edges, thickness, py.globals.get("TABLE_JSON")));
    run.destroy();
  } catch (e) {
    if (role === "original") {
      statusEl.textContent =
        e.message === "timeout"
          ? "Checking in the browser is taking too long. You can still submit: the moderators check every file."
          : `Your browser could not read this file (${String(e.message).split("\n").filter(Boolean).pop()}). You can still submit: the moderators check every file.`;
      field("browser_checks").value = JSON.stringify({ error: String(e.message).slice(0, 500) });
    }
    return;
  }

  const source = role === "companion" ? "companion" : "file";
  const filled = [
    prefill("beam_energy", result.meta.beam_energy_kv, source) && "beam energy",
    prefill("convergence", result.meta.convergence_mrad, source) && "convergence angle",
    prefill("collection", result.meta.collection_mrad, source) && "collection angle",
  ].filter(Boolean);
  if (role === "original" && Object.keys(result.xas ?? {}).length) {
    const x = result.xas;
    if (!field("type").value) {
      field("type").value = "xrayabs";
      xasSection.hidden = false;
    }
    for (const k of ["facility", "beamline", "source_type", "monochromator"]) fillIfEmpty(`xas_${k}`, x[k]);
    fillIfEmpty("formula", x.formula);
    if (x.element && x.edge) fillIfEmpty("edges", `${x.element}_${x.edge}`);
    if (x.intensity_column?.startsWith("mu")) field("intensity_units").value = "mu";
  }
  if (role === "original") {
    fillIfEmpty("integration_time_s", result.meta.exposure_s);
    fillIfEmpty("readouts", result.meta.frames);
    if (result.dispersion) fillIfEmpty("dispersion_ev", +result.dispersion.toFixed(5));
  }
  if (role === "lowloss") {
    const t = result.findings?.find((f) => f.code === "thickness_estimate");
    if (t) statusEl.textContent += ` Low-loss: ${t.message}`;
    return;
  }
  if (role === "companion") {
    if (filled.length) statusEl.textContent += ` Filled ${filled.join(", ")} from the companion file.`;
    return;
  }

  field("browser_checks").value = JSON.stringify({ rsciio: RSCIIO, ...result, x: undefined, y: undefined });
  if (result.points === undefined) {
    statusEl.textContent = "Read the file, but found no energy-loss axis in it. Is it a spectrum?";
    return;
  }
  statusEl.textContent =
    `Read ${result.points} points from ${result.energy_min.toFixed(1)} to ${result.energy_max.toFixed(1)} eV.` +
    (filled.length ? ` Filled ${filled.join(", ")} from the file: please check.` : "");
  const order = { error: 0, warning: 1, info: 2 };
  for (const f of (result.findings ?? []).sort((a, b) => order[a.severity] - order[b.severity])) {
    const li = document.createElement("li");
    li.className = f.severity;
    li.textContent = f.message;
    findingsEl.append(li);
  }
  if (!result.findings?.length) findingsEl.innerHTML = "<li class=info>No problems found.</li>";

  const el = $("#preview");
  plot?.destroy();
  const probe = Object.assign(document.createElement("span"), { hidden: true });
  document.body.append(probe);
  const css = (n) => {
    probe.style.color = `var(${n})`;
    return getComputedStyle(probe).color;
  };
  const axis = { stroke: css("--muted"), grid: { stroke: css("--line") }, ticks: { stroke: css("--line") } };
  plot = new uPlot(
    {
      width: el.clientWidth,
      height: 220,
      scales: { x: { time: false } },
      axes: [{ ...axis, label: "Energy (eV)" }, { ...axis, size: 60 }],
      series: [{}, { stroke: css("--plot"), width: 1.25, points: { show: false } }],
      legend: { show: false },
    },
    [result.x, result.y],
    el,
  );
}

field("file").addEventListener("change", (e) => check(e.target, "original"));
field("lowloss_file").addEventListener("change", (e) => check(e.target, "lowloss"));
field("companion_file").addEventListener("change", (e) => check(e.target, "companion"));
