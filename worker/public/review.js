// Review in the moderator's browser: read the submitted file with the pinned RosettaSciIO, run the checks against
// the submitted values, and make the MSA, HyperSpy and metadata files that approval publishes.
import { RSCIIO, loadReader } from "./pyreader.js";

const box = document.getElementById("review");
const input = JSON.parse(document.getElementById("review-input").textContent);
const form = document.getElementById("decision");
const approve = form?.querySelector('button[value="approve"]');
const status = box.querySelector(".checks-status");
// Resolved through an element, as the tokens use light-dark(), which canvas colours cannot.
const probe = Object.assign(document.createElement("span"), { hidden: true });
document.body.append(probe);
const css = (n) => {
  probe.style.color = `var(${n})`;
  return getComputedStyle(probe).color;
};
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (v, none) => (v === null || v === undefined ? none : String(v));

const PROCESS_PY = `
import json
from eelsdb.review import process
r = process(json.loads(INPUT), PATH, "/tmp/review", json.loads(TABLE))
json.dumps({"outputs": {k: str(v) for k, v in r["outputs"].items()}, "findings": [f.as_dict() for f in r["findings"]],
            "compare": r["compare"], "plot": r["plot"], "points": r["points"], "record": r["record"]})
`;

let result = null;
let uploaded = false;
if (approve) approve.disabled = true;

function showFindings(ul, findings) {
  const order = { error: 0, warning: 1, info: 2 };
  ul.replaceChildren(
    ...[...findings].sort((a, b) => order[a.severity] - order[b.severity]).map((f) => Object.assign(document.createElement("li"), { className: f.severity, textContent: f.message })),
  );
  if (!findings.length) ul.append(Object.assign(document.createElement("li"), { className: "ok", textContent: "No problems found." }));
  ul.hidden = false;
}

function showCompare(rows) {
  const tbody = box.querySelector(".review-compare tbody");
  tbody.replaceChildren(
    ...rows.map((r) => {
      const tr = document.createElement("tr");
      if (r.differs) tr.className = "differs";
      for (const [tag, text] of [["th", r.label], ["td", fmt(r.submitted, "Not given")], ["td", fmt(r.file, "Not in the file")]]) tr.append(Object.assign(document.createElement(tag), { textContent: text }));
      return tr;
    }),
  );
  tbody.closest(".table-scroll").hidden = false;
}

function drawPlot(node, [x, y]) {
  const axis = { stroke: css("--muted"), grid: { stroke: css("--rule") }, ticks: { stroke: css("--line") } };
  new uPlot(
    {
      width: node.clientWidth || 600,
      height: 200,
      scales: { x: { time: false } },
      axes: [{ ...axis, label: "Energy (eV)" }, { ...axis, size: 56, values: (u, vals) => vals.map(compact.format) }],
      series: [{}, { stroke: css("--plot"), width: 1.25, points: { show: false } }],
      legend: { show: false },
      cursor: { show: false },
    },
    [x, y],
    node,
  );
}

async function run() {
  status.textContent = "Getting the file reader ready…";
  const [py, file, table] = await Promise.all([
    loadReader(),
    fetch(box.dataset.file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`download failed (${r.status})`)))),
    fetch("/eels_binding_energies.json").then((r) => r.json()),
  ]);
  status.textContent = "Reading the file…";
  const path = `/tmp/${input.file.filename.replace(/[^\w.\-]+/g, "_")}`;
  py.FS.writeFile(path, new Uint8Array(file));
  py.globals.set("INPUT", JSON.stringify(input));
  py.globals.set("PATH", path);
  py.globals.set("TABLE", JSON.stringify(table.elements));
  result = JSON.parse(await py.runPythonAsync(PROCESS_PY));
  result.files = Object.entries(result.outputs).map(([role, p]) => [role, new File([py.FS.readFile(p)], p.split("/").pop())]);
  const [lo, hi] = result.plot ? [result.plot[0][0], result.plot[0].at(-1)] : [];
  status.textContent = result.plot
    ? `Read ${result.points} points from ${lo.toFixed(1)} to ${hi.toFixed(1)} eV with RosettaSciIO ${RSCIIO.split("==")[1]}. Approving publishes the MSA, HyperSpy and metadata files made here.`
    : "There is no energy-loss spectrum in this file.";
  if (result.plot) drawPlot(box.querySelector(".review-plot"), result.plot);
  showFindings(box.querySelector(".findings"), result.findings);
  showCompare(result.compare);
}

async function upload() {
  const body = new FormData();
  body.append("record", JSON.stringify(result.record));
  for (const [role, file] of result.files) body.append(role, file);
  const res = await fetch(`/admin/submissions/${box.dataset.id}/processed/`, { method: "POST", body });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `upload failed (${res.status})`);
}

form?.addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "approve" || !result?.files.length || uploaded) return;
  e.preventDefault();
  for (const b of form.querySelectorAll("button")) b.disabled = true;
  status.textContent = "Uploading the processed files…";
  try {
    await upload();
    uploaded = true;
    // form.submit() leaves out the clicked button's value.
    form.append(Object.assign(document.createElement("input"), { type: "hidden", name: "decision", value: "approve" }));
    form.submit();
  } catch (err) {
    status.textContent = `The processed files could not be uploaded (${err.message}). Please try again.`;
    for (const b of form.querySelectorAll("button")) b.disabled = false;
  }
});

run()
  .catch((err) => {
    result = null;
    status.textContent = `Your browser could not read the file (${String(err.message).split("\n").filter(Boolean).pop()}). You can still decide, but approving publishes no processed files.`;
  })
  .finally(() => {
    if (approve) approve.disabled = false;
  });
