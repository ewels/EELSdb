// Keep shared browse URLs short: drop empty fields.
document.getElementById("filters").addEventListener("submit", (event) => {
  for (const el of event.target.elements) if (el.name && el.value === "") el.disabled = true;
});

// Fields disabled on submit stay disabled when the page is restored from the back/forward cache.
addEventListener("pageshow", () => {
  for (const el of document.getElementById("filters").elements) el.disabled = false;
});

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
        li.innerHTML = `<button type="button" class="chip" aria-label="Remove ${x.name}"><span class="v"></span> <span aria-hidden="true">×</span></button>`;
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
    onChange: () => items.forEach((x) => (x.o.selected = !!x.selected)),
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
      onChange: () => items.forEach((x) => (x.o.selected = !!x.selected)),
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
    },
  });
}
