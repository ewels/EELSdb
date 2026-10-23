import { SITE_HOST } from "../site";
import METRICS from "./metrics.json";
import LOGO from "../../public/logo/eelsdb-logo-compact-light-bg.svg";
import HERO_LOGO from "../../public/logo/eelsdb-logo-light-bg.svg";
import { formulaTokens, plainName, TYPE_NAMES } from "../pages/layout";
import { majorEdges } from "../preview";

export const W = 1200;
export const H = 630;
const M = 64;

// The light palette from tokens.css as hex: resvg reads neither light-dark() nor oklch().
const C = {
  bg: "#fbfaf8",
  surface: "#ffffff",
  sunken: "#f3f1ed",
  ink: "#1b1a19",
  muted: "#5d5852",
  line: "#e2ddd5",
  rule: "#eeeae4",
  accent: "#345b80",
  plot: "#305880",
  edge: "#ad7130",
  coreloss: "#2769b7",
  lowloss: "#cf7b00",
  xrayabs: "#1f8d54",
  zeroloss: "#5d5852",
};
const FONT = `font-family="Mona Sans"`;

const ADVANCES = METRICS as Record<string, Record<string, number>>;

/** Width of `text` set in Mona Sans at `size` px, from the font's advance widths (no kerning). */
export function textWidth(text: string, size: number, weight = 400, tracking = 0) {
  const table = ADVANCES[weight] ?? ADVANCES[400];
  let em = 0;
  for (const ch of text) em += (table[ch] ?? 0.6) + tracking;
  return em * size;
}

/** Greedy line breaks within `max` px, at most `lines` lines; the last line ends in an ellipsis if text is left over. */
export function wrap(text: string, size: number, weight: number, max: number, lines: number, tracking = 0) {
  const fits = (s: string) => textWidth(s, size, weight, tracking) <= max;
  const out: string[] = [];
  let line = "";
  const words = text.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = words[i];
    if (out.length === lines) {
      line = "";
      out[lines - 1] = ellipsis(`${out[lines - 1]} ${words.slice(i).join(" ")}`, fits);
      break;
    }
  }
  if (line) out.push(fits(line) ? line : ellipsis(line, fits));
  return out;
}

function ellipsis(text: string, fits: (s: string) => boolean) {
  let s = text;
  while (s && !fits(`${s}…`)) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Run = { text: string; size: number; weight?: number; fill?: string; italic?: boolean; shift?: number };

/** One line of runs from `x`, each with its own size, weight and baseline shift (for sub- and superscripts). Returns the end x. */
function runs(x: number, y: number, parts: Run[]): [string, number] {
  let out = "";
  let at = x;
  for (const p of parts) {
    if (!p.text) continue;
    out +=
      `<text x="${at.toFixed(1)}" y="${(y + (p.shift ?? 0)).toFixed(1)}" font-size="${p.size}" font-weight="${p.weight ?? 400}"` +
      `${p.italic ? ` font-style="italic"` : ""} fill="${p.fill ?? C.ink}" ${FONT} xml:space="preserve">${esc(p.text)}</text>`;
    at += textWidth(p.text, p.size, p.weight ?? 400);
  }
  return [out, at];
}

/** A chemical formula as runs, typeset like the Formula component: subscripts at 0.72em, variables in italics. */
function formulaRuns(formula: string, size: number, fill: string, weight = 400): Run[] {
  const small = size * 0.72;
  return formulaTokens(formula).map(([kind, text]) =>
    kind === "text"
      ? { text, size, weight, fill }
      : { text, size: small, weight, fill, italic: kind === "var", shift: kind === "sup" ? -size * 0.38 : size * 0.2 },
  );
}

/** "Ti L2,3" as runs, the subshells subscripted. */
function edgeRuns(label: string, size: number, fill: string, weight: number): Run[] {
  const [element, edge = ""] = label.split(" ");
  return [
    { text: `${element} ${edge[0] ?? ""}`, size, fill, weight },
    { text: edge.slice(1), size: size * 0.72, fill, weight, shift: size * 0.2 },
  ];
}

const runsWidth = (parts: Run[]) => parts.reduce((w, p) => w + textWidth(p.text, p.size, p.weight ?? 400), 0);

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.bg}"/>${body}</svg>`;

/** A logo file from public/logo/ placed at (x, y), `height` px tall. */
function logo(file: string, x: number, y: number, height: number) {
  const box = file.match(/viewBox="([^"]+)"/)![1];
  const [, , w, h] = box.split(" ").map(Number);
  const inner = file.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>.*?<\/title>/, "");
  return `<svg x="${x}" y="${y}" width="${((height * w) / h).toFixed(1)}" height="${height}" viewBox="${box}">${inner}</svg>`;
}
const logoWidth = (file: string, height: number) => {
  const [, , w, h] = file.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
  return (height * w) / h;
};

/** Heading lines in 700 with the site's -0.025em tracking. */
function heading(lines: string[], x: number, y: number, size: number, lead = 1.12) {
  return lines
    .map((l, i) => `<text x="${x}" y="${(y + i * size * lead).toFixed(1)}" font-size="${size}" font-weight="700" letter-spacing="${-0.025 * size}" fill="${C.ink}" ${FONT}>${esc(l)}</text>`)
    .join("");
}

/** The largest size from `sizes` at which `text` fits in `lines` lines of `max` px. */
function fitHeading(text: string, max: number, lines: number, sizes: number[]) {
  for (const size of sizes) {
    const out = wrap(text, size, 700, max, lines, -0.025);
    if (!out.at(-1)!.endsWith("…")) return { size, lines: out };
  }
  const size = sizes.at(-1)!;
  return { size, lines: wrap(text, size, 700, max, lines, -0.025) };
}

// The logo is never smaller than its lettering on the site card.
const LOGO_H = 92;
const LOGO_W = logoWidth(LOGO, LOGO_H);
const LOGO_TOP = M - 14;
/** The compact logo top-right, and the width left for a heading beside it. */
const cornerLogo = () => logo(LOGO, W - M - LOGO_W, LOGO_TOP, LOGO_H);
const BESIDE_LOGO = W - 2 * M - LOGO_W - 48;

const footer = (url: string) => {
  const room = W - 2 * M;
  return runs(M, H - 50, [{ text: textWidth(url, 22) > room ? ellipsis(url, (s) => textWidth(s, 22) <= room) : url, size: 22, fill: C.muted }])[0];
};

/** Bucket means of y, at most `n` points, so a long spectrum keeps its shape without thousands of path nodes. */
function downsample(x: number[], y: number[], n: number): [number[], number[]] {
  if (x.length <= n) return [x, y];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [Math.floor((i * x.length) / n), Math.floor(((i + 1) * x.length) / n)];
    let sx = 0;
    let sy = 0;
    for (let j = a; j < b; j++) {
      sx += x[j];
      sy += y[j];
    }
    xs.push(sx / (b - a));
    ys.push(sy / (b - a));
  }
  return [xs, ys];
}

/** About five round ticks across [lo, hi]. */
export function ticks(lo: number, hi: number, count = 5) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const fmtNumber = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-GB") : String(v));

/** A plot of (x, y) in the box, with major edge markers labelled above it and an energy axis below. */
function plot(x: number[], y: number[], elements: string[], box: { left: number; right: number; top: number; bottom: number }, type: string) {
  const [xs, ys] = downsample(x, y, 700);
  const [e0, e1] = [xs[0], xs[xs.length - 1]];
  const lo = Math.min(...ys);
  let hi = Math.max(...ys);
  // A zero-loss peak dwarfs the low-loss structure; scale to the loss region and let the peak run off the top.
  const tail = Math.max(...ys.filter((_, i) => xs[i] > 8));
  if (type === "lowloss" && tail - lo < 0.25 * (hi - lo)) hi = lo + (tail - lo) / 0.8;
  const span = hi - lo || 1;
  const X = (e: number) => box.left + ((e - e0) / (e1 - e0)) * (box.right - box.left);
  const Y = (v: number) => box.bottom - ((v - lo) / span) * (box.bottom - box.top);
  const d = "M" + xs.map((e, i) => `${X(e).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join("L");
  let out = "";
  const labelY = box.top - 22;
  let lastLabel = -Infinity;
  for (const edge of majorEdges(elements, e0, e1).sort((a, b) => a.energy - b.energy)) {
    const ex = X(edge.energy);
    out += `<line x1="${ex.toFixed(1)}" x2="${ex.toFixed(1)}" y1="${box.top - 10}" y2="${box.bottom}" stroke="${C.edge}" stroke-width="2" stroke-dasharray="6 6"/>`;
    const label = edgeRuns(edge.label, 24, C.edge, 600);
    const w = runsWidth(label);
    const lx = Math.min(Math.max(ex - w / 2, M), W - M - w);
    if (lx < lastLabel + 16) continue;
    out += runs(lx, labelY, label)[0];
    lastLabel = lx + w;
  }
  out += `<clipPath id="plot"><rect x="0" y="${box.top - 40}" width="${W}" height="${box.bottom - box.top + 40}"/></clipPath><g clip-path="url(#plot)">`;
  out += `<path d="${d}L${box.right},${box.bottom}L${box.left},${box.bottom}Z" fill="${C.plot}" fill-opacity="0.09"/>`;
  out += `<path d="${d}" fill="none" stroke="${C.plot}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/></g>`;
  out += `<line x1="0" x2="${W}" y1="${box.bottom}" y2="${box.bottom}" stroke="${C.line}" stroke-width="2"/>`;
  const marks = ticks(e0, e1).filter((v) => X(v) > M + 10 && X(v) < W - M - 40);
  marks.forEach((v, i) => {
    const tx = X(v);
    const label = i === marks.length - 1 ? `${signed(v)} eV` : signed(v);
    const w = textWidth(label, 20);
    out += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${box.bottom}" y2="${box.bottom + 8}" stroke="${C.muted}" stroke-width="1.5"/>`;
    out += runs(tx - (i === marks.length - 1 ? textWidth(signed(v), 20) / 2 : w / 2), box.bottom + 32, [{ text: label, size: 20, fill: C.muted }])[0];
  });
  return out;
}

const typeDot = (x: number, y: number, size: number, type: string) =>
  `<circle cx="${(x + size * 0.25).toFixed(1)}" cy="${(y - size * 0.33).toFixed(1)}" r="${(size * 0.25).toFixed(1)}" fill="${C[type as keyof typeof C] ?? C.muted}"/>`;

const signed = (v: number) => (v < 0 ? `−${fmtNumber(-v)}` : fmtNumber(v));
const range = (a: number, b: number) => `${signed(Math.round(a))}${a < 0 ? " to " : "–"}${signed(Math.round(b))} eV`;

export type SpectrumCard = {
  title: string;
  formula: string | null;
  type: string;
  author: string | null;
  year: string | null;
  slug: string;
  elements: string[];
  data: [number[], number[]] | null;
};

export function spectrumCard(s: SpectrumCard) {
  const { size, lines } = fitHeading(s.title, BESIDE_LOGO, 2, [64, 56, 50, 44]);
  let body = cornerLogo() + heading(lines, M, M + size * 0.85, size);
  const metaY = M + size * 0.85 + (lines.length - 1) * size * 1.12 + 52;
  const meta: Run[] = [];
  if (s.formula) meta.push(...formulaRuns(s.formula, 30, C.ink, 500), { text: "     ", size: 30 });
  let [out, x] = runs(M, metaY, meta);
  body += out + typeDot(x, metaY, 30, s.type);
  const tail: Run[] = [{ text: TYPE_NAMES[s.type] ?? s.type, size: 30, fill: C.muted }];
  if (s.data && s.data[0].length > 1) tail.push({ text: `  ·  ${range(s.data[0][0], s.data[0].at(-1)!)}`, size: 30, fill: C.muted });
  body += runs(x + 30 * 0.5 + 10, metaY, tail)[0];
  if (s.data && s.data[0].length > 1) body += plot(s.data[0], s.data[1], s.elements, { left: 0, right: W, top: metaY + 78, bottom: H - 106 }, s.type);
  const credit: Run[] = s.author
    ? [{ text: "Shared by ", size: 22, fill: C.muted }, { text: plainName(s.author), size: 22, weight: 600 }, { text: s.year ? ` · ${s.year}` : "", size: 22, fill: C.muted }]
    : [{ text: `${SITE_HOST}/spectra/${s.slug}/`, size: 22, fill: C.muted }];
  body += runs(M, H - 44, credit)[0];
  return svg(body);
}

export type Mini = { title: string; formula: string | null; type: string; data: [number[], number[]] };

export type AuthorCard = { name: string; facts: string; count: number; since: string | null; slug: string; spectra: Mini[] };

export function authorCard(a: AuthorCard) {
  const { size, lines } = fitHeading(a.name, BESIDE_LOGO, 1, [72, 64, 56, 48]);
  let body = cornerLogo() + heading(lines, M, M + size * 0.85, size);
  let y = M + size * 0.85 + 50;
  const count = a.count === 1 ? "1 spectrum" : `${a.count} spectra`;
  const sentence = a.count ? `${count} shared${a.since ? ` since ${a.since}` : ""}` : "Author on the EELS Data Base";
  body += runs(M, y, [{ text: sentence, size: 30, fill: C.ink }])[0];
  if (a.facts) {
    y += 42;
    body += runs(M, y, [{ text: wrap(a.facts, 26, 400, W - 2 * M, 1)[0], size: 26, fill: C.muted }])[0];
  }
  const tiles = a.spectra.slice(0, 3);
  if (tiles.length) {
    const gap = 20;
    const tw = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length;
    const top = y + 44;
    const bottom = H - 100;
    tiles.forEach((t, i) => {
      const left = M + i * (tw + gap);
      body += `<rect x="${left}" y="${top}" width="${tw}" height="${bottom - top}" rx="8" fill="${C.surface}" stroke="${C.line}" stroke-width="1.5"/>`;
      const name = wrap(t.title, 22, 600, tw - 40, 1)[0];
      body += runs(left + 20, top + 40, [{ text: name, size: 22, weight: 600 }])[0];
      const meta = t.formula ? formulaRuns(t.formula, 18, C.muted) : [];
      const [m, mx] = runs(left + 20, top + 68, meta);
      body += m + typeDot(mx + (meta.length ? 12 : 0), top + 68, 18, t.type);
      body += runs(mx + (meta.length ? 12 : 0) + 18, top + 68, [{ text: TYPE_NAMES[t.type] ?? t.type, size: 18, fill: C.muted }])[0];
      const [xs, ys] = downsample(t.data[0], t.data[1], 240);
      const lo = Math.min(...ys);
      const span = Math.max(...ys) - lo || 1;
      const [pl, pr, pt, pb] = [left + 1, left + tw - 1, top + 96, bottom - 1];
      const d = "M" + xs.map((e, j) => `${(pl + ((e - xs[0]) / (xs.at(-1)! - xs[0])) * (pr - pl)).toFixed(1)},${(pb - ((ys[j] - lo) / span) * (pb - pt)).toFixed(1)}`).join("L");
      body += `<path d="${d}L${pr},${pb}L${pl},${pb}Z" fill="${C.plot}" fill-opacity="0.09"/>`;
      body += `<path d="${d}" fill="none" stroke="${C.plot}" stroke-width="2.5" stroke-linejoin="round"/>`;
    });
  }
  return svg(body + footer(`${SITE_HOST}/author/${a.slug}/`));
}

// The periodic table as on the homepage, with the lanthanides and actinides in their own rows.
const TABLE = [
  "H . . . . . . . . . . . . . . . . He",
  "Li Be . . . . . . . . . . B C N O F Ne",
  "Na Mg . . . . . . . . . . Al Si P S Cl Ar",
  "K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr",
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe",
  "Cs Ba . Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn",
  "Fr Ra . Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og",
  ". . La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu",
  ". . Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr",
].map((row) => row.split(" "));

// The homepage's six shade steps: accent mixed into surface at these shares.
const SHADES = [0.12, 0.22, 0.36, 0.52, 0.7, 1];
const mix = (share: number) => {
  const [a, b] = [C.surface, C.accent].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * share).toString(16).padStart(2, "0")).join("");
};

export type SiteCard = { spectra: number; contributors: number; since: string | null; elements: Record<string, number>; title?: string };

export function siteCard(s: SiteCard) {
  let body = logo(HERO_LOGO, M - 4, M - 6, 150);
  const sentence = `${s.spectra} spectra from ${s.contributors} microscopists${s.since ? `, shared since ${s.since}` : ""}.`;
  const leadSize = s.title ? 52 : 34;
  const lead = s.title ? [s.title] : wrap("Open reference spectra for electron energy-loss and X-ray absorption spectroscopy.", leadSize, 600, 440, 4, -0.02);
  const facts = wrap(sentence, 24, 400, 440, 2);
  let y = H - M - facts.length * 34 - 24 - (lead.length - 1) * leadSize * 1.2;
  for (const line of lead) {
    body += `<text x="${M}" y="${y.toFixed(1)}" font-size="${leadSize}" font-weight="${s.title ? 700 : 600}" letter-spacing="${-0.02 * leadSize}" fill="${C.ink}" ${FONT}>${esc(line)}</text>`;
    y += leadSize * 1.2;
  }
  y += 18;
  for (const line of facts) {
    body += runs(M, y, [{ text: line, size: 24, fill: C.muted }])[0];
    y += 34;
  }
  const cell = 32;
  const gap = 3;
  const left = W - M - 18 * cell - 17 * gap;
  const top = M;
  const max = Math.max(1, ...Object.values(s.elements));
  TABLE.forEach((row, r) => {
    row.forEach((sym, col) => {
      if (sym === ".") return;
      const n = s.elements[sym] ?? 0;
      const step = n ? Math.min(6, 1 + Math.floor((Math.log(n) / Math.log(max)) * 5.999)) : 0;
      const x = left + col * (cell + gap);
      const yy = top + r * (cell + gap) + (r >= 7 ? 16 : 0);
      body += `<rect x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="3" fill="${step ? mix(SHADES[step - 1]) : C.sunken}"/>`;
      const label = step >= 5 ? "#ffffff" : step ? C.ink : "#b8b1a8";
      body += `<text x="${x + 4}" y="${yy + 15}" font-size="12" font-weight="600" fill="${label}" ${FONT}>${sym}</text>`;
    });
  });
  const keyY = H - M - 24 - 34 + 24;
  const rampLeft = W - M - SHADES.length * 34 + 4 - textWidth(String(max), 18) - 10;
  body += runs(left, keyY, [{ text: "Spectra per element", size: 20, fill: C.muted }])[0];
  body += runs(rampLeft - textWidth("1", 18) - 10, keyY, [{ text: "1", size: 18, fill: C.muted }])[0];
  SHADES.forEach((share, i) => {
    body += `<rect x="${rampLeft + i * 34}" y="${keyY - 17}" width="30" height="20" rx="3" fill="${mix(share)}"/>`;
  });
  body += runs(rampLeft + SHADES.length * 34 + 6, keyY, [{ text: String(max), size: 18, fill: C.muted }])[0];
  return svg(body);
}

export type TextCard = { title: string; description?: string; url: string; traces: [number[], number[]][] };

/**
 * A titled page, with real spectra from the database stacked as a waterfall on the right: the way a line
 * profile through a spectrum image is drawn, and the site's own data rather than decoration.
 */
export function textCard(t: TextCard) {
  const textMax = 580;
  let body = waterfall(t.traces, 700, W + 4, 72, H - 72) + logo(LOGO, M, LOGO_TOP, LOGO_H);
  const { size, lines } = fitHeading(t.title, textMax, 3, [68, 60, 54, 48]);
  const desc = t.description ? wrap(t.description, 26, 400, textMax, 3) : [];
  const block = lines.length * size * 1.1 + (desc.length ? 26 + desc.length * 36 : 0);
  const free = LOGO_TOP + LOGO_H + 24;
  let y = Math.max(free, (free + H - 92) / 2 - block / 2) + size * 0.8;
  body += heading(lines, M, y, size, 1.1);
  y += (lines.length - 1) * size * 1.1 + 52;
  for (const line of desc) {
    body += runs(M, y, [{ text: line, size: 26, fill: C.muted }])[0];
    y += 36;
  }
  return svg(body + footer(t.url));
}

function waterfall(traces: [number[], number[]][], left: number, right: number, top: number, bottom: number) {
  if (!traces.length) return "";
  const fade = `<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></linearGradient>`;
  const step = Math.min(26, (bottom - top - 120) / Math.max(1, traces.length - 1));
  const amp = bottom - top - step * (traces.length - 1);
  let out = "";
  // Back to front, each trace filled with paper so it hides the ones behind it.
  traces.forEach(([x, y], i) => {
    const [xs, ys] = downsample(x, y, 160);
    const lo = Math.min(...ys);
    const span = Math.max(...ys) - lo || 1;
    const base = top + amp + i * step;
    const X = (e: number) => left + ((e - xs[0]) / (xs.at(-1)! - xs[0])) * (right - left);
    const d = "M" + xs.map((e, j) => `${X(e).toFixed(1)},${(base - ((ys[j] - lo) / span) * amp * 0.82).toFixed(1)}`).join("L");
    const front = i === traces.length - 1;
    out += `<path d="${d}L${right},${base}L${left},${base}Z" fill="${C.bg}"/>`;
    out += front
      ? `<path d="${d}L${right},${base}L${left},${base}Z" fill="${C.plot}" fill-opacity="0.09"/><path d="${d}" fill="none" stroke="${C.plot}" stroke-width="3" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="none" stroke="${i % 4 === 0 ? "#c9c2b8" : C.line}" stroke-width="1.75" stroke-linejoin="round"/>`;
  });
  return `${out}${fade}<rect x="${left - 1}" y="${top - 40}" width="160" height="${bottom - top + 41}" fill="url(#fade)"/>`;
}
