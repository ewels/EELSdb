---
name: EELS Data Base
description: Open reference spectra for electron energy-loss and X-ray absorption spectroscopy, in a quiet interface where the data and the logo's two traces carry the colour.
colors:
  bg: "light-dark(#fbfaf8, #141312)"
  surface: "light-dark(#ffffff, #1c1b19)"
  sunken: "light-dark(#f3f1ed, #23211f)"
  ink: "light-dark(#1b1a19, #ece8e2)"
  muted: "light-dark(#5d5852, #a9a29a)"
  line: "light-dark(#e2ddd5, #36332f)"
  rule: "light-dark(#eeeae4, #262422)"
  accent: "light-dark(oklch(0.46 0.075 248), oklch(0.80 0.075 248))"
  accent-ink: "light-dark(oklch(0.43 0.085 250), oklch(0.82 0.08 248))"
  on-accent: "light-dark(#ffffff, #141312)"
  accent-soft: "light-dark(oklch(0.95 0.02 248), oklch(0.30 0.035 248))"
  plot: "light-dark(oklch(0.45 0.08 250), oklch(0.80 0.08 248))"
  edge: "light-dark(oklch(0.60 0.11 65), oklch(0.78 0.10 72))"
  danger: "light-dark(oklch(0.50 0.15 28), oklch(0.76 0.12 28))"
  note: "light-dark(oklch(0.52 0.10 65), oklch(0.80 0.10 75))"
  type-coreloss: "light-dark(oklch(0.47 0.07 255), oklch(0.80 0.07 250))"
  type-lowloss: "light-dark(oklch(0.50 0.09 70), oklch(0.82 0.09 78))"
  type-xrayabs: "light-dark(oklch(0.48 0.07 160), oklch(0.80 0.08 160))"
  logo-red: "light-dark(#a21e16, #e86f63)"
  logo-ochre: "light-dark(#b96716, #e3a35d)"
  avatar-a: "light-dark(oklch(0.90 0.035 248), oklch(0.36 0.045 248))"
  avatar-b: "light-dark(oklch(0.91 0.045 75), oklch(0.38 0.05 70))"
  avatar-c: "light-dark(oklch(0.91 0.035 160), oklch(0.36 0.04 160))"
  avatar-d: "light-dark(oklch(0.91 0.03 20), oklch(0.36 0.04 20))"
  avatar-e: "light-dark(oklch(0.91 0.03 300), oklch(0.36 0.04 300))"
typography:
  headline:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title-sm:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  lede:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  button:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
  table:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  small:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
  column-head:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.88em"
rounded:
  cell: "3px"
  control: "4px"
  tile: "6px"
  panel: "8px"
  card: "10px"
  pill: "999px"
spacing:
  hair: "0.35rem"
  tight: "0.5rem"
  base: "1rem"
  section: "1.5rem"
  gutter: "2rem"
  column: "4.5rem"
  band: "5.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-secondary:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-secondary-hover:
    backgroundColor: "{colors.surface}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.7rem"
  type-filter-on:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.75rem"
  type-filter-off:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.75rem"
  tooltip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "0.6rem 0.75rem"
  example-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "0.7rem 0.8rem 0.5rem"
  doi-chip:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 0.7rem"
    height: "2.625rem"
  avatar:
    backgroundColor: "{colors.avatar-a}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "1.9rem"
  chip:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.7rem"
  chip-hover:
    backgroundColor: "{colors.accent-soft}"
  notice:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1rem 1.25rem"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1.25rem 1.5rem 1.5rem"
  pager-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.65rem"
---

# Design System: EELS Data Base

## Overview

**Creative North Star: "The Instrument Readout"**

The site reads like the output of a well-kept spectrometer: neutral warm-grey paper, black ink, numbers in tabular figures, and exactly two strong colours, the red and ochre traces of the logo. Everything else is quiet. Links are coloured but not underlined except inside running text, tables have hairline rules instead of boxes, spectrum types are coloured dots, and the interface accent is a calm slate blue chosen so it never competes with the logo. Real data carries the page: the homepage shows real spectra, real counts and the real people who shared them.

The system is light and dark from one source: every colour is a `light-dark()` pair, the OS picks the scheme, and the header's light/dark toggle pins one (`data-theme` on the root): remembered in the browser, and saved to the account when signed in. Dark mode is built for the darkened microscope room: warm near-black paper, warm off-white ink, and lighter, softer versions of every hue.

Density is that of a reference tool used on wide desktop monitors: a 1320px column (1920px for wide pages such as browse), a sticky header, and multi-column layouts that fold to one column on narrow screens. Motion is limited to four things: the homepage logo's scan, the header logo's fade, the burger menu's drop-in, and the tooltip's fade. All respect reduced motion.

**Key Characteristics:**
- Two strong colours only, both in the logo; the interface accent is a muted slate blue.
- Flat surfaces separated by 1px rules and tonal steps (bg, surface, sunken); one soft shadow, on dialogs and tooltips.
- Mona Sans variable throughout, self-hosted, the same face as the logo's lettering; tabular figures site-wide.
- Chemical formulas typeset with real subscripts and superscripts, variable stoichiometry in italics.
- Spectrum types shown as a coloured dot plus a label.
- Square-ish 4px controls; labels never wrap.
- Full `light-dark()` palette.

## Colors

A warm-neutral paper-and-ink palette with one restrained slate-blue interface accent, a small set of meaning colours, and the logo's red and ochre held apart from the interface.

### Primary
- **Slate Instrument Blue** (`accent`): fill of primary buttons, the active nav underline, the periodic-table shade scale, selected filter cells, the focus ring, avatar hover rings and the scan head. Low chroma (0.075) on purpose, so the logo's red stays the strongest colour on any screen.
- **Slate Link Ink** (`accent-ink`): link text, hover colour of titles and arrows in linked rows and tiles, and keywords in code samples; a touch darker and more saturated than the accent so text links pass contrast on paper.
- **Slate Wash** (`accent-soft`): text selection highlight and chip hover.
- **Plot Trace Blue** (`plot`): the spectrum line in plots and example tiles (with a 9% wash of itself under the line in tiles), a sibling of the accent so the data reads as interface-native rather than as a third brand colour.

### Secondary
- **Edge Ochre** (`edge`): absorption-edge markers drawn over spectrum plots (dashed in example tiles, with 600-weight labels in the same colour), and string literals in code samples. Minor edges in the full viewer use `muted`.
- **Field Note Amber** (`note`): warnings in checks and the "value read from the file" provenance marker.

### Tertiary (type coding)
- **Core-loss Slate** (`type-coreloss`), **Low-loss Amber** (`type-lowloss`), **X-ray Absorption Green** (`type-xrayabs`): the dot colour of each spectrum type. Zero loss uses `muted`. These appear only as small dots, never as fills or outlines.

### Avatar backgrounds
- **Five low-chroma washes** (`avatar-a` slate, `avatar-b` amber, `avatar-c` green, `avatar-d` rose, `avatar-e` violet): backgrounds for contributor initials when there is no picture. Chroma stays at or below 0.05 so a wall of avatars stays calm.

### Logo colours
- **Trace Red** (`logo-red`) and **Trace Ochre** (`logo-ochre`): the two spectrum traces in the logo and favicon, and nowhere else. In dark mode they lift to lighter, softer versions so the traces stay visible on near-black.

### Neutral
- **Paper** (`bg`): page background, and the sticky header's background once the page scrolls.
- **Card White** (`surface`): inputs, example tiles, tooltips, active type-filter badges, dialogs, secondary-button hover.
- **Bench Grey** (`sunken`): secondary buttons, code blocks, the DOI chip, notices, chips, hover rows, empty periodic-table cells.
- **Ink** (`ink`): body text, headings, nav links, table links; also the fill of "current" states (pager, choice buttons) and the hover ring on periodic-table cells.
- **Graphite** (`muted`): secondary text, labels, counts beside type links, axis text, the footer, the secondary-button hover border.
- **Line** (`line`): input, tile and tooltip borders, the dividers between the homepage's ways in, the plot baseline. Mixed 25% towards `muted` it becomes the border of secondary buttons and type-filter badges.
- **Rule** (`rule`): the faintest divider: table rows, tile footers, plot gridlines, the header's bottom edge once scrolled, the footer's top edge.
- **Error Red** (`danger`): error text and the border of fields in error.

### Named Rules
**The Two Traces Rule.** The logo's red and ochre belong to the logo and favicon. Interface elements use the slate accent; they never borrow `logo-red` or `logo-ochre`.

**The Quiet Accent Rule.** The accent marks what is actionable or current (primary button, active nav, selection, focus) and the one data scale that needs it (periodic-table shading). Nothing decorative. If a screen has more than one or two blue areas outside the periodic table, something is over-using it.

**The Paired Value Rule.** Every colour is written once as `light-dark(light, dark)` in `:root`. Never add a colour that only exists in one scheme, and never re-theme with a separate dark-mode block.

## Typography

**Body Font:** Mona Sans variable (wdth 75–125, wght 200–900), self-hosted (with system-ui, -apple-system, Segoe UI, sans-serif)
**Mono Font:** ui-monospace (with SF Mono, Menlo, Consolas, monospace), for code, DOIs and similar identifiers

**Character:** One family, the same one the logo's lettering is set in, so the page and the mark speak the same voice. Weight and size do the work: 800 and 400 only in the logo, 700 for page titles, 600 for section heads, buttons and labels, 500 for nav, names and table titles, 400 for reading. Width stays at the default (100); the wdth axis is loaded but not used for hierarchy.

### Hierarchy
- **Display** (the logo): the homepage hero is the large logo lockup, up to 480px wide. There is no typeset display size.
- **Headline** (700, 2rem, 1.2, -0.025em): page `h1` on inner pages; 1.5rem below 560px.
- **Title** (600, 1.3rem, 1.2, -0.015em): section `h2`. In the homepage's list of ways in it drops to 1.12rem. All headings use balanced wrapping.
- **Title small** (600, 1.05rem, 1.25): `h3`; 0.95rem with ellipsis truncation for example-tile names.
- **Lede** (400, 1.15rem, 1.5): the one-sentence homepage lede in `ink` at max 38ch; the muted intro under an inner page title at max 62ch. 1.08rem on phones.
- **Body** (400, 16px, 1.55): paragraphs and lists capped at 72ch; secondary paragraphs in `muted` at 0.93–0.95rem.
- **Button** (600, 0.95rem): every button and button-styled link.
- **Table** (0.92rem): data tables; edges column 0.85rem.
- **Small** (0.875rem): footer, dates, definition-list terms; tooltips and tile footers at 0.85rem.
- **Label** (600, 0.8rem, muted): filter labels and legends; field labels in the submit form are 0.85rem in `ink`.
- **Column head** (500, 0.75rem, muted, no wrap): table header cells.

### Named Rules
**The Tabular Figures Rule.** `font-variant-numeric: tabular-nums` is set on the body. Counts, energies and dates line up in columns; never switch it off for a numeric cell.

**The Typeset Formula Rule.** Chemical formulas always render through the Formula component: stoichiometric numbers as subscripts at 0.72em, charges as superscripts, and variable stoichiometry (`n`, `m`, `x`, `y`) as italic subscripts, so `(C2H4)n` shows as (C₂H₄)<sub><i>n</i></sub>. Edge names follow suit (Ti L<sub>2,3</sub>). Never print a raw formula string.

**The Sentence Case Rule.** Headings, buttons and labels are sentence case. There is no uppercase or tracked-out text anywhere in the build.

**The Plain Copy Rule.** Copy is plain and factual: say what a thing is or does in as few words as it takes, and cut any sentence that only explains the page to itself. "290 spectra from 41 microscopists, shared since 2005." is the model.

## Layout

A single centred column, `min(1320px, 100% - 2rem)`, widened to `min(1920px, 100% - 3rem)` for data-heavy pages (browse).

**Header.** Sticky at the top on every page. One flex row inside the column: the small logo (170px) on the left, nav pushed right, ending in a "Sign in" secondary button. Vertical padding 0.8rem. On inner pages the header has the `bg` background and `rule` bottom border and shows the small logo at all times. On the homepage it starts transparent with no logo, so the large hero logo sits level with the nav; as soon as the page scrolls at all it takes the `bg` background and `rule` border and the small logo fades in. Below 1000px (where the full row stops fitting) the row is just the logo and a burger button; the search box, light/dark toggle, links and Sign in (or the avatar with the name) move into a dropdown panel below the header. There the small logo always shows, homepage included, with no fade. Below 560px the small logo is 104px.

**Homepage**, top to bottom, sections 5.5rem apart (3.5rem on phones):
- Intro row: large logo | one-sentence lede | two stacked buttons of equal width (min 12.5rem), aligned to the bottom; columns 1fr / 1fr / auto, gap 2rem 3.5rem.
- Hero row (1fr / 1.35fr, gap 3rem 4.5rem): the ways in on the left stretched to the exact height of a 3×2 grid of example tiles on the right (gap 0.75rem). The ways in are separated by `line` rules and share the height equally after the search row.
- Browse by element: the periodic table with its shade key; the type-filter badges sit in the table's empty top gap.
- Shared by microscopists (1fr / 1.4fr, `line` rule above): count sentence and button left, avatar wall right.
- Load spectra in Python | How to cite: two equal columns, gap 2rem 4.5rem.
- Footer, 5rem below.

**Other recurring grids** (inner pages):
- **Browse:** a 17.5rem filter rail, sticky below the header, beside the results table, gap 2rem. Below 860px the results come first and the filters drop beneath them behind a "jump to filters" link.
- **Spectrum page:** full-width plot (min 360px tall, 280px below 860px), then two equal metadata columns, gap 2rem.
- **Forms:** a 60rem form with 2-, 3- and 4-column field grids (gap 0 1.25rem) that collapse to one (or two, for the 4-grid) below 860px.

Breakpoints: 560px (phone: smaller header logo, periodic table becomes a list, type column shrinks to dots), 860px (inner pages to one column), 960px (homepage rows to one column, tiles to 2 columns), 1000px (header nav folds into the burger menu), 1180px (homepage buttons move under the logo and lede, smaller filter badges), 1440px (`hide-md` table columns hidden below it).

Spacing rhythm in rem: 0.35 between chips and pager items; 0.5 between buttons in a row; 0.75 between tiles; 1 for card padding; 1.5 between blocks; 2 for gutters; 4.5 for wide column gaps; 5.5 between homepage sections.

## Elevation & Depth

Flat by default. Depth comes from three tonal steps (paper `bg`, raised `surface`, recessed `sunken`) and from 1px `line` and `rule` borders. One soft shadow exists, used by the two things that float over the page: the modal dialog (over a warm 45% dark backdrop) and the tooltip.

### Shadow Vocabulary
- **Soft lift** (`box-shadow: 0 1px 2px var(--shadow-color), 0 8px 24px var(--shadow-color)`, where `--shadow-color` is `light-dark(rgb(40 30 20 / 0.08), rgb(0 0 0 / 0.4))`): dialogs and tooltips only.

### Named Rules
**The Flat Page Rule.** Cards, tiles, notices, tables, buttons and inputs carry no shadow. If something needs to stand out, give it `surface` on `bg` or `sunken` on `surface`, or a `line` border. Hover rings (2px `ink` on periodic-table cells, 2px `accent` on avatars) are outlines, not shadows.

## Shapes

Firm, lightly rounded corners. Controls (buttons, inputs, type-filter badges, the DOI chip, pager items) are 4px. Example tiles, code blocks and tooltips are 6px. Notices are 8px; dialogs 10px. Periodic-table cells are 3px. Chips and avatars are full rounds; type markers are 0.5em circles. Borders are always 1px; the only 2px lines are the nav underline, the focus ring and hover rings. Dashed lines mean "off" or "not here": edge markers in plots, the off state of a type-filter badge, and the lanthanide and actinide placeholders in the periodic table.

## Components

### Buttons
Plain and firm: a solid slate block or a grey one, never a gradient or a shadow. Labels never wrap (`white-space: nowrap`).
- **Shape:** 4px corners, 1px border, inline-flex with a 0.45rem gap for an optional 16px stroked icon (usually a right arrow).
- **Primary:** `accent` fill and border, `on-accent` text, 600 at 0.95rem, padding 0.5rem 1rem. For the main action in a group: Browse all spectra, Search, Share a spectrum.
- **Secondary:** `sunken` fill, `ink` text, 1px border of `color-mix(in oklab, var(--line), var(--muted) 25%)`. It has a fill so it reads as the same size as a primary beside it; a plain outline looked smaller. Used for Share your spectra, Sign in, HyperSpy, exSpy, Read the paper, and cancel actions.
- **Hover / Focus:** primary brightens (`filter: brightness(1.08)`); secondary turns `surface` with a `muted` border. Focus is the global 2px `accent` outline offset 2px.

### Type filter badge
A toggle button for one spectrum type, used in groups (`role="group"`, `aria-pressed`).
- **On:** `surface` fill, the secondary-button border, `ink` text, filled type dot. 4px corners, padding 0.4rem 0.75rem, 0.9rem text (0.8rem and 0.3rem 0.55rem below 1180px).
- **Off:** transparent, dashed border, `muted` text, hollow dot (a 1.5px ring in `currentColor`).
- **Hover:** border to `muted`.
- **Behaviour:** all start on. From all-on, the first click isolates that type; after that, clicks toggle. The controlled view recounts at once.

### Tooltip
One shared tooltip element for the periodic table and contributor avatars.
- **Style:** `surface`, 1px `line` border, 6px corners, the soft lift, padding 0.6rem 0.75rem, min width 11rem, 0.85rem text. A 600-weight 0.95rem heading, then rows or a muted line. A 9px rotated-square arrow points at the target.
- **Placement:** above the target, or below if the sticky header is in the way; centred on the target and clamped 8px inside the window, with the arrow following the target.
- **Timing:** 0.12s fade with a 4px rise towards the target. 80ms delay on first show, instant when moving between targets, 60ms before hiding; hides on scroll. With reduced motion it appears and disappears without transition.
- **Access:** keyboard focus shows it; targets point at it with `aria-describedby`. Targets carry no `title` attribute, so no native tooltip doubles it.

### Example tile
A small credited spectrum on the homepage.
- `surface`, 1px `line` border, 6px corners. Body (padding 0.7rem 0.8rem 0.5rem) links to the spectrum: name (0.95rem 600, one line with ellipsis), then a muted 0.8rem meta line "formula · type dot type", then a 78px real plot in `plot` with a faint wash and dashed `edge` markers labelled above in 0.68rem 600 `edge`.
- Footer under a `rule` line (padding 0.45rem 0.8rem, 0.85rem): a 1.5rem avatar and the contributor's name (500) linking to their page.
- Hover: the name turns `accent-ink`. No lift.

### Avatar
- A circle with the contributor's picture when they have one; otherwise their initials (600, `ink`) on one of the five avatar washes.
- Sizes: 1.5rem in tiles, 1.9rem default, 2.6rem in the contributor wall, 3rem large.
- In the wall each avatar is a link with an `aria-label` and the shared tooltip (name, spectra count, year of first spectrum); hover adds a 2px `accent` ring.

### DOI copy chip
A button that copies a DOI to the clipboard.
- `sunken` fill, transparent 1px border (`line` on hover), 4px corners, height 2.625rem to match the buttons beside it, padding 0 0.7rem.
- Contents: a 0.75rem 600 muted "DOI" key, the DOI in the monospace stack at 0.85rem, and a 16px muted clipboard icon.
- On click the icon becomes a tick and a status line says "Copied" for 1.6s. If the clipboard is unavailable the DOI text is selected instead.

### Chips
- **Style:** `sunken` pill, 0.8rem `ink` text, no border, padding 0.15rem 0.7rem.
- **State:** linked chips (active filters, tags) wash to `accent-soft` on hover.

### Cards / Containers
- **Notice:** `sunken` panel, `line` border, 8px corners, padding 1rem 1.25rem; with `danger` border for an error summary.
- **Dialog:** `surface`, `line` border, 10px corners, the soft lift, max 42rem wide.
- **Code block:** `sunken`, 6px corners, padding 0.9rem 1rem, line height 1.6, scrolls sideways.

### Inputs / Fields
- **Style:** `surface` background, 1px `line` border, 4px corners, padding 0.5rem 0.7rem, inherited font, `muted` placeholder.
- **Hover / Focus:** border darkens to `muted` on hover; focus uses the 2px `accent` outline.
- **Error:** `danger` border on the field and a 0.85rem 600-weight `danger` message beneath; hints are 0.8rem `muted`.
- **Choice buttons:** visually hidden radios drawn as outlined segments; the checked one inverts to an `ink` fill with `bg` text.

### Navigation
- **Sticky header:** see Layout. The header's background and border transition over 0.25s. The homepage's small logo fades up into place (opacity plus a 6px rise, 0.2s, `cubic-bezier(0.16, 1, 0.3, 1)`) when the page leaves the top, and fades straight out with no movement when it returns to the very top. While hidden it is out of the tab order. Below 1000px it is never hidden.
- **Main nav:** `ink` text at weight 500 with a 2px transparent bottom border. Hover shows a `line` underline; the current page shows an `accent` underline. No backgrounds, no pills. "Sign in" is a secondary button; signed in, the account avatar takes its place. Before the links: a search box (13rem, 4px, magnifier icon, searches titles in browse) and a 2rem light/dark toggle (a half-filled circle icon in `muted`, `sunken` on hover) with 0.6rem extra space before Browse.
- **Burger menu (below 1000px):** a 2.5rem icon button (three lines, an X when open) with `aria-expanded`, on the right. The panel spans the full width under the header: `bg`, a `rule` bottom border and the soft shadow; a full-width search box, then the light/dark toggle as a row (icon plus "Dark mode" or "Light mode", naming what a click does), then the links as tap rows split by `rule` hairlines, the current one underlined in `accent`, then Sign in or the avatar and name. While open the header takes its scrolled look, homepage included. It fades and drops 6px in over 0.18s (motion allowed only), and closes on Escape (focus returns to the button), an outside click, a chosen link, or widening past 1000px. Without JavaScript the panel is simply shown, in flow.
- **Back link:** "← Parent" above a page title, 0.875rem, no underline until hover (class `back-link`).
- **Wide pages:** only `main` widens (browse uses 1920px); the header and footer keep the 1320px column on every page.
- **Pager:** text items with 4px corners, `sunken` on hover, the current page inverted to `ink` on `bg`.
- **Footer:** small `muted` text on a `rule` top border, links not underlined (they turn `ink` on hover), the licence line pushed right.

### Ways in (homepage)
A list of linked rows separated by `line` rules: a title (600, 1.12rem), a muted line, and a 20px right arrow that slides 4px right and turns `accent-ink` on hover, as does the title. The search row holds a label-as-heading, an input and a primary Search button. The type row adds the four type links: dot, name, and the count in `muted`.

### Logo and colours page
`/logo/` serves the logo files (`worker/public/logo/`, made by `python/scripts/logo_files.py` with the lettering outlined): full and compact lockups for light and dark backgrounds, plus black and white, as SVG and transparent PNG, and the square mark. Previews sit on fixed paper or near-black plates whatever the page theme. Colour values copy on click with the DOI-chip treatment. Its fixed hex values are deliberate: they describe the files, not the interface.

### Partner logos
The about page's "Support" logos sit on equal light plates in both themes (white with a hairline border in light, warm off-white in dark), because the organisations' files mix dark ink, white backgrounds and white-only marks. Files live in `worker/public/partners/`.

### Data table
- Collapsed borders, 0.92rem, a `rule` hairline under each row and a `line` under the header, no outer box and no last-row rule. Header cells are 0.75rem `muted`; sortable heads turn `ink` when active. Row hover tints with `sunken` at 70%. Numeric columns right-align. Title links are `ink` at weight 500 and turn `accent-ink` on hover.

### Type badge
The marker for spectrum type: a 0.5em filled circle in the type's colour followed by the type name. Below 560px inside tables the label collapses and only a dot remains. A type label is never drawn as an outlined or filled tag; the bordered type-filter badge is a button, not a label.

### Formula
Inline `<span class="formula">` built by `formulaTokens()`: subscripts and superscripts at 0.72em with zero line-height so they do not disturb the row, Greek names (alpha, beta…) converted to letters, italic variable subscripts. Empty formulas show a muted en dash.

### Periodic table
- **Homepage:** an 18-column grid of cells (aspect 1 / 0.92, 3px gaps, 3px corners) with the f-block below a 0.6rem gap. No atomic numbers: the symbol sits top-left (600, sized to the cell) and the spectrum count bottom-right (500). Elements with spectra link to browse and are shaded in six steps of `accent` mixed into `surface` (12%, 22%, 36%, 52%, 70%, 100%) on a log scale up to the largest count; the two darkest steps use `on-accent` text. A key beside the heading shows the ramp from 1 to the largest count. Elements with no spectra sit greyed on a faded `sunken` and are not links. Hover adds a 2px `ink` ring; the tooltip lists the element's spectra per type, with filtered-out types muted. The type-filter badges recount and reshade the cells; elements filtered to zero grey out and leave the tab order.
- **Phones (below 560px):** only the elements with spectra, as a flowing 6-column list, with the filter badges above it.
- **Browse filter:** the same grid as a multi-select filter; elements with no spectra sit on `sunken` in `muted`, available ones are `surface` with an inset `line` ring, selected ones fill with `accent`.

### Spectrum plot
uPlot on a canvas, coloured from the CSS tokens at draw time: trace in `plot` (1.5px), axes in `muted`, grid and ticks in `line`, major edge markers in `edge` and minor ones in `muted`. The plot is rebuilt when the colour scheme changes.

### Logo
The logo is an inline SVG: two 2px spectrum traces stroked with `logo-red` and `logo-ochre`, and the lettering "EELSdb" in Mona Sans ("EELS" 800, "db" 400, tracking -0.01em) in `currentColor`, so it follows `ink` in both themes. The traces' path data and colours are fixed. "Data Base" does not appear in the logo. The favicon is unchanged.
- **Large lockup** (homepage hero, up to 480px): the lettering sits on the traces' flat tail, right-aligned to the end of the tail. The tagline "Inner & Outer Shell Excitation Spectrum Repository" in Mona Sans 400, `muted`, runs under the tail across the full trace width.
- **Small lockup** (header, 170px; 104px on phones): no tagline. The lettering is bigger relative to the traces (cap height about 45% of the trace height), centred vertically on them and starting just right of the peaks; the flat tails are extended to make room. Only the header lockup extends the tails.

On the homepage, with motion allowed, the traces are recorded left to right like a spectrometer readout: a clip window slides in over 1.3s (`cubic-bezier(0.32, 0.06, 0.24, 1)`, 0.1s delay) led by a 1.5px `accent` scan head that fades out at the end. The lettering then rises in (0.45s, `cubic-bezier(0.16, 1, 0.3, 1)`, 6px up with a 3px blur, from 0.375s), then the tagline (from 0.575s). It plays once. With reduced motion the logo is simply there.

## Do's and Don'ts

### Do:
- **Do** write every new colour as a `light-dark()` pair in `:root` and reference it by role (`--ink`, `--muted`, `--accent`), never as a literal in a rule.
- **Do** use `accent` only for the actionable or current thing (primary button, current nav item, selection, focus) and for the periodic-table shade scale.
- **Do** pair a primary button with a `sunken`-filled secondary, not a bare outline.
- **Do** keep button labels on one line and controls at 4px corners.
- **Do** separate content with 1px `rule`/`line` borders and the bg/surface/sunken steps.
- **Do** render every formula with the Formula component and every spectrum type with the type dot.
- **Do** show real data: real plots in tiles, real counts, real contributors.
- **Do** keep figures tabular and right-align numeric table columns.
- **Do** use the shared tooltip, with `aria-describedby` and keyboard focus, for any hover detail; never a `title` attribute alongside it.
- **Do** cap reading text at 72ch and keep copy plain, factual and in sentence case.
- **Do** gate every animation behind `prefers-reduced-motion: no-preference`.

### Don't:
- **Don't** use `logo-red` or `logo-ochre` outside the logo and favicon.
- **Don't** underline links outside running text; inside paragraphs, use the faint 30% underline that firms up on hover.
- **Don't** draw a spectrum type label as an outlined or filled tag; use the dot.
- **Don't** add shadows to cards, tiles, buttons or notices; dialogs and tooltips are the only lifted surfaces.
- **Don't** add a second typeface; Mona Sans carries the interface and the logo, with ui-monospace only for code and identifiers.
- **Don't** use pill-shaped buttons.
- **Don't** add animation beyond the logo scan, the header logo fade, the burger menu's drop-in and the tooltip fade.
- **Don't** add explanatory filler sentences; if a heading and a count say it, stop.
- **Don't** change the logo traces or their colours, or extend the tails outside the header lockup.
