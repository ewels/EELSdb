import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { LAST_METHOD_COOKIE, type User } from "../auth";
import { ABOUT_NAV, NAV, currentAbout } from "../nav";
import { LOGO_SVG } from "./logo";

// Runs before paint so a saved theme does not flash. A signed-in user's saved theme arrives as data-theme and wins.
const THEME_SCRIPT = `document.documentElement.classList.add("js");try{var r=document.documentElement,t=localStorage.getItem("theme");if(t&&!r.dataset.theme)r.dataset.theme=t}catch(e){}`;
/** What the docs header (docs-site/src/components/Account.astro) needs to show the account. Keep the shape in step with it. */
export function accountSummary(user: User | null) {
  if (!user) return { signed_in: false as const };
  const seed = user.slug ?? user.display_name;
  return { signed_in: true as const, name: user.display_name, initials: initials(user.display_name), hue: avatarHue(seed), avatar: user.avatar, theme: user.theme };
}

// Every page records the account in this browser, so the static docs header can show it before it paints.
const accountScript = (user: User | null) =>
  `try{localStorage.setItem("account",JSON.stringify(Object.assign(${JSON.stringify(accountSummary(user)).replace(/</g, "\\u003c")},{at:Date.now()})))}catch(e){}`;

// Signed-in pages only, so a sign-in waiting for its second step is not remembered yet.
const LAST_METHOD_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )${LAST_METHOD_COOKIE}=(\\w+)/);if(m){document.cookie="${LAST_METHOD_COOKIE}=; Max-Age=0; Path=/";localStorage.setItem("signin-method",m[1])}}catch(e){}`;

// Right after the banner, so a hidden banner never paints. The link returns to the exact page.
const ORCID_BANNER_SCRIPT = `(function(){var b=document.querySelector(".orcid-banner"),k="orcid-banner-hidden";b.querySelector("a").href="/auth/orcid/link?next="+encodeURIComponent(location.pathname+location.search);if(!b.querySelector("button"))return;try{if(Number(localStorage.getItem(k))>Date.now())b.hidden=true}catch(e){}b.querySelector("button").addEventListener("click",function(){b.hidden=true;try{localStorage.setItem(k,Date.now()+30*864e5)}catch(e){}})})()`;

// Right after the banner, so a hidden banner never paints. The resend form returns to the exact page.
const EMAIL_BANNER_SCRIPT = `(function(){var b=document.querySelector(".email-banner"),k="email-banner-hidden",n=b.querySelector("input[name=next]");if(n)n.value=location.pathname+location.search;try{if(Number(localStorage.getItem(k))>Date.now())b.hidden=true}catch(e){}b.querySelector("button[type=button]").addEventListener("click",function(){b.hidden=true;try{localStorage.setItem(k,Date.now()+7*864e5)}catch(e){}});var f=b.querySelector("form");if(f)f.addEventListener("submit",function(e){e.preventDefault();var s=f.querySelector("button");s.disabled=true;fetch(f.action,{method:"POST",body:new FormData(f),headers:{Accept:"application/json"}}).then(function(r){return r.json()}).then(function(j){b.querySelector("p").textContent=j.sent?"Sent. Check your inbox, and your spam folder, for the link from EELSdb.":"No new link was sent: you have asked for several today. Please use the last one, or try again tomorrow.";f.remove()}).catch(function(){f.submit()})})})()`;

// Not shown where the person is already adding or confirming an address.
const NO_EMAIL_BANNER = /^\/(?:login|account\/welcome\/email\/|account\/settings\/emails\/)/;

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
      <svg class="to-dark" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
        <path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z" />
      </svg>
      <svg class="to-light" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M4.3 15.7l1.3-1.3M14.4 5.6l1.3-1.3" />
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
  const emailBanner = props.user?.email_prompt && !props.user.setup_required && !NO_EMAIL_BANNER.test(props.path) ? props.user.email_prompt : null;
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
          <link rel="stylesheet" href="/tokens.css" />
          <link rel="stylesheet" href="/style.css" />
          <script>{raw(THEME_SCRIPT + accountScript(props.user) + (props.user ? LAST_METHOD_SCRIPT : ""))}</script>
          {props.head}
        </head>
        <body class={props.home ? "home" : undefined}>
          <a class="skip" href="#main">Skip to content</a>
          {/* While ORCID is required, the submit page explains it in place of the form, so the banner would repeat it. */}
          {emailBanner && (
            <>
              <div class="email-banner" role="region" aria-label="Confirm your email address">
                <div class="wrap">
                  {emailBanner.address ? (
                    <p aria-live="polite">Confirm your email address: we sent a link to {emailBanner.address}.</p>
                  ) : (
                    <p>Add an email address so we can send you sign-in links and news about your submissions.</p>
                  )}
                  {emailBanner.address ? (
                    <form method="post" action={`/account/settings/emails/${emailBanner.id}/send/`}>
                      <input type="hidden" name="next" value={props.path || "/account/"} />
                      <button class="button" type="submit">Send it again</button>
                    </form>
                  ) : (
                    <a class="button" href="/account/settings/emails/">Add email address</a>
                  )}
                  <button class="banner-close" type="button" aria-label="Hide this message for 7 days" title="Hide for 7 days"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg></button>
                </div>
              </div>
              <script>{raw(EMAIL_BANNER_SCRIPT)}</script>
            </>
          )}
          {!emailBanner && props.user?.orcid_prompt && !props.path.startsWith("/login") && !(props.user.orcid_prompt === "required" && props.path === "/submit-data/") && (
            <>
              <div class="orcid-banner" role="region" aria-label="Link your ORCID iD">
                <div class="wrap">
                  {props.user.orcid_only ? (
                    <p>EELSdb now signs people in with ORCID only. Link your ORCID iD to keep signing in to this account.</p>
                  ) : (
                    <p>Link your ORCID iD so your spectra are credited to you.</p>
                  )}
                  <a class="button" href={`/auth/orcid/link?next=${encodeURIComponent(props.path || "/account/")}`}>Link ORCID</a>
                  {!props.user.orcid_only && <button class="banner-close" type="button" aria-label="Hide this message for 30 days" title="Hide for 30 days"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg></button>}
                </div>
              </div>
              <script>{raw(ORCID_BANNER_SCRIPT)}</script>
            </>
          )}
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
                  <input type="search" name="q" placeholder="Search spectra" aria-label="Search spectra" />
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
                        <li><a href={href} aria-current={href === currentAbout(props.path) ? "page" : undefined}>{label}</a></li>
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
                Data under the <a href="https://opendatacommons.org/licenses/odbl/">Open Database Licence (ODbL)</a> unless{" "}
                <a href="/docs/use/download/#what-the-licence-lets-you-do">stated otherwise</a>
              </span>
            </div>
          </footer>
        </body>
      </html>
    </>
  );
}

export const ACCOUNT_PAGES = [
  ["/account/", "Overview"],
  ["/account/submissions/", "Submissions"],
  ["/account/drafts/", "Drafts"],
] as const;
export const SETTINGS_PAGES = [
  ["/account/settings/profile/", "Profile"],
  ["/account/settings/emails/", "Email addresses"],
  ["/account/settings/sign-in/", "Sign-in methods"],
  ["/account/settings/two-step/", "Two-step and passkeys"],
  ["/account/settings/tokens/", "API tokens"],
] as const;
export type AccountPage = (typeof ACCOUNT_PAGES)[number][0] | (typeof SETTINGS_PAGES)[number][0];

const STAFF_PAGES: [string, string, string][] = [
  ["/admin/", "Moderation", "moderator"],
  ["/admin/users/", "Accounts", "admin"],
  ["/admin/settings/", "Site settings", "admin"],
  ["/admin/messages/", "Messages", "admin"],
];

/** Every page under /account/: the site layout with the account nav beside the content. */
export function AccountLayout(props: { title: string; current: AccountPage; user: User; head?: Child; children: Child }) {
  const { role } = props.user;
  const staff = STAFF_PAGES.filter(([, , needs]) => role === "admin" || role === needs);
  return (
    <Layout title={props.title} path={props.current} user={props.user} head={props.head}>
      <div class="account-layout">
        <nav class="account-nav" aria-label="Your account">
          <ul>
            {ACCOUNT_PAGES.map(([href, label]) => (
              <li><a href={href} aria-current={href === props.current ? "page" : undefined}>{label}</a></li>
            ))}
          </ul>
          <div>
            <p class="account-nav-label" id="account-settings">Settings</p>
            <ul aria-labelledby="account-settings">
              {SETTINGS_PAGES.map(([href, label]) => <li><a href={href} aria-current={href === props.current ? "page" : undefined}>{label}</a></li>)}
            </ul>
          </div>
          {staff.length > 0 && (
            <div>
              <p class="account-nav-label" id="account-staff">Staff</p>
              <ul aria-labelledby="account-staff">
                {staff.map(([href, label]) => <li><a href={href}>{label}</a></li>)}
              </ul>
            </div>
          )}
          <form method="post" action="/logout/">
            <button type="submit">Sign out</button>
          </form>
        </nav>
        <div class="account-main">{props.children}</div>
      </div>
    </Layout>
  );
}

const AV_HUES = ["av-a", "av-b", "av-c", "av-d", "av-e"];

/** The avatar hue for `seed` (the author slug, so a person has the same colour everywhere). */
export const avatarHue = (seed: string) => AV_HUES[[...seed].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AV_HUES.length];

export const initials = (name: string) => {
  const parts = name.replace(/\([^)]*\)/g, "").split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0].slice(1, 2))).toUpperCase();
};

/** Initials on a hue picked from `seed`, under their picture if any. */
export const Avatar = (props: { name: string; seed: string; src?: string | null; class?: string }) => (
  <span
    class={`av ${avatarHue(props.seed)}${props.class ? ` ${props.class}` : ""}`}
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

export const TypeBadge = (props: { type: string; boxed?: boolean }) => (
  <span class={`type type-${props.type}${props.boxed ? " type-boxed" : ""}`}>{TYPE_NAMES[props.type] ?? props.type}</span>
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
