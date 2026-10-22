// Spike: can RosettaSciIO, exSpy and eelsdb.checks run in Pyodide? Records download size, load time
// and failures. Run with `node spike.mjs [file.msa]` after `npm install`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadPyodide } from "pyodide";

const root = new URL("../../", import.meta.url).pathname;
const msa = process.argv[2] ?? join(root, "data/cache/files/wp-content/uploads/2015/09/Dspec.556981.1.msa");

const dirBytes = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => statSync(join(dir, f)))
    .filter((s) => s.isFile())
    .reduce((n, s) => n + s.size, 0);
const pyodideDir = new URL("./node_modules/pyodide/", import.meta.url).pathname;
const mb = (b) => (b / 1e6).toFixed(1) + " MB";
const before = dirBytes(pyodideDir);
const t0 = performance.now();
const step = (label) => console.log(`${label}: ${((performance.now() - t0) / 1000).toFixed(1)} s, cache ${mb(dirBytes(pyodideDir) - before)} new`);

const py = await loadPyodide();
step("pyodide core");
await py.loadPackage(["micropip", "numpy"]);
step("numpy");

const micropip = py.pyimport("micropip");
for (const pkg of ["rosettasciio", "exspy"]) {
  try {
    await micropip.install(pkg);
    step(`micropip ${pkg}`);
  } catch (e) {
    console.log(`micropip ${pkg} FAILED: ${String(e).split("\n").slice(-3).join(" | ")}`);
  }
}

py.FS.mkdirTree("/home/pyodide/eelsdb");
for (const f of ["__init__.py", "checks.py", "io.py", "_elements.py"]) {
  const src = f === "__init__.py" ? "" : readFileSync(join(root, "python/eelsdb", f), "utf8");
  py.FS.writeFile(`/home/pyodide/eelsdb/${f}`, src);
}
py.FS.writeFile("/home/pyodide/spectrum.msa", readFileSync(msa));

const tries = {
  "import rsciio + read MSA": `
from eelsdb.io import read_spectrum
sp = read_spectrum("/home/pyodide/spectrum.msa")
f"{sp.energy.size} points, {sp.energy[0]:.1f}-{sp.energy[-1]:.1f} eV"`,
  "eelsdb.checks.run_all (pinned edge table)": `
import json
from eelsdb import checks
table = {"Al": {"K": {"onset_energy (eV)": 1560.0, "relevance": "Major"}}}
[f.code for f in checks.run_all(sp.energy, sp.intensity, spectrum_type="coreloss", formula="AlN",
                                edges=["Al_K"], elements=["Al"], edge_table=table, header_axis=sp.header_axis)]`,
  "load h5py from the Pyodide distribution": `
import pyodide_js
await pyodide_js.loadPackage("h5py")
import h5py
h5py.__version__`,
  "import exspy": `
import exspy
exspy.__version__`,
  "exspy edge table": `
from eelsdb import checks
len(checks.exspy_edge_table())`,
};
for (const [label, code] of Object.entries(tries)) {
  try {
    const out = await py.runPythonAsync(code);
    step(`${label} -> ${out}`);
  } catch (e) {
    console.log(`${label} FAILED: ${String(e).trim().split("\n").filter((l) => /Error/.test(l)).slice(-2).join(" | ")}`);
  }
}
console.log("installed:", py.runPython("import micropip; ', '.join(sorted(micropip.list().keys()))"));
