import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import type { User } from "../auth";
import { LOGO_SVG } from "./logo";

const NAV = [
  ["/spectra/", "Browse"],
  ["/submit-data/", "Submit"],
  ["/news/", "News"],
  ["/api/", "API"],
  ["/about/", "About"],
] as const;

// Runs before paint so a saved theme choice does not flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;
const TOGGLE_SCRIPT = `document.querySelector(".theme-toggle").addEventListener("click",function(){var r=document.documentElement,d=r.dataset.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),n=d==="dark"?"light":"dark";r.dataset.theme=n;try{localStorage.setItem("theme",n)}catch(e){}})`;

export function Layout(props: {
  title?: string;
  description?: string;
  path: string;
  user: User | null;
  head?: Child;
  wide?: boolean;
  children: Child;
}) {
  const wrap = props.wide ? "wrap wide" : "wrap";
  const title = props.title ? `${props.title} · EELS Data Base` : "EELS Data Base";
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta
          name="description"
          content={props.description ?? "Open database of electron energy-loss (EELS) and X-ray absorption (XAS) spectra."}
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preload" href="/fonts/roboto-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
        <link rel="stylesheet" href="/style.css" />
        <script>{raw(THEME_SCRIPT)}</script>
        {props.head}
      </head>
      <body>
        <a class="skip" href="#main">Skip to content</a>
        <header class="site-header">
          <div class={wrap}>
            {props.path !== "/" && <a class="logo" href="/" aria-label="EELS Data Base home">{raw(LOGO_SVG)}</a>}
            <nav class="site-nav" aria-label="Main">
              {NAV.map(([href, label]) => (
                <a href={href} aria-current={props.path.startsWith(href) ? "page" : undefined}>{label}</a>
              ))}
              {props.user ? (
                <a href="/account/" aria-current={props.path.startsWith("/account/") ? "page" : undefined}>{props.user.display_name}</a>
              ) : (
                <a href={`/login/${props.path && props.path !== "/login/" ? `?next=${encodeURIComponent(props.path)}` : ""}`}>Sign in</a>
              )}
              <button class="theme-toggle" type="button" aria-label="Switch light or dark theme" title="Switch theme">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
                </svg>
              </button>
            </nav>
          </div>
        </header>
        <main id="main" class={wrap}>{props.children}</main>
        <footer class="site-footer">
          <div class={wrap}>
            <span>
              EELS Data Base · <a href="/citation/">How to cite</a> · <a href="/instruments/">Instrument profiles</a> ·{" "}
              <a href="/downloads/">Download everything</a> ·{" "}
              <a href="/contact/">Contact</a>
            </span>
            <span>
              Data under the <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a> ·{" "}
              <a href="https://github.com/ewels/EELSdb">Source code</a>
            </span>
          </div>
        </footer>
        <script>{raw(TOGGLE_SCRIPT)}</script>
      </body>
    </html>
  );
}

export const TYPE_NAMES: Record<string, string> = {
  coreloss: "Core loss",
  lowloss: "Low loss",
  zeroloss: "Zero loss",
  xrayabs: "X-ray absorption",
};

export const TypeBadge = (props: { type: string }) => (
  <span class={`type type-${props.type}`}>{TYPE_NAMES[props.type] ?? props.type}</span>
);

const GREEK: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ" };

export type FormulaToken = [kind: "text" | "sub" | "sup" | "var", value: string];

/**
 * Split a hand-typed formula into text, subscripts and superscripts.
 * Contributors write `TiO2`, `TaS_2`, `La{0.8}`, `Fe^{3+}`, `(C2H4)n`, `CePrOx` or `Zircaloy-4`;
 * a number is a stoichiometry only straight after an element or a closing bracket.
 */
export function formulaTokens(formula: string): FormulaToken[] {
  const out: FormulaToken[] = [];
  const push = (kind: FormulaToken[0], value: string) => {
    const last = out[out.length - 1];
    if (last && last[0] === kind && kind === "text") last[1] += value;
    else out.push([kind, value]);
  };
  const s = formula.replace(/\b(alpha|beta|gamma|delta)\b/gi, (w) => GREEK[w.toLowerCase()]);
  const re = /_\{([^}]*)\}|_(\d+(?:\.\d+)?|[a-z])|\^\{([^}]*)\}|\^(\d*[+-])|\{([^}]*)\}|(\d+(?:\.\d+)?)|([nmxy])|([\s\S])/g;
  for (let m: RegExpExecArray | null; (m = re.exec(s)); ) {
    const prev = s[m.index - 1] ?? "";
    const next = s[m.index + m[0].length] ?? "";
    const afterElement = /[A-Za-z)\]]/.test(prev);
    if (m[1] !== undefined || m[2] !== undefined || m[5] !== undefined) {
      const v = m[1] ?? m[2] ?? m[5];
      push(/^[nmxy]$/.test(v) ? "var" : "sub", v);
    } else if (m[3] !== undefined || m[4] !== undefined) push("sup", m[3] ?? m[4]);
    else if (m[6] !== undefined) push(afterElement ? "sub" : "text", m[6]);
    else if (m[7] !== undefined) {
      // n, m after a bracket (polymers); x, y after an element (no element symbol ends in x; Dy is the only one in y).
      const variable = !/[a-z]/.test(next) && (prev === ")" || (/[xy]/.test(m[7]) && /[A-Z\d]/.test(prev) && !(m[7] === "y" && prev === "D")));
      push(variable ? "var" : "text", m[7]);
    } else push("text", m[8]);
  }
  return out;
}

export const Formula = (props: { formula: string | null }) => {
  if (!props.formula) return <span class="muted">–</span>;
  return (
    <span class="formula">
      {formulaTokens(props.formula).map(([kind, v]) =>
        kind === "sub" ? <sub>{v}</sub> : kind === "sup" ? <sup>{v}</sup> : kind === "var" ? <sub><i>{v}</i></sub> : v,
      )}
    </span>
  );
};

export const fmt = (v: number | null | undefined, unit: string, digits = 2) =>
  v === null || v === undefined ? "" : `${Number(v.toFixed(digits))} ${unit}`;
