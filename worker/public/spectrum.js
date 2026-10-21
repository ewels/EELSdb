// Spectrum page: plot the data file with uPlot and mark exSpy edge onsets for the spectrum's elements.

for (const button of document.querySelectorAll("[data-open]")) {
  button.addEventListener("click", () => document.getElementById(button.dataset.open).showModal());
}
for (const radio of document.querySelectorAll("[name=download-format]")) {
  radio.addEventListener("change", () => {
    const link = document.getElementById("download-link");
    link.href = radio.value;
    link.download = radio.dataset.name;
    link.querySelector(".dl-name").textContent = `Download ${radio.dataset.name}`;
  });
}
// A click on the backdrop lands on the dialog itself, outside its box.
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
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

async function load(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(res.statusText);
  const data = parseSpectrum(await res.text());
  if (data[0].length < 2) throw new Error("no data");
  return data;
}

async function main() {
  const el = document.getElementById("plot");
  if (!el || !el.dataset.src) return;
  const versions = JSON.parse(el.dataset.versions || "[]");
  // Colours for drawing; an image export swaps in the chosen theme's while it draws.
  let paint = css;
  let yLabel = versions[0]?.axis ?? (el.dataset.type === "xrayabs" ? "Intensity" : "Counts");
  let data;
  try {
    await document.fonts.ready;
    data = await load(el.dataset.src);
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
        const colours = { major: paint("--edge"), minor: paint("--muted") };
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
    stroke: paint("--muted"),
    font: tickFont,
    labelFont: `500 13px ${family}`,
    grid: { stroke: paint("--rule"), width: 1 },
    ticks: { stroke: paint("--line"), width: 1, size: 5 },
  });
  // Spectra from the viewer's computer, drawn on top; never uploaded.
  const compares = [];
  const scaleBox = document.getElementById("compare-scale");
  // With "Scale to match", each compared spectrum gets its own y scale and right-hand axis, in its colour.
  const scaleOf = (i) => (scaleBox.checked ? `c${i}` : "y");
  const colour = (i) => paint(`--compare-${(i % 4) + 1}`);
  // Only where this spectrum has data, so a wider file does not squeeze the reference.
  const plotData = () => {
    if (!compares.length) return data;
    const [lo, hi] = [data[0][0], data[0].at(-1)];
    return uPlot.join([
      data,
      ...compares.map((c) => {
        const keep = c.x.map((_, i) => i).filter((i) => c.x[i] >= lo && c.x[i] <= hi);
        return [keep.map((i) => c.x[i]), keep.map((i) => c.y[i])];
      }),
    ]);
  };
  // Each compared spectrum's axis is a linear map of the main one (value = main × k + b), so zooming scales both alike.
  // Dragging the top half of its axis moves its maximum, the bottom half its minimum; double-click resets it.
  let yRange = null;
  const link = (c, min, max) => {
    const k = (max - min) / (yRange[1] - yRange[0]);
    c.map = { k, b: min - yRange[0] * k };
  };
  const mapped = (c) => [yRange[0] * c.map.k + c.map.b, yRange[1] * c.map.k + c.map.b];
  const axisDrag = {
    hooks: {
      ready: (u) => {
        if (!scaleBox.checked) return;
        compares.forEach((c, i) => c.map ?? link(c, u.scales[`c${i}`].min, u.scales[`c${i}`].max));
        u.root.querySelectorAll(".u-axis").forEach((node, idx) => {
          const c = compares[idx - 2];
          if (!c) return;
          const key = scaleOf(idx - 2);
          node.classList.add("axis-drag");
          node.title = "Drag the top half to move the maximum, the bottom half to move the minimum. Double-click to reset.";
          node.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            node.setPointerCapture(e.pointerId);
            const box = node.getBoundingClientRect();
            const top = e.clientY < box.top + box.height / 2;
            const [y0, min, max] = [e.clientY, ...mapped(c)];
            const move = (m) => {
              const f = Math.exp((m.clientY - y0) / 150);
              const [lo, hi] = top ? [min, min + (max - min) * f] : [max - (max - min) / f, max];
              link(c, lo, hi);
              u.setScale(key, { min: lo, max: hi });
            };
            node.addEventListener("pointermove", move);
            node.addEventListener("pointerup", () => node.removeEventListener("pointermove", move), { once: true });
          });
          node.addEventListener("dblclick", () => {
            c.map = null;
            rebuild();
          });
        });
      },
    },
  };
  const format = (ys) => {
    const big = Math.max(...ys.map(Math.abs)) >= 1e5;
    return (u, splits) => splits.map((v) => (big ? compact.format(v) : plain.format(v)));
  };

  const opts = () => {
    const dual = compares.length > 0 && scaleBox.checked;
    return {
    width: el.clientWidth,
    height: Math.max(280, Math.min(460, el.clientWidth * 0.5)),
    scales: {
      x: { time: false },
      // The main scale is listed first so it is ranged before the compared ones, which follow it.
      y: { range: (u, lo, hi) => (yRange = uPlot.rangeNum(lo, hi, 0.1, true)) },
      ...Object.fromEntries(
        compares.map((c, i) => [`c${i}`, { range: (u, lo, hi) => (c.map && yRange ? mapped(c) : uPlot.rangeNum(lo, hi, 0.1, true)) }]),
      ),
    },
    axes: [
      { ...axis(), label: "Energy (eV)", labelGap: 4 },
      {
        ...axis(),
        ...(dual ? { stroke: paint("--plot") } : {}),
        label: yLabel,
        size: ySize,
        values: format(data[1]),
      },
      ...(dual
        ? compares.map((c, i) => ({ ...axis(), scale: scaleOf(i), side: 1, stroke: colour(i), grid: { show: false }, size: ySize, values: format(c.y) }))
        : []),
    ],
    series: [
      { label: "Energy (eV)" },
      { label: yLabel, stroke: paint("--plot"), width: 1.5, points: { show: false } },
      ...compares.map((c, i) => ({ label: c.name, scale: scaleOf(i), stroke: colour(i), width: 1.5, points: { show: false }, spanGaps: true })),
    ],
    legend: { markers: { show: compares.length > 0 } },
    cursor: { drag: { x: true, y: false }, points: { show: false } },
    plugins: [edgePlugin, axisDrag],
    };
  };

  el.innerHTML = "";
  let plot = new uPlot(opts(), plotData(), el);
  const redraw = () => plot.redraw(false);
  showEdges.addEventListener("change", redraw);
  showMinor.addEventListener("change", redraw);
  new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: opts().height })).observe(el);
  // Canvas colours are resolved once, so rebuild when the scheme changes.
  const rebuild = () => {
    plot.destroy();
    plot = new uPlot(opts(), plotData(), el);
  };
  new MutationObserver(rebuild).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuild);
  const box = document.getElementById("compare");
  const input = document.getElementById("compare-file");
  const status = document.getElementById("compare-status");
  const list = document.getElementById("compare-list");
  if (box) box.hidden = false;
  const NOTE = status?.textContent;
  const update = () => {
    scaleBox.parentElement.hidden = !compares.length;
    list.replaceChildren(
      ...compares.map((c, i) => {
        const li = document.createElement("li");
        li.innerHTML = '<span class="swatch" aria-hidden="true"></span> <span class="name"></span> <button type="button" class="link-button">Remove</button>';
        li.querySelector(".swatch").style.background = `var(--compare-${(i % 4) + 1})`;
        li.querySelector(".name").textContent = c.name;
        li.querySelector("button").setAttribute("aria-label", `Remove ${c.name}`);
        li.querySelector("button").addEventListener("click", () => {
          compares.splice(compares.indexOf(c), 1);
          update();
          status.textContent = NOTE;
        });
        return li;
      }),
    );
    list.hidden = !compares.length;
    rebuild();
  };
  async function addFiles(files) {
    for (const file of files) {
      const text = /\.(msa|emsa|txt|csv)$/i.test(file.name);
      status.textContent = text ? `Reading ${file.name}…` : "Getting the file reader ready (the first time takes a few seconds)…";
      try {
        let [x, y] = text ? parseSpectrum(await file.text()) : await (await import("/pyreader.js")).readXY(file);
        if (!text) {
          const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
          [x, y] = [order.map((i) => x[i]), order.map((i) => y[i])];
        }
        if (x.length < 2) throw new Error("No spectrum found in this file.");
        compares.push({ name: file.name, x, y });
        update();
        const overlap = x[0] < data[0].at(-1) && x.at(-1) > data[0][0];
        status.textContent = overlap ? NOTE : `${file.name} does not overlap the energy range of this spectrum.`;
      } catch (e) {
        status.textContent = `${file.name} could not be read: ${String(e.message).split("\n").filter(Boolean).pop()}`;
      }
    }
  }
  input?.addEventListener("change", async () => {
    await addFiles([...input.files]);
    input.value = "";
  });
  scaleBox?.addEventListener("change", rebuild);

  // While files are dragged over the page, the plot and the compare button become drop targets.
  const drop = document.getElementById("plot-drop");
  if (drop) {
    const targets = [drop, box];
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    let depth = 0;
    const hide = () => {
      depth = 0;
      drop.hidden = true;
      box.classList.remove("dragging");
      for (const t of targets) t.classList.remove("over");
    };
    addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      depth++;
      drop.hidden = false;
      box.classList.add("dragging");
    });
    addEventListener("dragleave", (e) => {
      if (hasFiles(e) && --depth <= 0) hide();
    });
    addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
    addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const onTarget = targets.some((t) => t.contains(e.target));
      hide();
      if (onTarget) addFiles([...e.dataTransfer.files]);
    });
    for (const t of targets) {
      t.addEventListener("dragover", () => t.classList.add("over"));
      t.addEventListener("dragleave", (e) => t.contains(e.relatedTarget) || t.classList.remove("over"));
    }
  }

  const picker = document.getElementById("plot-version");
  picker?.addEventListener("change", async () => {
    const v = versions[picker.value];
    try {
      data = await load(v.src);
      yLabel = v.axis;
      rebuild();
    } catch {
      picker.setCustomValidity("This version could not be read for plotting.");
      picker.reportValidity();
    }
  });

  // ---- Save the current view as an image -----------------------------------------------------
  const W = 1200;
  const H = 560;
  const HEAD = 64;
  const title = document.querySelector("h1")?.textContent ?? "";
  const pageUrl = `EELSdb • ${location.origin}${location.pathname}`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

  /** A copy of the plot at a fixed size in the given theme, over the current energy range; call done() after use. */
  async function themedPlot(theme) {
    const holder = document.createElement("div");
    holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;color-scheme:${theme}`;
    const themedProbe = document.createElement("span");
    holder.append(themedProbe);
    document.body.append(holder);
    paint = (name) => {
      themedProbe.style.color = `var(${name})`;
      return getComputedStyle(themedProbe).color;
    };
    const o = { ...opts(), width: W, height: H, cursor: { show: false }, legend: { show: false } };
    const u = new uPlot(o, plotData(), holder);
    u.setScale("x", { min: plot.scales.x.min, max: plot.scales.x.max });
    await new Promise((r) => requestAnimationFrame(() => r()));
    const colours = { bg: paint("--bg"), ink: paint("--ink"), muted: paint("--muted"), rule: paint("--rule"), line: paint("--line"), edge: paint("--edge") };
    return {
      u,
      colours,
      done: () => {
        paint = css;
        u.destroy();
        holder.remove();
      },
    };
  }

  const legendItems = (u) => u.series.slice(1).map((s) => ({ label: s.label, colour: s._stroke ?? s.stroke }));

  async function savePng(theme) {
    const { u, colours, done } = await themedPlot(theme);
    const src = u.ctx.canvas;
    const r = src.width / u.width;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height + HEAD * r;
    const ctx = out.getContext("2d");
    ctx.fillStyle = colours.bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = colours.ink;
    ctx.font = `600 ${18 * r}px ${family}`;
    ctx.fillText(title, 16 * r, 26 * r);
    let x = 16 * r;
    ctx.font = `${13 * r}px ${family}`;
    for (const item of legendItems(u)) {
      ctx.fillStyle = typeof item.colour === "function" ? item.colour(u, 1) : item.colour;
      ctx.fillRect(x, 44 * r, 14 * r, 3 * r);
      ctx.fillStyle = colours.muted;
      ctx.fillText(item.label, x + 20 * r, 50 * r);
      x += (ctx.measureText(item.label).width + 44 * r);
    }
    ctx.textAlign = "right";
    ctx.fillText(pageUrl, out.width - 16 * r, 26 * r);
    ctx.drawImage(src, 0, HEAD * r);
    done();
    out.toBlob((blob) => give(blob, "png"));
  }

  async function saveSvg(theme) {
    const { u, colours, done } = await themedPlot(theme);
    const r = u.ctx.canvas.width / u.width;
    const [L, T, PW, PH] = [u.bbox.left / r, u.bbox.top / r + HEAD, u.bbox.width / r, u.bbox.height / r];
    const parts = [];
    const text = (x, y, t, attrs = "") => parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs}>${esc(t)}</text>`);
    const ax = u.axes;
    // Grid and tick labels.
    (ax[0]._splits ?? []).forEach((v, k) => {
      const x = L + u.valToPos(v, "x");
      parts.push(`<line x1="${x.toFixed(1)}" y1="${T}" x2="${x.toFixed(1)}" y2="${T + PH}" stroke="${colours.rule}"/>`);
      text(x, T + PH + 18, ax[0]._values?.[k] ?? v, `text-anchor="middle" fill="${colours.muted}" font-size="12"`);
    });
    (ax[1]._splits ?? []).forEach((v, k) => {
      const y = T + u.valToPos(v, "y");
      parts.push(`<line x1="${L}" y1="${y.toFixed(1)}" x2="${L + PW}" y2="${y.toFixed(1)}" stroke="${colours.rule}"/>`);
      text(L - 8, y + 4, ax[1]._values?.[k] ?? v, `text-anchor="end" fill="${typeof ax[1].stroke === "function" ? ax[1].stroke(u, 1) : ax[1].stroke}" font-size="12"`);
    });
    let right = L + PW;
    ax.slice(2).forEach((a) => {
      const stroke = typeof a.stroke === "function" ? a.stroke(u, 0) : a.stroke;
      (a._splits ?? []).forEach((v, k) => text(right + 8, T + u.valToPos(v, a.scale) + 4, a._values?.[k] ?? v, `fill="${stroke}" font-size="12"`));
      right += a._size;
    });
    text(L + PW / 2, T + PH + 44, "Energy (eV)", `text-anchor="middle" fill="${colours.muted}" font-size="13"`);
    text(0, 0, yLabel, `transform="translate(18 ${T + PH / 2}) rotate(-90)" text-anchor="middle" fill="${colours.muted}" font-size="13"`);
    // Series, clipped to the plot area. undefined is a point only another series has (from uPlot.join) and is skipped;
    // null is a real gap and starts a new path, as on the canvas.
    parts.push(`<clipPath id="area"><rect x="${L}" y="${T}" width="${PW}" height="${PH}"/></clipPath><g clip-path="url(#area)" fill="none" stroke-width="1.5">`);
    u.series.forEach((s, i) => {
      if (i === 0) return;
      const stroke = typeof s.stroke === "function" ? s.stroke(u, i) : s.stroke;
      let d = "";
      let pen = "M";
      u.data[0].forEach((xv, k) => {
        const yv = u.data[i][k];
        if (yv === undefined) return;
        if (yv === null) return s.spanGaps || (pen = "M");
        d += `${pen}${(L + u.valToPos(xv, "x")).toFixed(2)} ${(T + u.valToPos(yv, s.scale)).toFixed(2)}`;
        pen = "L";
      });
      parts.push(`<path d="${d}" stroke="${stroke}"/>`);
    });
    if (showEdges.checked) {
      edges.filter((e) => (e.major || showMinor.checked) && e.energy >= u.scales.x.min && e.energy <= u.scales.x.max).forEach((e, k) => {
        const x = L + u.valToPos(e.energy, "x");
        const c = e.major ? colours.edge : colours.muted;
        parts.push(`<line x1="${x.toFixed(1)}" y1="${T}" x2="${x.toFixed(1)}" y2="${T + PH}" stroke="${c}" stroke-dasharray="3 3" stroke-width="1"/>`);
        parts.push(`<text x="${(x + 4).toFixed(1)}" y="${T + 14 + (k % 3) * 17}" fill="${c}" font-size="12" font-weight="600" stroke="none">${esc(e.label)}</text>`);
      });
    }
    parts.push("</g>");
    // Title, legend and address.
    text(16, 26, title, `fill="${colours.ink}" font-size="18" font-weight="600"`);
    text(W - 16, 26, pageUrl, `text-anchor="end" fill="${colours.muted}" font-size="13"`);
    let x = 16;
    for (const item of legendItems(u)) {
      const colour = typeof item.colour === "function" ? item.colour(u, 1) : item.colour;
      parts.push(`<rect x="${x}" y="44" width="14" height="3" fill="${colour}"/>`);
      text(x + 20, 50, item.label, `fill="${colours.muted}" font-size="13"`);
      x += 44 + item.label.length * 7.5;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + HEAD}" viewBox="0 0 ${W} ${H + HEAD}" font-family="${esc(family)}">
<rect width="100%" height="100%" fill="${colours.bg}"/>
${parts.join("\n")}
</svg>`;
    done();
    give(new Blob([svg], { type: "image/svg+xml" }), "svg");
  }

  function give(blob, ext) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${location.pathname.split("/").filter(Boolean).pop()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  for (const button of document.querySelectorAll("[data-save-plot]")) {
    button.addEventListener("click", () => {
      const [fmt, theme] = button.dataset.savePlot.split("-");
      (fmt === "svg" ? saveSvg : savePng)(theme);
      button.closest("[popover]")?.hidePopover();
    });
  }
}

/** File metadata as a flat table of dotted paths, fetched the first time it is opened. */
const flatten = (value, path = "", out = []) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out.push([path, Array.isArray(value) ? JSON.stringify(value) : String(value)]);
  }
  return out;
};
for (const details of document.querySelectorAll("details.file-metadata")) {
  details.addEventListener("toggle", async () => {
    if (!details.open || details.dataset.loaded) return;
    details.dataset.loaded = "1";
    const table = details.querySelector("table");
    try {
      const rows = flatten(await (await fetch(details.dataset.src)).json());
      for (const [k, v] of rows) {
        const tr = table.insertRow();
        tr.append(Object.assign(document.createElement("th"), { textContent: k }), Object.assign(document.createElement("td"), { textContent: v }));
      }
      const filter = details.querySelector(".metadata-filter");
      filter.hidden = rows.length < 20;
      filter.addEventListener("input", () => {
        const q = filter.value.toLowerCase();
        for (const tr of table.rows) tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q);
      });
    } catch {
      table.insertRow().insertCell().textContent = "The metadata could not be loaded. You can still download it.";
    }
  });
}

main();
