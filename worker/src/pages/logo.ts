// Traces from logo/EELSdb_logo.svg. The lettering is live Mona Sans text in currentColor, so it follows the theme.
const RED = "M8.975,149.924c1.525,0,1.616-2.979,2.292-11.534 c1.24-15.707,2.823-29.341,6.208-30.993c8.078-3.943,7.332-61.687,15-62c2.661-0.109,2.328,10.391,7,10c10.641-0.891,5.828-46,17-46 c13.494,0,19.328,93.557,34,93c15.201-0.578,13.761-15.041,22.001-15c11.465,0.056,11.581,61.37,73.898,66.669 c1.971,0.167,258.765-1.117,260.862-1.065";
const OCHRE = "M8.975,149.924 c25.75-0.079,40.003,0.77,48.775,0.326c10.484-0.53,12.811-2.435,13.078-3.542c2.767-11.43,2.056-49.396,6.146-49.267 c4.819,0.153,1.181,40.096,7,39.834s0.843-123.072,8-123.072c3.153,0,5,28.631,7,28.631s2-1.867,4-1.245s1.006,10.122,7,9.958 c1.978-0.054,2.851-1.033,4-1.245c3.366-0.621,7.181,5.241,13,14.938s2.847,62.503,18,62.864c15.153,0.36,12.514-10.482,27-10.54 c16.525-0.065,14.399,36.5,61.693,36.515c29.6,0.009,53.017-2.192,213.568-1.08";

const traces = (tail = "") =>
  `<path class="trace" fill="none" style="stroke:var(--logo-red)" stroke-width="2" d="${RED}${tail}"/>` +
  `<path class="trace" fill="none" style="stroke:var(--logo-ochre)" stroke-width="2" d="${OCHRE}${tail}"/>`;

const lettering = (x: number, y: number, size: number) =>
  `<text class="lettering" x="${x}" y="${y}" text-anchor="end" font-size="${size}" fill="currentColor" style="font-family:'Mona Sans',system-ui,sans-serif;letter-spacing:-0.01em"><tspan font-weight="800">EELS</tspan><tspan font-weight="400">db</tspan></text>`;

/**
 * Header mark: bigger lettering centred on the traces, with the flat tails run out to make room.
 * No tagline: it is unreadable at this size.
 */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6.97 7.4 486.74 149.8" role="img" aria-label="EELSdb">${lettering(491.71, 114.2, 90.53)}${traces("h44.47")}</svg>`;

/** Homepage mark: lettering on the tail, the tagline beneath, and the hooks for the scan animation in style.css. */
export const HERO_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6.97 7.4 442.26 173.23" role="img" aria-label="EELSdb: Inner &amp; Outer Shell Excitation Spectrum Repository"><defs><clipPath id="scan-window"><rect class="scan-window" x="6.97" y="7.4" width="442.26" height="173.23"/></clipPath></defs>${lettering(447.24, 143, 63.28)}<text class="tagline" x="8.97" y="175.56" textLength="438.26" lengthAdjust="spacing" font-size="18.36" font-weight="400" fill="currentColor" style="font-family:'Mona Sans',system-ui,sans-serif">Inner &amp; Outer Shell Excitation Spectrum Repository</text><g clip-path="url(#scan-window)">${traces()}</g><line class="scan-head" x1="8.975" y1="9.4" x2="8.975" y2="178.63"/></svg>`;
