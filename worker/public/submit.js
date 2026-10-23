// Submit form, one step at a time: files are checked in the browser with Pyodide (RosettaSciIO +
// eelsdb.checks) and pre-fill the form; DOIs are looked up on CrossRef; instrument profiles fill angles.
// Without this script the page is one long form that posts normally, and moderators re-check every file.

import { RSCIIO, loadReader } from "./pyreader.js";

const TIMEOUT_MS = 90_000;
const MAX_BYTES = 50 * 1024 * 1024;
const SPECTRUM_EXT = ["dm3", "dm4", "msa", "emsa", "emd", "hspy", "txt", "csv", "xdi"];
const COMPANION_EXT = ["emd", "ser", "emi", "dm3", "dm4"];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const form = $("#submit-form");
const editing = form.dataset.edit === "1";
// Not form.elements: the form has a field called "elements", which shadows it.
const field = (name) => form.querySelector(`[name="${name}"]`);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};

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
form.addEventListener("input", (e) => {
  e.target.classList?.remove("prefilled");
  e.target.setCustomValidity?.("");
});
form.addEventListener("change", (e) => e.target.setCustomValidity?.(""));

const markFilled = (name) => {
  field(name)?.classList.add("prefilled");
  $("[data-prefilled]").hidden = false;
};

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
    syncBeam();
  } else {
    if (field(name).value || field(`${name}_unknown`).checked) return false;
    field(name).value = +value.toFixed(3);
  }
  setProvenance(name, source);
  return true;
}

const fillIfEmpty = (name, value) => {
  if (value === null || value === undefined || value === "" || !field(name) || field(name).value) return false;
  field(name).value = value;
  markFilled(name);
  return true;
};

// Elements from the formula, until the submitter edits them. Only real symbols, as the server does.
const SYMBOLS = new Set(field("formula").dataset.symbols.split(" "));
let elementsTouched = !!field("elements").value;
field("elements").addEventListener("input", () => (elementsTouched = true));
const elementsFromFormula = () => {
  if (elementsTouched) return;
  field("elements").value = [...new Set(field("formula").value.match(/[A-Z][a-z]?/g) ?? [])].filter((e) => SYMBOLS.has(e)).join(", ");
};

// Odd formulas get a warning, never a block: names like "Zircaloy-4" are real submissions.
const VARIABLES = new Set(["x", "y", "z", "n", "m"]);
const WORDS = new Set(["alpha", "beta", "gamma", "delta", "mol", "wt", "at", "doped", "film", "bulk", "amorphous"]);
const BRACKETS = { ")": "(", "]": "[", "}": "{" };

/** "CePrOx" -> ["Ce", "Pr", "O", "x"]; with ignoreCase, "fe" -> ["Fe"]. Null if the word is not symbols. */
function splitSymbols(word, ignoreCase) {
  if (!word) return [];
  for (const n of [2, 1]) {
    const head = word.slice(0, n);
    if (head.length < n) continue;
    const sym = ignoreCase ? head[0].toUpperCase() + head.slice(1).toLowerCase() : head;
    if (SYMBOLS.has(sym) || (n === 1 && !ignoreCase && VARIABLES.has(head))) {
      const rest = splitSymbols(word.slice(n), ignoreCase);
      if (rest) return [sym, ...rest];
    }
  }
  return null;
}

/** Warnings about a formula: [message, suggested formula?][]. */
function lintFormula(formula, listed) {
  const notes = [];
  const unknown = [];
  let fixable = false;
  const found = new Set();
  const fixed = formula.replace(/[A-Za-z]+/g, (word) => {
    if (WORDS.has(word.toLowerCase())) return word;
    const exact = splitSymbols(word, false);
    if (exact) {
      exact.filter((x) => SYMBOLS.has(x)).forEach((x) => found.add(x));
      return word;
    }
    const loose = splitSymbols(word, true);
    if (loose) {
      fixable = true;
      return loose.join("");
    }
    unknown.push(word);
    return word;
  });
  if (fixable) notes.push([`Element symbols start with a capital letter. Did you mean ${fixed}?`, fixed]);
  if (unknown.length) notes.push([`Not element symbols: ${[...new Set(unknown)].join(", ")}.`]);
  const stray = [...new Set(formula.match(/[^\p{L}\p{N}\s()[\]{}.,+\-–−·*/%_^:=~']/gu) ?? [])];
  if (stray.length) notes.push([`Unexpected characters: ${stray.join(" ")}`]);
  const stack = [];
  let balanced = true;
  for (const ch of formula) {
    if ("([{".includes(ch)) stack.push(ch);
    else if (BRACKETS[ch] && stack.pop() !== BRACKETS[ch]) balanced = false;
  }
  if (!balanced || stack.length) notes.push(["The brackets do not match."]);
  if (listed) {
    const missing = listed.filter((e) => SYMBOLS.has(e) && !found.has(e));
    const extra = [...found].filter((e) => !listed.includes(e));
    if (missing.length) notes.push([`Listed in Elements but not in the formula: ${missing.join(", ")}.`]);
    if (extra.length) notes.push([`In the formula but not in Elements: ${extra.join(", ")}.`]);
  }
  return notes;
}

const formulaWarning = $("#formula-warning");
function checkFormula() {
  const formula = field("formula").value.trim();
  const listed = elementsTouched ? field("elements").value.split(/[\s,;]+/).filter(Boolean) : null;
  const notes = formula ? lintFormula(formula, listed) : [];
  formulaWarning.replaceChildren(
    ...notes.map(([message, suggestion]) => {
      const line = el("span", {}, message);
      if (suggestion) {
        const use = el("button", { type: "button", className: "link-button", textContent: `Use ${suggestion}` });
        use.addEventListener("click", () => {
          field("formula").value = suggestion;
          field("formula").dispatchEvent(new Event("input", { bubbles: true }));
          field("formula").focus();
        });
        line.append(" ", use);
      }
      return line;
    }),
  );
  if (notes.length) formulaWarning.append(el("span", { className: "hint" }, "You can still submit it as it is."));
  formulaWarning.hidden = !notes.length;
}
field("formula").addEventListener("input", () => {
  elementsFromFormula();
  checkFormula();
});
field("elements").addEventListener("input", checkFormula);
checkFormula();

// Beam energy "Other" box only matters when "Other" is chosen.
const beamOther = $(".beam-other", form);
function syncBeam() {
  const v = form.querySelector('input[name="beam_energy_choice"]:checked')?.value;
  beamOther.hidden = v !== "other" && !field("beam_energy").value;
}
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
  const helper = el("div", { className: "hint" });
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
      const settings = Object.entries(k.settings ?? {}).map(([key, val]) => `${key} ${val}`).join(", ");
      const b = el("button", { type: "button", className: "chip", textContent: `${k.kind} ${k.value} mrad${settings ? ` (${settings})` : ""}` });
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

// ---- Steps ------------------------------------------------------------------------------------

const sections = $$("section.step", form);
const navItems = new Map($$(".steps li").map((li) => [li.dataset.step, li]));
const isXas = () => field("type").value === "xrayabs";
const visible = () => sections.filter((s) => s.dataset.step !== "xas" || isXas());
let current = null;
const reached = new Set();

function syncXas() {
  $("#step-xas").hidden = !isXas();
  navItems.get("xas").hidden = !isXas();
  form.classList.toggle("is-xas", isXas());
  for (const n of $$("[data-eels-required]", form)) n.setAttribute("aria-required", String(!isXas()));
}
field("type").addEventListener("change", syncXas);

function paintNav() {
  const order = visible().map((s) => s.dataset.step);
  const at = order.indexOf(current);
  for (const [id, li] of navItems) {
    const i = order.indexOf(id);
    li.dataset.state = id === current ? "current" : i >= 0 && i < at ? "done" : reached.has(id) ? "reached" : "upcoming";
    const link = $("a", li);
    if (id === current) link.setAttribute("aria-current", "step");
    else link.removeAttribute("aria-current");
    li.toggleAttribute("data-error", !!$(".has-error", $(`#step-${id}`)));
  }
}

function go(id, { focus = true } = {}) {
  current = id;
  reached.add(id);
  for (const s of sections) s.classList.toggle("current", s.dataset.step === id);
  paintNav();
  placePanel();
  if (id === "review") review();
  if (focus) {
    const h = $(`#step-${id} h2`);
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
    $(".wizard").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

/** The browser's own checks plus the rules it cannot express; the server checks everything again. */
function validStep(section) {
  const step = section.dataset.step;
  if (step === "files") return filesReady();
  const controls = $$("input, select, textarea", section);
  for (const control of controls) control.setCustomValidity("");
  if (step === "acquisition" && !isXas()) {
    if (!form.querySelector('input[name="beam_energy_choice"]:checked')) {
      form.querySelector('input[name="beam_energy_choice"]').setCustomValidity("Choose the beam energy, or Unknown.");
    }
    for (const name of ["convergence", "collection"]) {
      if (!field(name).value && !field(`${name}_unknown`).checked) field(name).setCustomValidity("Enter the angle, or tick Unknown.");
    }
  }
  for (const control of controls) {
    if (!control.checkValidity()) {
      control.reportValidity();
      return false;
    }
  }
  return true;
}

function move(delta) {
  const order = visible();
  const i = order.findIndex((s) => s.dataset.step === current);
  if (delta > 0 && !validStep(order[i])) return;
  const next = order[i + delta];
  if (next) go(next.dataset.step);
}

form.addEventListener("click", (e) => {
  if (e.target.closest("[data-next]")) move(1);
  else if (e.target.closest("[data-back]")) move(-1);
  else if (e.target.closest("[data-goto]")) go(e.target.closest("[data-goto]").dataset.goto);
});

$(".steps").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  e.preventDefault();
  const order = visible().map((s) => s.dataset.step);
  const from = order.indexOf(current);
  const to = order.indexOf(li.dataset.step);
  if (to <= from || reached.has(li.dataset.step)) return go(li.dataset.step);
  // Going forward: every step on the way must be complete.
  for (let i = from; i < to; i++) {
    if (!validStep(sections.find((s) => s.dataset.step === order[i]))) return go(order[i]);
  }
  go(li.dataset.step);
});

// ---- Files ------------------------------------------------------------------------------------

const ROLES = { original: "Spectrum", lowloss: "Low-loss (for thickness)", companion: "Companion file" };
const INPUTS = { original: "file", lowloss: "lowloss_file", companion: "companion_file" };
// Processed versions (oscillator strength, smoothed…): the server renders one input each, only for new submissions.
for (const input of $$(".variant-files input[type=file]", form)) {
  const role = input.name.replace(/_file$/, "");
  ROLES[role] = `Processed: ${$(`label[for="${input.id}"]`, form).textContent.toLowerCase()}`;
  INPUTS[role] = input.name;
}
ROLES.unused = "Do not include";
const isVariant = (role) => role?.startsWith("variant_");
const files = [];
const list = $("#file-list");
const nextButton = $("#step-files [data-next]");
const ext = (f) => f.name.split(".").pop().toLowerCase();
const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function filesReady() {
  if (files.some((f) => f.state === "reading")) return false;
  return editing || files.some((f) => f.role === "original");
}

function syncInputs() {
  for (const [role, name] of Object.entries(INPUTS)) {
    const dt = new DataTransfer();
    const entry = files.find((f) => f.role === role);
    if (entry) dt.items.add(entry.file);
    field(name).files = dt.files;
  }
  nextButton.disabled = !filesReady();
  nextButton.textContent = files.some((f) => f.state === "reading") ? "Checking files…" : "Continue";
}

const looksLowLoss = (r) => r?.points !== undefined && r.energy_min < 10 && r.energy_max <= 200;

/** Roles the submitter has not chosen: one spectrum, then a low-loss, then a companion; the rest left out. */
function assignRoles() {
  const taken = new Set(files.filter((f) => f.chosen).map((f) => f.role));
  const free = files.filter((f) => !f.chosen && !f.rejected);
  for (const f of free) f.role = null;
  const isSpectrum = (f) => f.result?.points !== undefined || (f.state === "failed" && SPECTRUM_EXT.includes(ext(f.file)));
  const take = (role, f) => {
    if (!f || taken.has(role)) return;
    f.role = role;
    taken.add(role);
  };
  const spectra = free.filter(isSpectrum);
  take("original", spectra.find((f) => !looksLowLoss(f.result)) ?? spectra[0]);
  take("lowloss", spectra.find((f) => !f.role && looksLowLoss(f.result)));
  take("companion", free.find((f) => !f.role && !isSpectrum(f) && f.state !== "reading" && COMPANION_EXT.includes(ext(f.file))));
  for (const f of free) f.role ??= f.state === "reading" ? null : "unused";
}

function render() {
  assignRoles();
  for (const f of files) paintCard(f);
  syncInputs();
  updatePanel();
}

function paintCard(f) {
  if (f.current) return;
  f.card ??= buildCard(f);
  f.card.dataset.state = f.rejected ? "failed" : f.state;
  f.card.dataset.role = f.role ?? "";
  const select = $("select", f.card);
  select.value = f.role ?? "";
  select.disabled = !!f.rejected || f.state === "reading";
  $(".file-status", f.card).textContent = f.status;
  const leftOut = f.role === "unused" && f.result?.points !== undefined && !f.chosen;
  f.card.toggleAttribute("data-warn", leftOut);
  $(".unused-note", f.card).hidden = !leftOut;
}

function buildCard(f) {
  const select = el("select", { "aria-label": `How to use ${f.file.name}` }, el("option", { value: "", textContent: "Choose…" }));
  for (const [value, label] of Object.entries(ROLES)) select.append(el("option", { value, textContent: label }));
  select.addEventListener("change", () => {
    const role = select.value;
    for (const other of files) if (other !== f && other.role === role && role !== "unused") other.chosen = false;
    f.role = role;
    f.chosen = true;
    render();
    if (role !== "unused") applyResult(f);
  });
  const remove = el("button", { type: "button", className: "icon-button", title: "Remove", "aria-label": `Remove ${f.file.name}` });
  remove.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  remove.addEventListener("click", () => {
    files.splice(files.indexOf(f), 1);
    f.card.remove();
    f.plot?.destroy();
    render();
  });
  const card = el(
    "li",
    { className: "file-card" },
    el("div", { className: "file-head" },
      el("span", { className: "file-name", textContent: f.file.name }),
      el("span", { className: "file-size", textContent: size(f.file.size) }),
      el("label", { className: "file-role" }, "Use as ", select),
      remove),
    el(
      "p",
      { className: "hint unused-note", hidden: true },
      el("strong", { textContent: "This file will not be included. " }),
      editing
        ? "Each submission has one spectrum: send this one separately afterwards."
        : "Each submission has one spectrum. If this is a processed version of it (oscillator strength, smoothed…), choose that above; otherwise send it separately afterwards.",
    ),
    el("div", { className: "file-plot" }),
    el(
      "section",
      { className: "card-section" },
      el("h3", { className: "card-label", textContent: "File checks" }),
      el("p", { className: "file-status" }),
      el("ul", { className: "findings" }),
    ),
  );
  list.append(card);
  return card;
}

async function addFiles(fileList) {
  for (const file of fileList) {
    const f = { file, state: "reading", status: "Waiting to be read…", role: null, chosen: false };
    const e = ext(file);
    if (![...SPECTRUM_EXT, ...COMPANION_EXT].includes(e)) {
      Object.assign(f, { rejected: true, state: "failed", status: `.${e} files are not accepted.` });
    } else if (file.size > MAX_BYTES) {
      Object.assign(f, { rejected: true, state: "failed", status: `This file is larger than ${MAX_BYTES / 1024 / 1024} MB.` });
    }
    files.push(f);
  }
  render();
  for (const f of files.filter((x) => x.state === "reading" && !x.busy)) {
    f.busy = true;
    await read(f);
    f.busy = false;
    render();
    applyResult(f);
  }
}

const dropzone = $("#dropzone");
const picker = $("#f-drop");
dropzone.hidden = false;
$("#browse").addEventListener("click", () => picker.click());
picker.addEventListener("change", () => {
  addFiles([...picker.files]);
  picker.value = "";
});
const stepFiles = $("#step-files");
stepFiles.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("over");
});
stepFiles.addEventListener("dragleave", (e) => {
  if (!stepFiles.contains(e.relatedTarget)) dropzone.classList.remove("over");
});
stepFiles.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("over");
  addFiles([...e.dataTransfer.files]);
});

// ---- Browser checks with Pyodide --------------------------------------------------------------

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
    xas = sp.header.get("xas") or {}
    title = str(sp.header.get("TITLE") or xas.get("sample") or "").strip()
    out = {"meta": {k: clean(sp.header.get(k)) for k in keys}, "xas": xas, "title": title,
           "phase": sp.header.get("phase"), "reference": sp.header.get("reference")}
    if sp.energy is None:
        return json.dumps(out)
    energy, intensity = sp.energy, sp.intensity
    DATA[path] = (energy, intensity)
    findings = checks.run_all(energy, intensity, spectrum_type=kind or None, formula=formula or None,
                              elements=elements, edges=edges, edge_table=json.loads(table_json), thickness=thickness,
                              header_axis=sp.header_axis, navigation_shape=sp.navigation_shape)
    step = max(1, energy.size // 2000)
    out.update({
        "points": int(energy.size),
        "energy_min": float(energy.min()), "energy_max": float(energy.max()),
        "dispersion": float((energy[-1] - energy[0]) / (energy.size - 1)) if energy.size > 1 else None,
        "findings": [f.as_dict() for f in findings],
        "x": energy[::step].tolist(), "y": np.nan_to_num(intensity[::step]).tolist(),
    })
    return json.dumps(out)

DATA = {}
TABLE = json.loads(TABLE_JSON)

def suggest(path, kind):
    if not hasattr(checks, "detect_edges") or path not in DATA:
        return "[]"
    energy, intensity = DATA[path]
    return json.dumps(checks.detect_edges(energy, intensity, TABLE, spectrum_type=kind or None), default=float)

def near(energy):
    if not hasattr(checks, "edges_near"):
        return "[]"
    return json.dumps(checks.edges_near(float(energy), TABLE), default=float)
`;

let pyodidePromise;
let edgeTable = {};
function pyodideReady() {
  pyodidePromise ??= (async () => {
    const py = await loadReader();
    const table = await (await fetch("/eels_binding_energies.json")).json();
    edgeTable = table.elements;
    py.globals.set("TABLE_JSON", JSON.stringify(table.elements));
    await py.runPythonAsync(READ_PY);
    return py;
  })();
  return pyodidePromise;
}

const withTimeout = (p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);

// Start loading early, in idle time, so checks are ready by the time a file arrives.
(window.requestIdleCallback ?? setTimeout)(() => pyodideReady().catch(() => {}));

async function runChecks(f, kind) {
  const py = await withTimeout(pyodideReady());
  const path = `/tmp/${files.indexOf(f)}-${f.file.name.replace(/[^\w.\-]+/g, "_")}`;
  f.path = path;
  py.FS.writeFile(path, new Uint8Array(await f.file.arrayBuffer()));
  const edges = field("edges").value.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  const elements = field("elements").value.split(/[\s,;]+/).filter(Boolean);
  const thickness = parseFloat(field("thickness_t_lambda").value) || null;
  const run = py.globals.get("run");
  try {
    return JSON.parse(run(path, kind, field("formula").value, elements, edges, thickness, py.globals.get("TABLE_JSON")));
  } finally {
    run.destroy();
  }
}

async function read(f) {
  f.status = pyodidePromise ? "Reading in your browser…" : "Getting the file reader ready…";
  paintCard(f);
  try {
    f.result = await runChecks(f, "");
    f.state = "done";
    f.status =
      f.result.points === undefined
        ? "Read. No energy-loss axis in it, so it can be a companion file."
        : `Read ${f.result.points} points from ${f.result.energy_min.toFixed(1)} to ${f.result.energy_max.toFixed(1)} eV.`;
    showFindings($(".findings", f.card), f.result.findings);
    if (f.result.x) f.plot = drawPlot($(".file-plot", f.card), f.result.x, f.result.y, f.plot);
  } catch (e) {
    f.state = "failed";
    f.status =
      e.message === "timeout"
        ? "Checking in the browser is taking too long. You can still continue: the moderators check every file."
        : `Your browser could not read this file (${String(e.message).split("\n").filter(Boolean).pop()}). You can still continue: the moderators check every file.`;
    f.error = String(e.message).slice(0, 500);
  }
}

function guessType(f) {
  const r = f.result;
  if (ext(f.file) === "xdi" || Object.keys(r.xas ?? {}).length) return "xrayabs";
  if (r.energy_max <= 20) return "zeroloss";
  return looksLowLoss(r) ? "lowloss" : "coreloss";
}

/** Pre-fill the form from what a file says, without overwriting anything typed. */
function applyResult(f) {
  const r = f.result;
  if (!r || !f.role || f.role === "unused" || f.current || isVariant(f.role)) return;
  const source = f.role === "companion" ? "companion" : "file";
  prefill("beam_energy", r.meta.beam_energy_kv, source);
  prefill("convergence", r.meta.convergence_mrad, source);
  prefill("collection", r.meta.collection_mrad, source);
  if (f.role !== "original") return;
  if (r.points !== undefined && !field("type").value) {
    field("type").value = guessType(f);
    markFilled("type");
    syncXas();
  }
  fillIfEmpty("title", r.title);
  if (["liquid", "gas"].includes(r.phase) && field("phase").value === "solid") {
    field("phase").value = r.phase;
    markFilled("phase");
  }
  fillIfEmpty("ref_freetext", r.reference);
  const x = r.xas ?? {};
  for (const k of ["facility", "beamline", "source_type", "monochromator"]) fillIfEmpty(`xas_${k}`, x[k]);
  if (fillIfEmpty("formula", x.formula)) elementsFromFormula();
  if (x.element && x.edge) fillIfEmpty("edges", `${x.element}_${x.edge}`);
  if (x.intensity_column?.startsWith("mu") && field("intensity_units").value === "counts") {
    field("intensity_units").value = "mu";
    markFilled("intensity_units");
  }
  fillIfEmpty("integration_time_s", r.meta.exposure_s);
  fillIfEmpty("readouts", r.meta.frames);
  if (r.dispersion) fillIfEmpty("dispersion_ev", +r.dispersion.toFixed(5));
  storeChecks(f);
}

function storeChecks(f) {
  field("browser_checks").value = JSON.stringify(f.result ? { rsciio: RSCIIO, ...f.result, x: undefined, y: undefined } : { error: f.error });
}

function showFindings(ul, findings = []) {
  const order = { error: 0, warning: 1, info: 2 };
  ul.replaceChildren(...[...findings].sort((a, b) => order[a.severity] - order[b.severity]).map((x) => el("li", { className: x.severity, textContent: x.message })));
  if (!findings.length) ul.append(el("li", { className: "ok", textContent: "No problems found." }));
}

const probe = el("span", { hidden: true });
document.body.append(probe);
const css = (n) => {
  probe.style.color = `var(${n})`;
  return getComputedStyle(probe).color;
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
// Wide plots squash the fine structure, so height follows width up to a cap.
const plotHeight = (width) => Math.round(Math.min(460, Math.max(200, width / 2.4)));
const resized = new ResizeObserver((entries) => {
  for (const { target } of entries) target.plot?.setSize({ width: target.clientWidth, height: plotHeight(target.clientWidth) });
});

function drawPlot(node, x, y, old, extra = {}) {
  old?.destroy();
  const axis = { stroke: css("--muted"), grid: { stroke: css("--rule") }, ticks: { stroke: css("--line") } };
  const width = node.clientWidth || 600;
  resized.observe(node);
  return (node.plot = new uPlot(
    {
      width,
      height: plotHeight(width),
      scales: { x: { time: false } },
      axes: [{ ...axis, label: "Energy (eV)" }, { ...axis, size: 56, values: (u, vals) => vals.map(compact.format) }],
      series: [{}, { stroke: css("--plot"), width: 1.25, points: { show: false } }],
      legend: { show: false },
      cursor: { show: false },
      ...extra,
    },
    [x, y],
    node,
  ));
}

// ---- Spectrum plot and edges ------------------------------------------------------------------
// The edges text field is the source of truth: the markers and the list are drawn from it. Detected
// edges are written to it at once; removing one dismisses it. Without Pyodide there is no plot.

const panel = $("#spectrum-panel");
const edgeBox = $(".edge-box", panel);
const panelPlot = $(".panel-plot", panel);
const edgeList = $(".edge-list", panel);
const menu = $("#edge-menu");
const edgeStatus = $("#edge-status");
// Keep in step with EDGE in src/submit/form.ts.
const EDGE = /^([A-Z][a-z]?)[_ ]((?:K|L1|L2,3|L2|L3|M1|M2,3|M4,5|M|N2,3|N4,5|N6,7|O2,3|O4,5))$/;
const edgeKey = (c) => `${c.element}_${c.edge}`;
const edgeName = (c) => `${c.element} ${c.edge}`;
/** "Fe L2,3" with the subshells as a subscript, as edges are set everywhere else. */
const edgeLabel = (c) => {
  const [, shell, sub] = c.edge.match(/^([A-Z])(.*)$/);
  return el("span", { className: "edge-name" }, `${c.element} ${shell}`, sub && el("sub", { textContent: sub }));
};
const validEdge = (c) => EDGE.test(edgeKey(c)) && SYMBOLS.has(c.element);
const eV = (e) => `${Math.round(e)} eV`;
const shown = { file: null, plot: null, detected: new Set(), dismissed: new Set() };

/** Lowest table onset of the label's subshells: "L2,3" is drawn at L3. */
function onset({ element, edge }) {
  const [, shell, a, b] = edge.match(/^([KLMNO])(\d)?(?:,(\d))?$/) ?? [];
  if (!shell) return null;
  const subshells = shell === "K" ? ["K"] : a ? Array.from({ length: (b ?? a) - a + 1 }, (_, i) => `${shell}${+a + i}`) : [1, 2, 3, 4, 5, 6, 7].map((i) => `${shell}${i}`);
  const energies = subshells.map((s) => edgeTable[element]?.[s]?.["onset_energy (eV)"]).filter(Number.isFinite);
  return energies.length ? Math.min(...energies) : null;
}

const fieldEntries = () => field("edges").value.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
const entryEdge = (s) => {
  const m = s.match(EDGE);
  return m ? { element: m[1], edge: m[2] } : null;
};
const fieldEdges = () => fieldEntries().map(entryEdge).filter(Boolean);

function writeEdges(entries) {
  field("edges").value = entries.join("; ");
  field("edges").dispatchEvent(new Event("input", { bubbles: true }));
}
const entryKey = (s) => {
  const c = entryEdge(s);
  return c && edgeKey(c);
};

/** Replace `old` (or append) with `next`, leaving everything else the submitter typed alone. */
function setEdge(old, next) {
  const entries = fieldEntries();
  const at = old ? entries.findIndex((s) => entryKey(s) === edgeKey(old)) : -1;
  const dup = next && entries.some((s) => entryKey(s) === edgeKey(next));
  if (at >= 0) entries.splice(at, 1, ...(next && !dup ? [edgeKey(next)] : []));
  else if (next && !dup) entries.push(edgeKey(next));
  if (old && shown.detected.delete(edgeKey(old))) shown.dismissed.add(edgeKey(old));
  writeEdges(entries);
  edgeStatus.textContent = next ? `${edgeName(next)} added.` : `${edgeName(old)} removed.`;
}

async function pyCall(name, ...args) {
  const py = await withTimeout(pyodideReady());
  const fn = py.globals.get(name);
  try {
    return JSON.parse(fn(...args));
  } finally {
    fn.destroy();
  }
}

// A new spectrum file wins; when editing without one, the panel shows the spectrum's current file.
const panelFile = () => files.find((x) => x.role === "original" && x.result?.x) ?? files.find((x) => x.current && x.result?.x);

/** On the files step the plot sits in its file's card, so it is clear which file it shows; later, beside the form. */
function placePanel() {
  const card = current === "files" && shown.file?.card;
  if (card) $(".file-plot", card).after(edgeBox);
  else if (edgeBox.parentNode !== panel) panel.append(edgeBox);
  panel.hidden = !shown.file || !!card;
}

function updatePanel() {
  const f = panelFile();
  if (f === shown.file) return placePanel();
  shown.plot?.destroy();
  // Edges detected in a file that is no longer the spectrum leave with it.
  if (shown.detected.size) writeEdges(fieldEntries().filter((s) => !shown.detected.has(entryKey(s))));
  Object.assign(shown, { file: f, plot: null, detected: new Set(), dismissed: new Set() });
  menu.hidePopover?.();
  placePanel();
  if (!f) return;
  $(".panel-name", panel).textContent = f.current ? `${f.file.name} (current file)` : f.file.name;
  shown.plot = drawPlot(panelPlot, f.result.x, f.result.y, null, {
    cursor: { y: false, points: { show: false }, drag: { x: false, y: false } },
    hooks: { draw: [paintEdges] },
  });
  shown.plot.over.append(el("div", { className: "edge-layer" }));
  shown.plot.over.addEventListener("click", plotClick);
  detectEdges(f);
}

async function detectEdges(f) {
  // The edges of a published spectrum are only changed by hand.
  if (f.current) return paintEdges();
  let found = [];
  try {
    found = await pyCall("suggest", f.path, field("type").value || guessType(f));
  } catch {}
  if (shown.file !== f) return;
  const picks = found.map((s) => (s.candidates ?? []).find(validEdge)).filter(Boolean);
  const keys = new Set(picks.map(edgeKey));
  // After a change of type, drop what is no longer detected.
  const entries = fieldEntries().filter((s) => !shown.detected.has(entryKey(s)) || keys.has(entryKey(s)));
  shown.detected = new Set([...shown.detected].filter((k) => keys.has(k)));
  const added = picks.filter((c) => !shown.dismissed.has(edgeKey(c)) && !entries.some((s) => entryKey(s) === edgeKey(c)));
  for (const c of added) {
    entries.push(edgeKey(c));
    shown.detected.add(edgeKey(c));
  }
  writeEdges(entries);
  if (added.length) edgeStatus.textContent = `Found ${added.map(edgeName).join(", ")}.`;
}
field("type").addEventListener("change", () => shown.file && detectEdges(shown.file));
field("edges").addEventListener("input", () => paintEdges());

function paintEdges() {
  const u = shown.plot;
  const layer = u && $(".edge-layer", u.over);
  if (!layer) return;
  const [lo, hi] = [u.scales.x.min, u.scales.x.max];
  const edges = fieldEdges()
    .map((c) => ({ c, energy: onset(c) }))
    .sort((a, b) => (a.energy ?? Infinity) - (b.energy ?? Infinity));
  layer.replaceChildren(
    ...edges
      .filter((m) => m.energy !== null && m.energy >= lo && m.energy <= hi)
      .map((m, i) => {
        const x = u.valToPos(m.energy, "x");
        const b = el(
          "button",
          { type: "button", className: `edge-mark${x > u.over.clientWidth - 70 ? " flip" : ""}`, ariaLabel: `Edge ${edgeName(m.c)}, ${eV(m.energy)}` },
          edgeLabel(m.c),
        );
        b.style.left = `${x}px`;
        b.style.setProperty("--row", i % 3);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          edgeMenu(m, b);
        });
        return b;
      }),
  );
  edgeList.replaceChildren(
    ...edges.map((m, i) => {
      const remove = el(
        "button",
        { type: "button", className: "chip", ariaLabel: `Remove ${edgeName(m.c)}` },
        edgeLabel(m.c),
        m.energy !== null && el("span", { className: "energy", textContent: eV(m.energy) }),
        el("span", { ariaHidden: "true", textContent: "×" }),
      );
      remove.addEventListener("click", () => {
        setEdge(m.c, null);
        ($$("button", edgeList)[Math.min(i, edges.length - 2)] ?? $(".card-label", edgeBox)).focus();
      });
      return el("li", {}, remove);
    }),
  );
  if (!edges.length) edgeList.append(el("li", { className: "muted", textContent: "None yet." }));
  $(".edge-help", edgeBox).textContent = shown.detected.size
    ? "We added the edges we found in your spectrum. Click an edge to remove it. To add another, click the plot at its energy."
    : "To add an edge, click the plot at its energy.";
}

function openMenu(opener, x, title, actions) {
  menu.replaceChildren(el("p", { className: "edge-menu-title", textContent: title }));
  for (const a of actions) {
    const b = el("button", { type: "button", className: a.primary ? "primary" : "", textContent: a.label });
    b.addEventListener("click", () => {
      menu.hidePopover();
      a.run?.();
    });
    menu.append(b);
  }
  menu.opener = opener;
  menu.showPopover();
  const over = shown.plot.over.getBoundingClientRect();
  const left = Math.min(Math.max(8, over.left + x - menu.offsetWidth / 2), innerWidth - menu.offsetWidth - 8);
  menu.style.left = `${left}px`;
  // Below the plot so the edge being chosen stays visible; above it when the window is too short.
  const below = over.bottom + 6;
  menu.style.top = `${below + menu.offsetHeight + 8 <= innerHeight ? below : Math.max(8, over.top - menu.offsetHeight - 6)}px`;
  $("button", menu)?.focus();
}
menu.addEventListener("toggle", (e) => {
  if (e.newState === "closed" && menu.opener?.isConnected && (menu.contains(document.activeElement) || document.activeElement === document.body)) {
    menu.opener.focus({ preventScroll: true });
  }
});

async function edgeMenu(m, opener) {
  let near = [];
  try {
    near = (await pyCall("near", m.energy)).filter(validEdge).filter((c) => edgeKey(c) !== edgeKey(m.c));
  } catch {}
  openMenu(opener, shown.plot.valToPos(m.energy, "x"), `${edgeName(m.c)} at ${eV(m.energy)}`, [
    { label: `Remove ${edgeName(m.c)}`, run: () => setEdge(m.c, null) },
    ...near.slice(0, 5).map((c) => ({ label: `Change to ${edgeName(c)} (${eV(c.onset)})`, run: () => setEdge(m.c, c) })),
    { label: "Cancel" },
  ]);
}

async function plotClick(e) {
  const u = shown.plot;
  const x = e.clientX - u.over.getBoundingClientRect().left;
  const energy = u.posToVal(x, "x");
  let near = [];
  try {
    near = await pyCall("near", energy);
  } catch {
    return;
  }
  const listed = new Set(fieldEdges().map(edgeKey));
  near = near.filter(validEdge).filter((c) => !listed.has(edgeKey(c)));
  openMenu(
    u.over,
    x,
    near.length ? `Edges near ${eV(energy)}` : `No other known edges within 15 eV of ${eV(energy)}.`,
    [...near.slice(0, 6).map((c, i) => ({ label: `Add ${edgeName(c)} (${eV(c.onset)})`, primary: i === 0, run: () => setEdge(null, c) })), { label: "Cancel" }],
  );
}

// ---- Review -----------------------------------------------------------------------------------

/** What one field says, in words: "200 kV", "21.5 mrad (approximate ± 2)", "Fourier-log, Stephens". */
function describe(fieldNode) {
  const parts = [];
  for (const c of $$("input, select, textarea", fieldNode)) {
    if (c.type === "hidden" || c.type === "file") continue;
    if (c.type === "radio") {
      if (c.checked && c.value !== "other") parts.push(c.nextElementSibling?.textContent ?? c.value);
    } else if (c.type === "checkbox") {
      if (c.checked) parts.push(c.closest("label")?.textContent.trim() ?? "Yes");
    } else if (c.tagName === "SELECT") {
      if (c.value) parts.push(c.selectedOptions[0].textContent);
    } else if (c.value.trim()) {
      const unit = c.parentElement.querySelector(".unit")?.textContent;
      const prefix = c.name.endsWith("_uncertainty") ? "± " : "";
      parts.push(prefix + c.value.trim() + (unit && !c.name.endsWith("_uncertainty") ? ` ${unit}` : ""));
    }
  }
  return parts.join(" · ");
}

function editButton(id) {
  const b = el("button", { type: "button", className: "link-button", textContent: "Edit" });
  b.dataset.goto = id;
  return b;
}

function review() {
  const summary = $("#summary");
  summary.replaceChildren();
  const used = files.filter((f) => f.role && f.role !== "unused" && !f.current);
  const group = (id, title, rows) => {
    const dl = el("dl", { className: "meta" });
    for (const [label, value] of rows) dl.append(el("dt", { textContent: label }), el("dd", { textContent: value }));
    if (!rows.length) dl.append(el("dd", { className: "muted", textContent: "Nothing entered." }));
    summary.append(el("section", { className: "summary-group" },
      el("div", { className: "summary-head" }, el("h3", { textContent: title }),
        editButton(id)),
      dl));
  };
  const current = !used.some((f) => f.role === "original") && files.find((f) => f.current);
  group("files", "Files", [...(current ? [["Spectrum file", `${current.file.name} (current file)`]] : []), ...used.map((f) => [ROLES[f.role], f.file.name])]);
  for (const s of visible()) {
    const id = s.dataset.step;
    if (id === "files" || id === "review") continue;
    const rows = [];
    for (const node of $$(".field", s)) {
      const label = $(":scope > label, :scope > legend", node)?.textContent.trim();
      const value = describe(node);
      if (label && value) rows.push([label, value]);
    }
    group(id, $("h2", s).textContent, rows);
  }
  finalChecks();
}

/** Run the checks again now the formula, edges and type are known. */
async function finalChecks() {
  const f = files.find((x) => x.role === "original") ?? files.find((x) => x.current);
  const box = $("#final-checks");
  if (!f?.result?.points) return (box.hidden = true);
  box.hidden = false;
  $(".checks-status", box).textContent = "Checking the spectrum against the details you gave…";
  try {
    f.result = { ...(await runChecks(f, field("type").value)), title: f.result.title };
    $(".checks-status", box).textContent = "";
    showFindings($(".findings", box), f.result.findings);
    storeChecks(f);
  } catch {
    $(".checks-status", box).textContent = "The browser checks could not run again; the moderators will check the file.";
  }
}

// ---- Sending ----------------------------------------------------------------------------------

let sent = false;
addEventListener("beforeunload", (e) => {
  if (files.length && !sent) e.preventDefault();
});

function showErrors(errors) {
  for (const p of $$(".js-error", form)) p.remove();
  for (const n of $$(".has-error", form)) n.classList.remove("has-error");
  const general = $("#submit-error");
  general.hidden = true;
  let first = null;
  for (const [key, message] of Object.entries(errors)) {
    const control = field(key) ?? $(`#f-${key}`);
    if (!control || ["rate", "turnstile", "agreement", "orcid"].includes(key)) {
      general.hidden = false;
      general.textContent = message;
      first ??= "review";
      continue;
    }
    const holder = control.closest(".field") ?? control.parentElement;
    holder.classList.add("has-error");
    holder.append(el("p", { className: "error js-error", textContent: message }));
    const step = control.closest("section.step").dataset.step;
    const order = visible().map((s) => s.dataset.step);
    if (first === null || order.indexOf(step) < order.indexOf(first)) first = step;
  }
  go(first ?? "review");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  for (const s of visible()) {
    if (s.dataset.step !== "review" && !validStep(s)) return go(s.dataset.step);
  }
  if (!validStep($("#step-review"))) return;
  const button = $("#submit-button");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const res = await fetch(location.pathname, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
    if (!res.headers.get("Content-Type")?.includes("json")) throw new Error("session");
    const body = await res.json();
    if (body.redirect) {
      sent = true;
      location.assign(body.redirect);
      return;
    }
    showErrors(body.errors ?? {});
  } catch (err) {
    const general = $("#submit-error");
    general.hidden = false;
    general.textContent =
      err.message === "session"
        ? "The server did not accept the form. Your sign-in may have ended: sign in again in another tab, then press the button again."
        : "Could not reach the server. Check your connection and press the button again.";
  } finally {
    window.turnstile?.reset();
    button.disabled = false;
    button.textContent = label;
  }
});

// ---- Start ------------------------------------------------------------------------------------

syncXas();
syncInputs();
const withError = $(".has-error", form)?.closest("section.step");
go(withError?.dataset.step ?? "files", { focus: false });

// Editing: read the spectrum's current file too, for the side panel only. It is never uploaded again or used to fill fields.
if (editing && form.dataset.currentFile) {
  (async () => {
    try {
      const res = await fetch(form.dataset.currentFile);
      if (!res.ok) return;
      const f = { file: new File([await res.blob()], form.dataset.currentName), role: "current", current: true, chosen: true, state: "current" };
      files.push(f);
      f.result = await runChecks(f, field("type").value);
      render();
    } catch {}
  })();
}

// Associated spectra: a type-ahead over published spectra (and the user's pending ones). The text field stays the
// submitted value, a space-separated list of addresses, so the form works the same without this script.
{
  const field = $("#f-associated");
  const TYPES = { coreloss: "Core loss", lowloss: "Low loss", zeroloss: "Zero loss", xrayabs: "X-ray absorption" };
  const attrs = (node, values) => {
    for (const [k, v] of Object.entries(values)) node.setAttribute(k, v);
    return node;
  };
  const slugOf = (s) => s.replace(/^https?:\/\/[^/]+\/spectra\//, "").replace(/\/$/, "");
  const chosen = new Map(); // slug → spectrum, in pick order
  const box = el("div", { className: "picker" });
  const chips = attrs(el("ul", { className: "picker-chips" }), { "aria-label": "Associated spectra" });
  const input = attrs(el("input", { type: "text", id: "f-associated-search", autocomplete: "off", placeholder: "Search by name or formula" }), {
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": "associated-list",
  });
  const list = attrs(el("ul", { className: "picker-list", id: "associated-list", hidden: true }), { role: "listbox", "aria-label": "Matching spectra" });
  box.append(chips, input, list);
  field.after(box);
  field.hidden = true;
  $(`label[for="f-associated"]`).htmlFor = input.id;
  let matches = [];
  let active = -1;

  const write = () => (field.value = [...chosen.keys()].join(" "));
  const renderChips = () => {
    chips.replaceChildren(
      ...[...chosen.values()].map((s) => {
        const b = attrs(el("button", { type: "button", className: "chip" }, el("span", { textContent: s.title }), " ", attrs(el("span", { textContent: "×" }), { "aria-hidden": "true" })), { "aria-label": `Remove ${s.title}` });
        b.title = [s.formula, TYPES[s.type], s.author, s.status === "pending" ? "not published yet" : ""].filter(Boolean).join(" · ");
        b.addEventListener("click", () => {
          chosen.delete(s.slug);
          write();
          renderChips();
          input.focus();
        });
        return el("li", {}, b);
      }),
    );
    chips.hidden = !chosen.size;
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const setActive = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    if (i < 0) input.removeAttribute("aria-activedescendant");
    else input.setAttribute("aria-activedescendant", `associated-opt-${i}`);
  };
  const add = (s) => {
    chosen.set(s.slug, s);
    write();
    renderChips();
    input.value = "";
    close();
  };
  const fetchJson = async (params) => (await fetch(`/search/spectra.json?${params}`)).json();

  let seq = 0;
  input.addEventListener("input", async () => {
    const q = input.value.trim();
    // A pasted address goes straight in.
    if (/^https?:\/\/\S+\/spectra\/[^/\s]+\/?$/.test(q)) {
      const [s] = await fetchJson(new URLSearchParams({ slug: slugOf(q) }));
      if (s) return add(s);
    }
    if (q.length < 2) return close();
    const mine = ++seq;
    const found = await fetchJson(new URLSearchParams({ q }));
    if (mine !== seq) return;
    matches = found.filter((s) => !chosen.has(s.slug) && s.slug !== form.dataset.slug);
    list.replaceChildren(
      ...(matches.length
        ? matches.map((s, i) => {
            const li = attrs(el("li", { id: `associated-opt-${i}` }, el("span", { textContent: s.title }), el("span", { className: "n", textContent: [s.formula, TYPES[s.type], s.author].filter(Boolean).join(" · ") })), { role: "option" });
            li.addEventListener("mousedown", (e) => e.preventDefault());
            li.addEventListener("click", () => add(matches[i]));
            return li;
          })
        : [el("li", { className: "none", textContent: "No matching spectra" })]),
    );
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setActive(matches.length ? 0 : -1);
  });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    const shown = !list.hidden;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown && matches.length) {
      e.preventDefault();
      setActive((active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === "Enter" && shown) {
      e.preventDefault();
      if (active >= 0) add(matches[active]);
    } else if (e.key === "Escape" && shown) {
      e.preventDefault();
      close();
    } else if (e.key === "Backspace" && input.value === "" && chosen.size) {
      chosen.delete([...chosen.keys()].at(-1));
      write();
      renderChips();
    }
  });

  // Spectra already in the field (editing, or the form came back with an error) become chips.
  const initial = field.value.split(/[\s,]+/).filter(Boolean).map(slugOf);
  renderChips();
  if (initial.length) {
    fetchJson(new URLSearchParams(initial.map((s) => ["slug", s]))).then((found) => {
      const bySlug = new Map(found.map((s) => [s.slug, s]));
      for (const slug of initial) chosen.set(slug, bySlug.get(slug) ?? { slug, title: slug });
      renderChips();
    });
  }
}

