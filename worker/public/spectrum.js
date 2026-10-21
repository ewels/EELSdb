// Spectrum page: plot the data file with uPlot and mark exSpy edge onsets for the spectrum's elements.

for (const button of document.querySelectorAll("[data-open]")) {
  button.addEventListener("click", () => document.getElementById(button.dataset.open).showModal());
}
for (const button of document.querySelectorAll("dialog [data-close]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}
for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.querySelector(".copy-label");
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(target.textContent);
      button.classList.add("copied");
      label.textContent = "Copied";
      setTimeout(() => {
        button.classList.remove("copied");
        label.textContent = "Copy";
      }, 1600);
    } catch {
      getSelection().selectAllChildren(target);
    }
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
    await document.fonts.ready;
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
  edges.sort((a, b) => a.energy - b.energy);
  const family = getComputedStyle(document.body).fontFamily;
  // "Ti L2,3" draws as "Ti L" plus a subscript "2,3", like the typeset edge names elsewhere.
  const drawLabel = (ctx, label, x, y, dpr, alignRight) => {
    const [, main, sub] = label.match(/^(.* [A-Z])(.*)$/) || [, label, ""];
    const mainFont = `600 ${12 * dpr}px ${family}`;
    const subFont = `600 ${9 * dpr}px ${family}`;
    ctx.font = mainFont;
    const w1 = ctx.measureText(main).width;
    ctx.font = subFont;
    const w2 = ctx.measureText(sub).width;
    const x0 = alignRight ? x - w1 - w2 : x;
    ctx.font = mainFont;
    ctx.fillText(main, x0, y);
    ctx.font = subFont;
    ctx.fillText(sub, x0 + w1, y + 5 * dpr);
    return w1 + w2;
  };
  const edgePlugin = {
    hooks: {
      draw: (u) => {
        if (!showEdges.checked) return;
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        const right = u.bbox.left + u.bbox.width;
        const colours = { major: css("--edge"), minor: css("--muted") };
        ctx.save();
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.lineWidth = dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        let row = 0;
        for (const edge of edges) {
          if (!edge.major && !showMinor.checked) continue;
          const px = Math.round(u.valToPos(edge.energy, "x", true)) + 0.5;
          if (px < u.bbox.left || px > right) continue;
          const colour = edge.major ? colours.major : colours.minor;
          ctx.strokeStyle = colour;
          ctx.beginPath();
          ctx.moveTo(px, u.bbox.top);
          ctx.lineTo(px, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.fillStyle = colour;
          const y = u.bbox.top + 4 * dpr + (row++ % 3) * 17 * dpr;
          ctx.font = `600 ${12 * dpr}px ${family}`;
          const nearRight = px + 4 * dpr + ctx.measureText(edge.label).width > right;
          drawLabel(ctx, edge.label, nearRight ? px - 4 * dpr : px + 4 * dpr, y, dpr, nearRight);
        }
        ctx.restore();
      },
    },
  };

  const big = Math.max(...data[1].map(Math.abs)) >= 1e5;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });
  const tickFont = `12px ${family}`;
  // Fit the y axis to its widest tick label so labels never run into the axis title.
  const ySize = (u, values, axisIdx, cycleNum) => {
    const axis = u.axes[axisIdx];
    if (cycleNum > 1) return axis._size;
    let width = 0;
    if (values) {
      u.ctx.font = `${12 * (devicePixelRatio || 1)}px ${family}`;
      for (const v of values) width = Math.max(width, u.ctx.measureText(v).width);
    }
    return Math.ceil(width / (devicePixelRatio || 1)) + 36;
  };
  const axis = () => ({
    stroke: css("--muted"),
    font: tickFont,
    labelFont: `500 13px ${family}`,
    grid: { stroke: css("--rule"), width: 1 },
    ticks: { stroke: css("--line"), width: 1, size: 5 },
  });
  const opts = () => ({
    width: el.clientWidth,
    height: Math.max(280, Math.min(460, el.clientWidth * 0.5)),
    scales: { x: { time: false } },
    axes: [
      { ...axis(), label: "Energy (eV)", labelGap: 4 },
      {
        ...axis(),
        label: el.dataset.type === "xrayabs" ? "Intensity" : "Counts",
        size: ySize,
        values: (u, splits) => splits.map((v) => (big ? compact.format(v) : plain.format(v))),
      },
    ],
    series: [
      { label: "Energy (eV)" },
      { label: el.dataset.type === "xrayabs" ? "Intensity" : "Counts", stroke: css("--plot"), width: 1.5, points: { show: false } },
    ],
    legend: { markers: { show: false } },
    cursor: { drag: { x: true, y: false }, points: { show: false } },
    plugins: [edgePlugin],
  });

  el.innerHTML = "";
  let plot = new uPlot(opts(), data, el);
  const redraw = () => plot.redraw(false);
  showEdges.addEventListener("change", redraw);
  showMinor.addEventListener("change", redraw);
  new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: opts().height })).observe(el);
  // Canvas colours are resolved once, so rebuild when the scheme changes.
  const rebuild = () => {
    plot.destroy();
    plot = new uPlot(opts(), data, el);
  };
  new MutationObserver(rebuild).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuild);
}

main();
