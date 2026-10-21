import BINDING from "../public/eels_binding_energies.json";

const ONSETS = BINDING.elements as Record<string, Record<string, { "onset_energy (eV)": number; relevance: string }>>;

/** Spectrum file text to [energy, counts]. Keep in step with parseSpectrum() in public/spectrum.js. */
export function parseSpectrum(text: string): [number[], number[]] {
  const header: Record<string, string> = {};
  const x: number[] = [];
  const y: number[] = [];
  let inData = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(/^#([A-Z0-9 -]+?)\s*:\s*(.*)$/i);
      if (m) header[m[1].trim().toUpperCase()] = m[2].trim();
      if (/^#SPECTRUM/i.test(line)) inData = true;
      if (/^#ENDOFDATA/i.test(line)) break;
      continue;
    }
    if (!/^[-+.\d]/.test(line)) continue;
    const nums = line.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.some(Number.isNaN)) continue;
    if (inData && (header.DATATYPE || "").toUpperCase() === "Y") y.push(...nums);
    else if (nums.length >= 2) {
      x.push(nums[0]);
      y.push(nums[1]);
    }
  }
  if (!x.length) {
    const offset = parseFloat(header.OFFSET) || 0;
    const step = parseFloat(header.XPERCHAN) || 1;
    for (let i = 0; i < y.length; i++) x.push(offset + step * i);
  }
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return [order.map((i) => x[i]), order.map((i) => y[i])];
}

/**
 * Major edges of the elements inside [e0, e1]. Subshells of one shell within 10 eV share a marker at the lowest onset
 * (Ti L3 and L2 become "Ti L2,3"); further apart they get their own (Ni L3, Ni L2). The spectrum page marks the same exSpy edges.
 */
export function majorEdges(elements: string[], e0: number, e1: number) {
  const out: { energy: number; label: string }[] = [];
  for (const element of elements) {
    const shells = new Map<string, { energy: number; sub: string }[]>();
    for (const [name, info] of Object.entries(ONSETS[element] ?? {})) {
      const energy = info["onset_energy (eV)"];
      if (info.relevance !== "Major" || !(energy > e0 && energy < e1)) continue;
      shells.set(name[0], [...(shells.get(name[0]) ?? []), { energy, sub: name.slice(1) }]);
    }
    for (const [letter, subs] of shells) {
      subs.sort((a, b) => a.energy - b.energy);
      let group = [subs[0]];
      const flush = () => out.push({ energy: group[0].energy, label: `${element} ${letter}${group.map((g) => g.sub).sort().join(",")}` });
      for (const s of subs.slice(1)) {
        if (s.energy - group[0].energy <= 10) group.push(s);
        else {
          flush();
          group = [s];
        }
      }
      flush();
    }
  }
  return out;
}


/** A spectrum thumbnail: the energy span and up to POINTS bucket means scaled to 0–100. */
export type Preview = { e: [number, number]; y: number[] };
const POINTS = 150;

export function makePreview(text: string): Preview | null {
  const [x, y] = parseSpectrum(text);
  if (x.length < 2) return null;
  const n = Math.min(POINTS, x.length);
  const means = Array.from({ length: n }, (_, i) => {
    const [a, b] = [Math.floor((i * y.length) / n), Math.floor(((i + 1) * y.length) / n)];
    let sum = 0;
    for (let j = a; j < b; j++) sum += y[j];
    return sum / (b - a);
  });
  const lo = Math.min(...means);
  const span = Math.max(...means) - lo || 1;
  return { e: [x[0], x[x.length - 1]], y: means.map((v) => Math.round(((v - lo) / span) * 100)) };
}

type PreviewRow = { id: number; file: string | null; preview: string | null; preview_key: string | null };
// ponytail: fills at most this many missing thumbnails per request, to stay inside the subrequest limit; the rest fill on later visits.
const FILL_PER_REQUEST = 40;

/**
 * Thumbnails for these rows, read from D1. A missing or stale one (its file changed) is built from R2 and stored,
 * so no upload path has to remember to make it.
 */
export async function previews(env: { DB: D1Database; FILES: R2Bucket }, ctx: { waitUntil(p: Promise<unknown>): void }, rows: PreviewRow[]) {
  const out = new Map<number, Preview>();
  const stale: PreviewRow[] = [];
  for (const r of rows) {
    if (!r.file) continue;
    if (r.preview_key !== r.file) stale.push(r);
    else if (r.preview) out.set(r.id, JSON.parse(r.preview));
  }
  const built = await Promise.all(
    stale.slice(0, FILL_PER_REQUEST).map(async (r) => {
      const object = await env.FILES.get(r.file!);
      return { r, p: object ? makePreview(await object.text()) : null };
    }),
  );
  for (const { r, p } of built) if (p) out.set(r.id, p);
  if (built.length)
    ctx.waitUntil(
      env.DB.batch(
        built.map(({ r, p }) => env.DB.prepare("UPDATE spectra SET preview = ?, preview_key = ? WHERE id = ?").bind(p && JSON.stringify(p), r.file, r.id)),
      ),
    );
  return out;
}
