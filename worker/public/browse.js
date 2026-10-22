// Filters apply as they change: the results section is fetched and swapped in, and the URL follows.
// Without JavaScript the form submits with its Apply button instead.
const form = document.getElementById("filters");
let timer;
let pending;

// Short shareable URLs: no empty fields, and a toggle group that is all on (or all off) means "any".
function filterUrl() {
  const data = new FormData(form);
  for (const group of form.querySelectorAll(".toggles")) {
    const boxes = [...group.querySelectorAll("input")];
    if (boxes.every((b) => b.checked) || boxes.every((b) => !b.checked)) data.delete(boxes[0].name);
  }
  const q = new URLSearchParams([...data].filter(([, v]) => v !== ""));
  return `/spectra/${q.size ? `?${q}` : ""}`;
}

async function load() {
  const url = filterUrl();
  if (url === location.pathname + location.search) return;
  pending?.abort();
  pending = new AbortController();
  const section = document.querySelector(".browse > section");
  section.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(url, { signal: pending.signal });
    const fresh = new DOMParser().parseFromString(await res.text(), "text/html").querySelector(".browse > section");
    // Reuse the live region so screen readers announce the new count.
    const status = section.querySelector(".result-bar [role=status]");
    const next = fresh.querySelector(".result-bar [role=status]");
    status.innerHTML = next.innerHTML;
    next.replaceWith(status);
    section.replaceWith(fresh);
    history.pushState(null, "", url);
  } catch (err) {
    if (err.name !== "AbortError") location.href = url;
  }
}

const refresh = (delay = 0) => {
  clearTimeout(timer);
  timer = setTimeout(load, delay);
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  refresh();
});
form.addEventListener("change", () => refresh());
form.addEventListener("input", (event) => {
  if (event.target.matches('input[type="text"], input[type="search"]')) refresh(400);
});
// The form keeps the state it had when the page loaded, so stepping back reloads instead of swapping.
addEventListener("popstate", () => location.reload());

// A type-to-filter combobox with removable chips, drawn over a native field that stays the submitted value.
// items: { value, name, count, html, selected: pick order or falsy }; rank(item, query) → sort key, or -1 for no match.
// exact(word) → the item a whole typed word names, so "Fe O " or a pasted "Fe, O" picks both without Enter.
function picker({ id, after, label, placeholder, describedby, chipsLabel, listLabel, none, items, rank, limit, onChange, freeText, exact }) {
  const box = document.createElement("div");
  box.className = "picker";
  box.innerHTML = `<ul class="picker-chips" aria-label="${chipsLabel}"></ul>
    <input type="text" id="${id}-input" role="combobox" autocomplete="off" spellcheck="false" placeholder="${placeholder}"
      aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" aria-describedby="${describedby}">
    <ul class="picker-list" id="${id}-list" role="listbox" aria-label="${listLabel}" hidden></ul>`;
  after.after(box);
  label.htmlFor = `${id}-input`;
  const chips = box.querySelector(".picker-chips");
  const input = box.querySelector("input");
  const list = box.querySelector("[role=listbox]");
  let matches = [];
  let active = -1;
  let seq = items.length;
  // `selected` holds the pick order, so chips and Backspace follow it.
  const picked = () => items.filter((x) => x.selected).sort((a, b) => a.selected - b.selected);

  const changed = () => {
    renderChips();
    onChange(picked(), freeText ? input.value.trim() : "");
  };

  const renderChips = () => {
    chips.replaceChildren(
      ...picked().map((x) => {
        const li = document.createElement("li");
        li.innerHTML = `<button type="button" class="chip"><span class="v"></span> <span aria-hidden="true">×</span></button>`;
        li.firstChild.setAttribute("aria-label", `Remove ${x.name}`);
        li.querySelector(".v").textContent = x.value;
        li.firstChild.addEventListener("click", () => {
          x.selected = false;
          changed();
          input.focus();
        });
        return li;
      }),
    );
    chips.hidden = !chips.children.length;
  };

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const setActive = (i) => {
    active = i;
    list.querySelectorAll("[role=option]").forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    if (i < 0) return input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-activedescendant", `${id}-opt-${i}`);
    list.children[i].scrollIntoView({ block: "nearest" });
  };

  const open = () => {
    const q = input.value.trim().toLowerCase();
    const free = items.filter((x) => !x.selected && x.count);
    matches = q
      ? free.map((x) => [rank(x, q), x]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0] || b[1].count - a[1].count).map(([, x]) => x)
      : free.toSorted((a, b) => b.count - a.count);
    matches = matches.slice(0, limit);
    list.replaceChildren(
      ...(matches.length
        ? matches.map((x, i) => {
            const li = document.createElement("li");
            li.id = `${id}-opt-${i}`;
            li.setAttribute("role", "option");
            li.innerHTML = `${x.html} <span class="n">${x.count}</span>`;
            li.addEventListener("mousedown", (e) => e.preventDefault());
            li.addEventListener("click", () => add(i));
            return li;
          })
        : [Object.assign(document.createElement("li"), { className: "none", textContent: none })]),
    );
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    list.scrollIntoView({ block: "nearest" });
    setActive(matches.length ? 0 : -1);
  };

  const add = (i) => {
    matches[i].selected = ++seq;
    input.value = "";
    changed();
    close();
  };

  const pickWords = () => {
    const words = input.value.split(/[\s,;]+/);
    if (words.length < 2) return;
    const last = words.pop();
    const left = [];
    for (const w of words.filter(Boolean)) {
      const x = exact(w);
      if (x && !x.selected) x.selected = ++seq;
      else if (!x) left.push(w);
    }
    input.value = [...left, last].join(" ");
    changed();
  };

  input.addEventListener("input", () => {
    if (exact) pickWords();
    if (freeText) changed();
    input.value.trim() ? open() : close();
  });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    const shown = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown) return open();
      if (matches.length) setActive((active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === "Enter" && exact && /[\s,;]/.test(input.value.trim())) {
      e.preventDefault();
      input.value += " ";
      pickWords();
      input.value.trim() ? open() : close();
    } else if (e.key === "Enter" && shown && active >= 0) {
      e.preventDefault();
      add(active);
    } else if (e.key === "Enter" && shown && !freeText) {
      e.preventDefault();
    } else if (e.key === "Escape" && shown) {
      e.preventDefault();
      close();
    } else if (e.key === "Backspace" && input.value === "") {
      const last = picked().at(-1);
      if (last) {
        last.selected = false;
        changed();
      }
    }
  });
  renderChips();
}

// Space-led and punctuation-free, so a query matches from the start of any word: "mar" finds "(Dr) Marie Cheynet".
const words = (s) => " " + s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Elements: picks set the hidden multi-select's options; spectra must contain all of them.
{
  const select = document.getElementById("f-element");
  const items = [...select.options].map((o) => ({ o, value: o.value, name: o.dataset.name, count: Number(o.dataset.count), selected: o.selected }));
  for (const x of items) x.html = `<b>${x.value}</b> ${x.name}`;
  select.hidden = true;
  picker({
    id: "f-element",
    after: select,
    label: document.querySelector('label[for="f-element"]'),
    placeholder: "Type symbols or names, for example Fe O",
    describedby: "f-element-hint",
    chipsLabel: "Selected elements",
    listLabel: "Elements",
    none: "No matching elements",
    items,
    limit: 8,
    rank: (x, q) => {
      const sym = x.value.toLowerCase();
      const name = x.name.toLowerCase();
      if (sym === q) return 0;
      if (sym.startsWith(q)) return 1;
      if (name.startsWith(q)) return 2;
      if (name.includes(q)) return 3;
      return -1;
    },
    exact: (w) => items.find((x) => x.value.toLowerCase() === w.toLowerCase() || x.name.toLowerCase() === w.toLowerCase()),
    onChange: () => {
      items.forEach((x) => (x.o.selected = !!x.selected));
      refresh();
    },
  });
}

// Keywords: like elements, a spectrum must have every picked keyword.
{
  const select = document.getElementById("f-keyword");
  if (select) {
    const items = [...select.options].map((o) => ({ o, value: o.value, name: o.value, count: Number(o.dataset.count), selected: o.selected }));
    for (const x of items) x.html = esc(x.value);
    select.hidden = true;
    picker({
      id: "f-keyword",
      after: select,
      label: document.querySelector('label[for="f-keyword"]'),
      placeholder: "Type a keyword",
      describedby: "f-keyword-hint",
      chipsLabel: "Selected keywords",
      listLabel: "Keywords",
      none: "No matching keywords",
      items,
      limit: 8,
      rank: (x, q) => {
        const k = x.value.toLowerCase();
        if (k === q) return 0;
        if (k.startsWith(q)) return 1;
        if (words(k).includes(" " + q)) return 2;
        return k.includes(q) ? 3 : -1;
      },
      onChange: () => {
        items.forEach((x) => (x.o.selected = !!x.selected));
        refresh();
      },
    });
  }
}

// Authors: the text field stays the submitted value, a comma-separated list the query matches with OR.
// Typed text that is not picked still counts, as a partial name.
{
  const field = document.getElementById("f-author");
  const known = [...document.querySelectorAll("#f-author-list option")].map((o) => ({ value: o.value, name: o.value, count: Number(o.dataset.count) }));
  const items = known.map((x) => ({ ...x, html: esc(x.name) }));
  field.value.split(",").map((t) => t.trim()).filter(Boolean).forEach((term, i) => {
    const hit = items.find((x) => x.value.toLowerCase() === term.toLowerCase());
    if (hit) hit.selected = i + 1;
    else items.push({ value: term, name: term, count: 0, selected: i + 1 });
  });
  field.hidden = true;
  field.removeAttribute("list");
  document.getElementById("f-author-hint").textContent = "Spectra by any of the selected authors.";
  picker({
    id: "f-author",
    after: field,
    label: document.querySelector('label[for="f-author"]'),
    placeholder: "Type a name",
    describedby: "f-author-hint",
    chipsLabel: "Selected authors",
    listLabel: "Authors",
    none: "No matching authors",
    items,
    limit: 50,
    freeText: true,
    rank: (x, q) => (words(x.name).includes(words(q)) ? 0 : -1),
    onChange: (chosen, typed) => {
      field.value = [...chosen.map((x) => x.value), typed].filter(Boolean).join(", ");
      refresh(400);
    },
  });
}

const eV = (v) => (v >= 1000 ? `${Number((v / 1000).toPrecision(3))} keV` : `${Number(Number(v).toPrecision(3))} eV`);

// Histogram sliders write the number fields (shown only without JavaScript); a thumb at its open end leaves its field empty, so it does not filter.
for (const hist of document.querySelectorAll(".hist")) {
  const lo = Number(hist.dataset.lo);
  const hi = Number(hist.dataset.hi);
  const max = Number(hist.dataset.max);
  const track = hist.querySelector(".hist-range");
  const ranges = [...track.querySelectorAll("input")];
  const fields = ranges.map((r) => document.getElementById(r.dataset.for));
  const bars = [...hist.querySelectorAll("rect")];
  const readout = hist.closest("fieldset").querySelector("output");
  const openEnd = (i) => (ranges.length === 2 && i === 0 ? 0 : max);
  const toEv = (pos) => Number((10 ** (lo + ((hi - lo) * pos) / max)).toPrecision(2));

  const paint = () => {
    const [a, b] = ranges.length === 2 ? ranges.map((r) => Number(r.value)) : [0, Number(ranges[0].value)];
    track.style.setProperty("--a", a / max);
    track.style.setProperty("--b", b / max);
    const [from, to] = ranges.length === 2 ? fields.map((f) => f.value) : ["", fields[0].value];
    readout.textContent = from && to ? `${eV(from)} – ${eV(to)}` : from ? `≥ ${eV(from)}` : to ? `≤ ${eV(to)}` : "Any";
    bars.forEach((bar, i) => {
      const mid = ((i + 0.5) / bars.length) * max;
      bar.classList.toggle("in", mid >= a && mid <= b);
    });
  };

  paint();
  ranges.forEach((range, i) => {
    range.addEventListener("input", () => {
      if (ranges.length === 2) {
        const [a, b] = ranges.map((r) => Number(r.value));
        if (a > b) range.value = i === 0 ? b : a;
      }
      const pos = Number(range.value);
      fields[i].value = pos === openEnd(i) ? "" : toEv(pos);
      paint();
    });
  });
}

