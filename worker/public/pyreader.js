// Pyodide with RosettaSciIO and the eelsdb package (served from /py/), shared by the submit form and the spectrum page.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
export const RSCIIO = "rosettasciio==0.15.0";

let ready;
export function loadReader() {
  ready ??= (async () => {
    const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: PYODIDE });
    await py.loadPackage(["numpy", "micropip", "h5py"]);
    await py.pyimport("micropip").install(RSCIIO);
    py.FS.mkdirTree("/home/pyodide/eelsdb");
    py.FS.writeFile("/home/pyodide/eelsdb/__init__.py", "");
    for (const f of ["checks.py", "io.py", "_elements.py"]) {
      py.FS.writeFile(`/home/pyodide/eelsdb/${f}`, await (await fetch(`/py/eelsdb/${f}`)).text());
    }
    return py;
  })();
  return ready;
}

/** [energies, intensities] from any file eelsdb.io reads. Spectrum images come back summed. */
export async function readXY(file) {
  const py = await loadReader();
  const path = `/tmp/compare-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  py.FS.writeFile(path, new Uint8Array(await file.arrayBuffer()));
  const out = JSON.parse(
    await py.runPythonAsync(`
import json, numpy as np
from eelsdb.io import read_any
sp = read_any(${JSON.stringify(path)})
json.dumps(None if sp.energy is None else [sp.energy.tolist(), np.nan_to_num(sp.intensity).tolist()])
`),
  );
  py.FS.unlink(path);
  if (!out) throw new Error("There is no energy-loss spectrum in this file.");
  return out;
}
