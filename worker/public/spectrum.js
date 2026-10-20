// Spectrum page: plot the data file with uPlot and mark exSpy edge onsets for the spectrum's elements.

for (const button of document.querySelectorAll("[data-open]")) {
  button.addEventListener("click", () => document.getElementById(button.dataset.open).showModal());
}
for (const button of document.querySelectorAll("dialog [data-close]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
}

/** Parse MSA (XY or Y) or two-column text into [energies, intensities]. */
function parseSpectrum(text) {
  const header = {};
  const x = [];
  const y = [];
  let inData = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(/^#([A-Z0-9 -]+?)\s*:\s*(.*)$/i);
      if (m) header[m[1].trim().toUpperCase()] = m[2].trim();
      if (/^#SPECTRUM/i.test(line)) inData = true;
      if (/^#ENDOFDATA/i.test(line)) break;
      continue;
    }
    if (!/^[-+.\d]/.test(line)) continue;
    const nums = line.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.some(Number.isNaN)) continue;
    if (inData && (header.DATATYPE || "").toUpperCase() === "Y") {
      y.push(...nums);
    } else if (nums.length >= 2) {
      x.push(nums[0]);
      y.push(nums[1]);
    }
  }
  if (!x.length) {
    const offset = parseFloat(header.OFFSET) || 0;
    const step = parseFloat(header.XPERCHAN) || 1;
    for (let i = 0; i < y.length; i++) x.push(offset + step * i);
  }
  // uPlot needs increasing x.
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return [order.map((i) => x[i]), order.map((i) => y[i])];
}

/** A colour token resolved for canvas drawing (tokens use light-dark(), which only the cascade resolves). */
const probe = document.createElement("span");
probe.hidden = true;
document.body.append(probe);
const css = (name) => {
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color;
};

async function main() {
  const el = document.getElementById("plot");
  if (!el || !el.dataset.src) return;
  let data;
  try {
    const res = await fetch(el.dataset.src);
    if (!res.ok) throw new Error(res.statusText);
    data = parseSpectrum(await res.text());
    if (data[0].length < 2) throw new Error("no data");
  } catch (e) {
    el.innerHTML = '<p class="plot-message">The data file could not be read for plotting. You can still download it.</p>';
    return;
  }

  const elements = JSON.parse(el.dataset.elements || "[]");
  let table = {};
  try {
    table = (await (await fetch("/eels_binding_energies.json")).json()).elements;
  } catch {}
  const [xmin, xmax] = [data[0][0], data[0][data[0].length - 1]];
  const edges = [];
  for (const symbol of elements) {
    for (const [shell, info] of Object.entries(table[symbol] || {})) {
      const e = info["onset_energy (eV)"];
      if (e >= xmin && e <= xmax) edges.push({ label: `${symbol} ${shell}`, energy: e, major: info.relevance === "Major" });
    }
  }

  const showEdges = document.getElementById("show-edges");
  const showMinor = document.getElementById("show-minor");
  const edgePlugin = {
    hooks: {
      draw: (u) => {
        if (!showEdges.checked) return;
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        ctx.save();
        ctx.font = `${11 * dpr}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        let row = 0;
        for (const edge of edges.sort((a, b) => a.energy - b.energy)) {
          if (!edge.major && !showMinor.checked) continue;
          const px = u.valToPos(edge.energy, "x", true);
          if (px < u.bbox.left || px > u.bbox.left + u.bbox.width) continue;
          ctx.strokeStyle = edge.major ? css("--edge") : css("--muted");
          ctx.setLineDash(edge.major ? [] : [3 * dpr, 3 * dpr]);
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(px, u.bbox.top);
          ctx.lineTo(px, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.fillStyle = edge.major ? css("--edge") : css("--muted");
          ctx.fillText(edge.label, px + 3 * dpr, u.bbox.top + 4 * dpr + (row++ % 3) * 13 * dpr);
        }
        ctx.restore();
      },
    },
  };

  el.innerHTML = "";
  const axis = () => ({ stroke: css("--muted"), grid: { stroke: css("--line"), width: 1 }, ticks: { stroke: css("--line") } });
  const opts = () => ({
    width: el.clientWidth,
    height: Math.max(280, Math.min(460, el.clientWidth * 0.5)),
    scales: { x: { time: false } },
    axes: [{ ...axis(), label: "Energy (eV)" }, { ...axis(), label: el.dataset.type === "xrayabs" ? "Intensity" : "Counts", size: 70 }],
    series: [{ label: "Energy (eV)" }, { label: "Intensity", stroke: css("--plot"), width: 1.5, points: { show: false } }],
    cursor: { drag: { x: true, y: false } },
    plugins: [edgePlugin],
  });
  let plot = new uPlot(opts(), data, el);
  const redraw = () => plot.redraw(false);
  showEdges.addEventListener("change", redraw);
  showMinor.addEventListener("change", redraw);
  new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: opts().height })).observe(el);
  // Rebuild with the new palette when the theme changes.
  new MutationObserver(() => {
    plot.destroy();
    plot = new uPlot(opts(), data, el);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

main();
