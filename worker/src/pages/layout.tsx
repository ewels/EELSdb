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

export function Layout(props: {
  title?: string;
  description?: string;
  path: string;
  user: User | null;
  head?: Child;
  wide?: boolean;
  /** The homepage: its own large logo, so the header mark only appears once the page scrolls. */
  home?: boolean;
  children: Child;
}) {
  const wrap = props.wide ? "wrap wide" : "wrap";
  const title = props.title ? `${props.title} · EELS Data Base` : "EELS Data Base";
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en" data-theme={props.user && props.user.theme !== "system" ? props.user.theme : undefined}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title}</title>
          <meta
            name="description"
            content={props.description ?? "Open database of electron energy-loss (EELS) and X-ray absorption (XAS) spectra."}
          />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="preload" href="/fonts/mona-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="stylesheet" href="/style.css" />
          {props.head}
        </head>
        <body class={props.home ? "home" : undefined}>
          <a class="skip" href="#main">Skip to content</a>
          <header class={props.home ? "site-header" : "site-header stuck"}>
            <div class={wrap}>
              <a class="logo" href="/" aria-label="EELSdb home" tabindex={props.home ? -1 : undefined}>{raw(LOGO_SVG)}</a>
              <nav class="site-nav" aria-label="Main">
                {NAV.map(([href, label]) => (
                  <a href={href} aria-current={props.path.startsWith(href) ? "page" : undefined}>{label}</a>
                ))}
                {props.user ? (
                  <a
                    class="account-link"
                    href="/account/"
                    aria-label={`Your account (${props.user.display_name})`}
                    title={props.user.display_name}
                    aria-current={props.path.startsWith("/account/") ? "page" : undefined}
                  >
                    <span class="avatar" aria-hidden="true">
                      {[...props.user.display_name.trim()][0]?.toUpperCase() ?? "?"}
                      {props.user.avatar && <img src={props.user.avatar} alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer" />}
                    </span>
                  </a>
                ) : (
                  <a class="button secondary" href={`/login/${props.path && props.path !== "/login/" ? `?next=${encodeURIComponent(props.path)}` : ""}`}>Sign in</a>
                )}
              </nav>
            </div>
          </header>
          <main id="main" class={wrap}>{props.children}</main>
          <footer class="site-footer">
            <div class={wrap}>
              <a href="/citation/">How to cite</a>
              <a href="/instruments/">Instrument profiles</a>
              <a href="/downloads/">Download everything</a>
              <a href="/news/">News</a>
              <a href="/contact/">Contact</a>
              <a href="https://github.com/ewels/EELSdb">Source on GitHub</a>
              <span class="licence">
                Data under the <a href="https://opendatacommons.org/licenses/odbl/">Open Database Licence (ODbL)</a>
              </span>
            </div>
          </footer>
        </body>
      </html>
    </>
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
