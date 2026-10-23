// View-only processing for the spectrum page, matching exSpy's results (see data/fixtures/process.json).

const nearest = (x, v) => {
  let best = 0;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - v) < Math.abs(x[best] - v)) best = i;
  return best;
};

/**
 * Power-law background A·E^-r over the whole energy range, estimated from the window [lo, hi] by the two-area method
 * as exSpy's remove_background(signal_range=(lo, hi)) does. Null when the window is too narrow or the fit fails.
 */
export function powerLaw(x, y, lo, hi) {
  let i1 = nearest(x, lo);
  let i4 = nearest(x, hi);
  if ((i1 + i4) % 2) i4--;
  if (i4 === i1) i4 += 2;
  if (i4 <= i1 || i4 >= x.length) return null;
  const i3 = (i1 + i4) / 2;
  let I1 = 0;
  let I2 = 0;
  for (let i = i1; i < i3; i++) I1 += y[i];
  for (let i = i3; i < i4; i++) I2 += y[i];
  const [x1, x2, x3, x4] = [x[i1], x[i3], x[i3], x[i4]];
  const r = (2 * Math.log(((I1 / I2) * (x4 - x3)) / (x2 - x1))) / Math.log((x4 * x3) / x2 / x1);
  const k = 1 - r;
  const A1 = (k * I1) / (x2 ** k - x1 ** k);
  const A2 = (k * I2) / (x4 ** k - x3 ** k);
  const A = (A1 * I1 + A2 * I2) / (I1 + I2);
  if (!Number.isFinite(A) || !Number.isFinite(r)) return null;
  // exSpy treats EELS counts as binned: A comes from plain sums and the model is multiplied by the channel width.
  const step = (x.at(-1) - x[0]) / (x.length - 1);
  return x.map((e) => A * e ** -r * step);
}

/** Solve a small dense system by Gaussian elimination with partial pivoting. */
function solve(M, b) {
  const n = b.length;
  const a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const out = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * out[k];
    out[r] = s / a[r][r];
  }
  return out;
}

/** Least-squares polynomial of the given order through (t, v), evaluated at each of `at`. */
function polyAt(t, v, order, at) {
  const n = order + 1;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  t.forEach((ti, j) => {
    for (let r = 0; r < n; r++) {
      b[r] += v[j] * ti ** r;
      for (let c = 0; c < n; c++) M[r][c] += ti ** (r + c);
    }
  });
  const coef = solve(M, b);
  return at.map((a) => coef.reduce((s, c, p) => s + c * a ** p, 0));
}

/** Savitzky–Golay smoothing like scipy's savgol_filter (mode "interp"), which exSpy's smooth_savitzky_golay uses. */
export function savitzkyGolay(y, window, order) {
  const n = y.length;
  if (window > n || window <= order) return y.slice();
  const h = (window - 1) / 2;
  const t = Array.from({ length: window }, (_, j) => j - h);
  // Fitting a unit impulse at each window position gives the convolution weights for the centre point.
  const weights = t.map((_, j) => polyAt(t, t.map((_, k) => +(k === j)), order, [0])[0]);
  const out = new Array(n);
  for (let i = h; i < n - h; i++) {
    let s = 0;
    for (let j = 0; j < window; j++) s += weights[j] * y[i - h + j];
    out[i] = s;
  }
  const ends = Array.from({ length: h }, (_, j) => j - h);
  polyAt(t, y.slice(0, window), order, ends).forEach((v, j) => (out[j] = v));
  polyAt(t, y.slice(n - window), order, ends.map((e) => -e)).forEach((v, j) => (out[n - 1 - j] = v));
  return out;
}

/** Background, then smoothing, then normalisation. `fit` is the background on the same scale as `y`, for drawing. */
export function processSpectrum(x, y, { background, window, smooth, normalise }) {
  let fit = background ? powerLaw(x, y, window[0], window[1]) : null;
  let out = background === "subtract" && fit ? y.map((v, i) => v - fit[i]) : y.slice();
  if (smooth) out = savitzkyGolay(out, smooth, 2);
  const f = normalise === "max" ? Math.max(...out) : normalise === "area" ? out.reduce((s, v) => s + v, 0) : 1;
  if (f !== 1 && f) {
    out = out.map((v) => v / f);
    fit = fit?.map((v) => v / f);
  }
  return { y: out, fit };
}
