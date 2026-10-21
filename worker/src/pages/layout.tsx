import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import type { User } from "../auth";
import { LOGO_SVG } from "./logo";

const NAV = [
  ["/spectra/", "Browse"],
  ["/submit-data/", "Submit"],
  ["/news/", "News"],
  ["/api/", "API"],
] as const;

const ABOUT_NAV = [
  ["/about/", "About EELSdb"],
  ["/citation/", "How to cite"],
  ["/moderators/", "Moderators"],
  ["/logo/", "Logo and colours"],
  ["/contact/", "Contact"],
] as const;

// Runs before paint so a saved theme does not flash. A signed-in user's saved theme arrives as data-theme and wins.
const THEME_SCRIPT = `document.documentElement.classList.add("js");try{var r=document.documentElement,t=localStorage.getItem("theme");if(t&&!r.dataset.theme)r.dataset.theme=t}catch(e){}`;
// Flips light and dark, remembers it in this browser, and saves it to the account when signed in.
const TOGGLE_SCRIPT = `document.querySelectorAll(".theme-toggle").forEach(function(b){b.addEventListener("click",function(){var r=document.documentElement,d=r.dataset.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),n=d==="dark"?"light":"dark";r.dataset.theme=n;try{localStorage.setItem("theme",n)}catch(e){}if(this.dataset.save)fetch("/account/settings/theme/",{method:"POST",body:new URLSearchParams({theme:n})})})})`;

// The About disclosure. Registered before MENU_SCRIPT so Escape folds the About group before it closes the burger panel.
// A focusout without relatedTarget is a click elsewhere, which the click handler covers; closing on it would hide the panel mid-click in Safari.
const DROP_SCRIPT = `;(function(){var d=document.querySelector(".nav-drop"),b=d.querySelector(".drop-toggle");function open(){return b.getAttribute("aria-expanded")==="true"}function set(o){b.setAttribute("aria-expanded",o)}b.addEventListener("click",function(){set(!open())});addEventListener("keydown",function(e){if(e.key==="Escape"&&open()){e.stopImmediatePropagation();set(false);b.focus()}});d.addEventListener("focusout",function(e){if(e.relatedTarget&&!d.contains(e.relatedTarget))set(false)});addEventListener("click",function(e){if(!d.contains(e.target)||e.target.closest(".drop-panel a"))set(false)})})()`;

// The burger menu. Keep the width in step with the 999px breakpoint in style.css.
const MENU_SCRIPT = `;(function(){var h=document.querySelector(".site-header"),b=h.querySelector(".menu-toggle"),m=document.getElementById("site-menu"),q=matchMedia("(max-width: 999px)");function set(o){h.classList.toggle("menu-open",o);b.setAttribute("aria-expanded",o)}b.addEventListener("click",function(){set(b.getAttribute("aria-expanded")!=="true")});addEventListener("keydown",function(e){if(e.key==="Escape"&&h.classList.contains("menu-open")){set(false);b.focus()}});addEventListener("click",function(e){if(!h.contains(e.target))set(false)});m.addEventListener("click",function(e){if(e.target.closest("a"))set(false)});q.addEventListener("change",function(){if(!q.matches)set(false)})})()`;

// Two copies so each sits in DOM (and Tab) order where it shows: in the header row on wide screens, beside the account in the burger panel on narrow ones. CSS hides one.
function ThemeToggle(props: { class: string; save: boolean }) {
  return (
    <button class={`theme-toggle ${props.class}`} type="button" title="Light or dark" data-save={props.save ? "1" : undefined}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" />
        <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none" />
      </svg>
      <span class="theme-label"><span class="to-dark">Switch to dark mode</span><span class="to-light">Switch to light mode</span></span>
    </button>
  );
}

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
          <script>{raw(THEME_SCRIPT)}</script>
          {props.head}
        </head>
        <body class={props.home ? "home" : undefined}>
          <a class="skip" href="#main">Skip to content</a>
          <header class={props.home ? "site-header" : "site-header stuck"}>
            <div class="wrap">
              <a class="logo" href="/" aria-label="EELSdb home" tabindex={props.home ? -1 : undefined}>{raw(LOGO_SVG)}</a>
              <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Menu">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                  <path class="burger" d="M3 5.5h14M3 10h14M3 14.5h14" />
                  <path class="close" d="m4.5 4.5 11 11m0-11-11 11" />
                </svg>
              </button>
              <div class="menu" id="site-menu">
                <form class="nav-search" action="/spectra/" method="get" role="search">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                    <circle cx="8.5" cy="8.5" r="5.5" />
                    <path d="M12.6 12.6 17 17" />
                  </svg>
                  <input type="search" name="title" placeholder="Search spectra" aria-label="Search spectra" />
                </form>
                <ThemeToggle class="wide" save={!!props.user} />
                <nav class="site-nav" aria-label="Main">
                  {NAV.map(([href, label]) => (
                    <a href={href} aria-current={props.path.startsWith(href) ? "page" : undefined}>{label}</a>
                  ))}
                  <div class="nav-drop">
                    <button
                      type="button"
                      class={ABOUT_NAV.some(([href]) => props.path.startsWith(href)) ? "drop-toggle current" : "drop-toggle"}
                      aria-expanded="false"
                      aria-controls="about-menu"
                    >
                      <span class="drop-label">About</span>
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m3 4.5 3 3 3-3" />
                      </svg>
                    </button>
                    <ul class="drop-panel" id="about-menu">
                      {ABOUT_NAV.map(([href, label]) => (
                        <li><a href={href} aria-current={props.path.startsWith(href) ? "page" : undefined}>{label}</a></li>
                      ))}
                    </ul>
                  </div>
                  <div class="menu-foot">
                    {props.user ? (
                      <a
                        class="account-link"
                        href="/account/"
                        aria-label={`Your account (${props.user.display_name})`}
                        title={props.user.display_name}
                        aria-current={props.path.startsWith("/account/") ? "page" : undefined}
                      >
                        <Avatar name={props.user.display_name} seed={props.user.slug ?? props.user.display_name} src={props.user.avatar} />
                        <span class="account-name">{props.user.display_name}</span>
                      </a>
                    ) : (
                      <a class="button secondary" href={`/login/${props.path && props.path !== "/login/" ? `?next=${encodeURIComponent(props.path)}` : ""}`}>Sign in</a>
                    )}
                    <ThemeToggle class="narrow" save={!!props.user} />
                  </div>
                </nav>
              </div>
            </div>
          </header>
          <script>{raw(TOGGLE_SCRIPT + DROP_SCRIPT + MENU_SCRIPT)}</script>
          <main id="main" class={wrap}>{props.children}</main>
          <footer class="site-footer">
            <div class="wrap">
              <a href="/contact/">Contact</a>
              <a href="https://github.com/ewels/EELSdb">Website source code on GitHub</a>
              <a class="downloads" href="/downloads/">Bulk download</a>
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

// Copy buttons ([data-copy]) on the citation and logo pages; copy failures fall back to selecting the text.
export const COPY_SCRIPT = `for (const b of document.querySelectorAll("[data-copy]")) {
  const label = b.querySelector(".copy-label");
  const text = label.textContent;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
    } catch {
      const target = b.dataset.select ? document.getElementById(b.dataset.select) : b.querySelector("code");
      return getSelection().selectAllChildren(target);
    }
    b.classList.add("copied");
    label.textContent = "Copied";
    setTimeout(() => { b.classList.remove("copied"); label.textContent = text; }, 1600);
  });
}`;

const AV_HUES = ["av-a", "av-b", "av-c", "av-d", "av-e"];

export const initials = (name: string) => {
  const parts = name.replace(/\([^)]*\)/g, "").split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0].slice(1, 2))).toUpperCase();
};

/** Initials on a hue picked from `seed` (the author slug, so a person has the same colour everywhere), under their picture if any. */
export const Avatar = (props: { name: string; seed: string; src?: string | null; class?: string }) => (
  <span
    class={`av ${AV_HUES[[...props.seed].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AV_HUES.length]}${props.class ? ` ${props.class}` : ""}`}
    aria-hidden="true"
  >
    {initials(props.name)}
    {props.src && <img src={props.src} alt="" loading="lazy" referrerpolicy="no-referrer" />}
  </span>
);

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

/** An edge as "Ti L2,3", typeset Ti L<sub>2,3</sub>. */
export const EdgeName = (props: { label: string }) => {
  const [element, edge = ""] = props.label.split(" ");
  const [, shell, sub] = edge.match(/^([A-Z])(.*)$/) ?? [];
  return <>{element}{"\u00a0"}{shell}{sub && <sub>{sub}</sub>}</>;
};

export const fmt = (v: number | null | undefined, unit: string, digits = 2) =>
  v === null || v === undefined ? "" : `${Number(v.toFixed(digits))} ${unit}`;
