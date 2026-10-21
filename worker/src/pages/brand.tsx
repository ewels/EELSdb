import { Hono } from "hono";
import { raw } from "hono/html";
import type { AppEnv } from "../auth";
import { Layout } from "./layout";

export const brand = new Hono<AppEnv>();

// Files are built by python/scripts/logo_files.py; keep the names in sync.
const LOGOS = [
  ["eelsdb-logo", "Full logo", 2000],
  ["eelsdb-logo-compact", "Compact logo, without the tagline", 2000],
] as const;
const VERSIONS = [
  ["light-bg", "For light backgrounds", "on-light"],
  ["dark-bg", "For dark backgrounds", "on-dark"],
  ["black", "Black", "on-light"],
  ["white", "White", "on-dark"],
] as const;

const COLOURS = [
  ["Trace red", "#a21e16", "#e86f63", "The first trace in the logo and favicon. Logo only."],
  ["Trace ochre", "#b96716", "#e3a35d", "The second trace in the logo and favicon. Logo only."],
  ["Slate", "#345b80", "#98c3ec", "The interface accent: primary buttons, the current page, focus."],
  ["Ink", "#1b1a19", "#ece8e2", "Text and the logo lettering."],
  ["Graphite", "#5d5852", "#a9a29a", "Secondary text and the logo tagline."],
  ["Paper", "#fbfaf8", "#141312", "Page background."],
] as const;

const WEIGHTS = [
  [400, "Regular"],
  [500, "Medium"],
  [600, "SemiBold"],
  [700, "Bold"],
  [800, "ExtraBold"],
] as const;

const COPY_SCRIPT = `for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    const msg = b.querySelector(".doi-msg");
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.classList.add("copied");
      msg.textContent = "Copied";
      setTimeout(() => { b.classList.remove("copied"); msg.textContent = ""; }, 1600);
    } catch {
      getSelection().selectAllChildren(b.querySelector("code"));
    }
  });
}`;

const ARROW = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);

function Downloads(props: { file: string; width: number }) {
  return (
    <div class="brand-files">
      <a href={`/logo/${props.file}.svg`} download="">SVG</a>
      <a href={`/logo/${props.file}.png`} download="">PNG, {props.width} px</a>
    </div>
  );
}

function CopyChip(props: { label: string; value: string }) {
  return (
    <button type="button" class="doi" data-copy={props.value} aria-label={`Copy ${props.label} ${props.value}`}>
      <span class="swatch" style={`background:${props.value}`} aria-hidden="true"></span>
      <span class="doi-k">{props.label}</span>
      <code>{props.value}</code>
      <svg class="i-copy" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6.5" y="6.5" width="10" height="11" rx="1.5" />
        <path d="M13.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h1.5" />
      </svg>
      <svg class="i-done" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 10.5l4 4 8-9" />
      </svg>
      <span class="doi-msg" role="status"></span>
    </button>
  );
}

brand.get("/brand/", (c) => c.redirect("/logo/", 301));
brand.get("/brand", (c) => c.redirect("/logo/", 301));
brand.get("/logo", (c) => c.redirect("/logo/", 301));

brand.get("/logo/", (c) =>
  c.html(
    <Layout
      user={c.get("user")}
      title="Logo and colours"
      description="Download the EELSdb logo, and the colours and typeface it uses."
      path="/logo/"
    >
      <div class="brand">
        <h1>Logo and colours</h1>
        <p class="lede">For posters, slides and papers about work that used EELSdb.</p>

        <section aria-labelledby="logo">
          <h2 id="logo">Logo</h2>
          <p>The lettering is converted to outlines, so the files need no fonts installed. PNG files have a transparent background.</p>
          {LOGOS.map(([base, name, width]) => (
            <>
              <h3>{name}</h3>
              <ul class="brand-grid">
                {VERSIONS.map(([version, label, bg]) => (
                  <li>
                    <div class={`brand-preview ${bg}`}>
                      <img src={`/logo/${base}-${version}.svg`} alt={`${name}, ${label.toLowerCase()}`} loading="lazy" />
                    </div>
                    <p class="brand-name">{label}</p>
                    <Downloads file={`${base}-${version}`} width={width} />
                  </li>
                ))}
              </ul>
            </>
          ))}
          <h3>Square mark</h3>
          <ul class="brand-grid">
            <li>
              <div class="brand-preview on-light mark">
                <img src="/logo/eelsdb-mark.svg" alt="EELSdb square mark" loading="lazy" />
              </div>
              <p class="brand-name">For icons and avatars, where the full logo is too small</p>
              <Downloads file="eelsdb-mark" width={1024} />
            </li>
          </ul>
        </section>

        <section aria-labelledby="use">
          <h2 id="use">Using the logo</h2>
          <ul class="brand-rules">
            <li>Leave clear space around the logo at least as tall as the “E” on every side.</li>
            <li>Use the full logo at 240 px (5 cm in print) wide or more. Below that, use the compact logo, down to 100 px (2.5 cm) wide.</li>
            <li>Use the version for dark backgrounds on dark backgrounds. On photos, or when you can print only one colour, use the black or white version.</li>
            <li>Scale the logo only in proportion. Do not recolour, stretch or redraw the traces, and do not change or retype the lettering.</li>
            <li>When you show results from the database, also <a href="/citation/">cite EELSdb</a>.</li>
          </ul>
        </section>

        <section aria-labelledby="colours">
          <h2 id="colours">Colours</h2>
          <p>Each colour has a value for light backgrounds and a value for dark backgrounds. Select a value to copy it.</p>
          <ul class="brand-colours">
            {COLOURS.map(([name, light, dark, use]) => (
              <li>
                <div>
                  <p class="brand-name">{name}</p>
                  <p class="muted">{use}</p>
                </div>
                <div class="brand-values">
                  <CopyChip label="Light" value={light} />
                  <CopyChip label="Dark" value={dark} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="type">
          <h2 id="type">Typeface</h2>
          <p>
            The logo and the site are set in Mona Sans, by GitHub. The logo uses ExtraBold (800) for “EELS” and Regular (400) for
            “db” and the tagline. Mona Sans is free to use under the SIL Open Font License.
          </p>
          <ul class="brand-weights">
            {WEIGHTS.map(([weight, name]) => (
              <li style={`font-weight:${weight}`}>
                {name} <span class="muted">{weight}</span>
              </li>
            ))}
          </ul>
          <div class="brand-actions">
            <a class="button secondary" href="https://github.com/github/mona-sans/releases">Download Mona Sans {ARROW}</a>
            <a class="button secondary" href="/fonts/OFL.txt">Licence</a>
          </div>
        </section>
      </div>
      <script>{raw(COPY_SCRIPT)}</script>
    </Layout>,
  ),
);
