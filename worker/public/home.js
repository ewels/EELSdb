// Homepage: the header's small logo, the periodic table's type filter and tooltips, and the copyable DOI.

const header = document.querySelector(".site-header");
const headerMark = header.querySelector(".logo");
function updateHeader() {
  const stuck = scrollY > 0;
  header.classList.toggle("stuck", stuck);
  headerMark.tabIndex = stuck ? 0 : -1;
}
addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

const table = document.querySelector(".pt");
const EL_TYPES = JSON.parse(document.getElementById("el-types").textContent);
const MAX = Number(table.dataset.max);
/** Keep in step with shade() in src/pages/home.tsx. */
const shade = (n) => (n ? Math.min(6, 1 + Math.floor((Math.log(n) / Math.log(MAX)) * 5.999)) : 0);
const TYPE_NAMES = { coreloss: "Core loss", lowloss: "Low loss", xrayabs: "X-ray absorption", zeroloss: "Zero loss" };
const typeButtons = [...document.querySelectorAll(".tf")];
const cells = [...table.querySelectorAll("a.el")];
for (const a of cells) a.dataset.name = a.getAttribute("aria-label").split(":")[0];

const activeTypes = () => typeButtons.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.type);

function filterTable() {
  const on = activeTypes();
  const query = on.length === typeButtons.length ? "" : on.map((t) => `&type[]=${t}`).join("");
  for (const a of cells) {
    const sym = a.querySelector("b").textContent;
    const n = on.reduce((sum, t) => sum + (EL_TYPES[sym][t] || 0), 0);
    a.className = `el el-${shade(n)}${n ? "" : " el-none"}`;
    a.querySelector("s").textContent = n;
    a.href = `/spectra/?element[]=${sym}${query}`;
    a.setAttribute("aria-label", `${a.dataset.name}: ${n} spectr${n === 1 ? "um" : "a"}`);
    if (n) a.removeAttribute("tabindex");
    else a.tabIndex = -1;
  }
}

// From "all on", a click picks just that type; after that, clicks toggle.
for (const b of typeButtons) {
  b.addEventListener("click", () => {
    const allOn = typeButtons.every((x) => x.getAttribute("aria-pressed") === "true");
    if (allOn) for (const x of typeButtons) x.setAttribute("aria-pressed", String(x === b));
    else b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    filterTable();
  });
}

// Tooltips for elements and contributors: above the target, or below when the sticky header is in the way.
const tip = Object.assign(document.createElement("div"), { className: "tip", id: "home-tip" });
tip.setAttribute("role", "tooltip");
document.body.append(tip);

function elementTip(a) {
  const sym = a.querySelector("b").textContent;
  const on = new Set(activeTypes());
  const rows = Object.keys(TYPE_NAMES)
    .filter((t) => EL_TYPES[sym][t])
    .map((t) => `<li class="${on.has(t) ? "" : "off"}"><span class="dot t-${t}"></span>${TYPE_NAMES[t]}<span>${EL_TYPES[sym][t]}</span></li>`);
  return `<b>${a.dataset.name}</b><ul>${rows.join("")}</ul>`;
}
const personTip = (a) =>
  `<b>${a.getAttribute("aria-label").split(":")[0]}</b><p>${a.dataset.n} spectr${a.dataset.n === "1" ? "um" : "a"} since ${a.dataset.since}</p>`;

const GAP = 10;
const EDGE = 8;
function showTip(a, content) {
  tip.innerHTML = content(a);
  const r = a.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const side = r.top - GAP - h >= header.getBoundingClientRect().bottom + EDGE ? "above" : "below";
  const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), innerWidth - w - EDGE);
  tip.dataset.side = side;
  tip.style.left = `${left}px`;
  tip.style.top = `${side === "above" ? r.top - GAP - h : r.bottom + GAP}px`;
  tip.style.setProperty("--ax", `${Math.min(Math.max(12, r.left + r.width / 2 - left), w - 12)}px`);
  tip.classList.add("show");
}

// A short delay on the way in, none when moving from one target to the next.
let showTimer;
let hideTimer;
function hideTip() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  tip.classList.remove("show");
}
function addTip(a, content) {
  a.setAttribute("aria-describedby", "home-tip");
  a.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (tip.classList.contains("show")) showTip(a, content);
    else showTimer = setTimeout(() => showTip(a, content), 80);
  });
  a.addEventListener("mouseleave", () => {
    clearTimeout(showTimer);
    hideTimer = setTimeout(hideTip, 60);
  });
  a.addEventListener("focus", () => showTip(a, content));
  a.addEventListener("blur", hideTip);
}
for (const a of cells) addTip(a, elementTip);
for (const a of document.querySelectorAll(".faces a")) addTip(a, personTip);
addEventListener("scroll", hideTip, { passive: true });

for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.classList.add("copied");
      b.querySelector(".doi-msg").textContent = "Copied";
      setTimeout(() => {
        b.classList.remove("copied");
        b.querySelector(".doi-msg").textContent = "";
      }, 1600);
    } catch {
      getSelection().selectAllChildren(b.querySelector("code"));
    }
  });
}
