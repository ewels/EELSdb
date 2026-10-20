// Keep shared browse URLs short: drop empty fields, and comparisons whose value is empty.
document.getElementById("filters").addEventListener("submit", (event) => {
  const form = event.target;
  for (const el of form.elements) {
    if (!el.name) continue;
    const compareOf = el.name.endsWith("_compare") && form.elements[el.name.replace("_compare", "")];
    if (el.value === "" || (compareOf && compareOf.value === "")) el.disabled = true;
  }
});

// Fields disabled on submit stay disabled when the page is restored from the back/forward cache.
addEventListener("pageshow", () => {
  for (const el of document.getElementById("filters").elements) el.disabled = false;
});
