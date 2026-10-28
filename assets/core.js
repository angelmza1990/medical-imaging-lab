// Medical Imaging Lab — shared helpers: page shell, formatting, tooltip and charts.
(function () {
  const ROOT = document.documentElement.dataset.root || ".";

  const PAGES = [
    { id: "home", href: "", label: "Overview" },
    { id: "bloch", href: "spin-physics/", label: "Spin physics" },
    { id: "contrast", href: "contrast/", label: "Contrast" },
    { id: "kspace", href: "k-space/", label: "k-space" },
    { id: "cs", href: "accelerated-mri/", label: "Accelerated MRI" },
    { id: "ct", href: "ct/", label: "CT" },
    { id: "method", href: "method/", label: "Method" },
  ];

  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';

  // ---------- theme ----------
  function currentTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  try {
    const saved = localStorage.getItem("mil-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch (e) { /* no storage: follow the system setting */ }

  const themeListeners = [];
  function onTheme(fn) { themeListeners.push(fn); }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => themeListeners.forEach((f) => f()));

  // ---------- shell ----------
  function shell(pageId) {
    const header = document.createElement("header");
    header.className = "topbar";
    header.innerHTML = `
      <div class="wrap topbar-inner">
        <a class="brand" href="${ROOT}/">Medical Imaging Lab <span>· Angel Villanueva</span></a>
        <ul class="nav">${PAGES.map((p) => `<li><a href="${ROOT}/${p.href}"${p.id === pageId ? ' aria-current="page"' : ""}>${p.label}</a></li>`).join("")}</ul>
        <button class="theme-toggle" type="button" aria-label="Toggle dark mode"></button>
      </div>`;
    document.body.prepend(header);
    const btn = header.querySelector(".theme-toggle");
    const paint = () => { btn.innerHTML = currentTheme() === "dark" ? SUN : MOON; };
    paint();
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("mil-theme", next); } catch (e) { /* ignore */ }
      paint();
      themeListeners.forEach((f) => f());
    });

    const footer = document.createElement("footer");
    footer.className = "footer";
    footer.innerHTML = `
      <div class="wrap">
        <p>Simulations run in your browser on a synthetic phantom. Tissue parameters are approximate literature values.
        For education; not a medical device. <a href="${ROOT}/method/">Method</a>.</p>
        <p>Built by <a href="https://angelmza1990.github.io">Angel Villanueva</a> ·
        <a href="https://github.com/angelmza1990/medical-imaging-lab">Source on GitHub</a></p>
      </div>`;
    document.body.append(footer);
  }

  // ---------- data ----------
  const cache = {};
  function load(name) {
    if (!cache[name]) {
      cache[name] = fetch(`${ROOT}/data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${name}.json`);
        return r.json();
      });
    }
    return cache[name];
  }
  const parseMonth = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 15);
  const parseDay = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

  // ---------- formatting ----------
  const MINUS = "−";
  function pct(x, d = 1) {
    if (x == null || Number.isNaN(x)) return "–";
    return (x * 100).toFixed(d).replace("-", MINUS) + "%";
  }
  function spct(x, d = 1) {
    if (x == null || Number.isNaN(x)) return "–";
    const a = Math.abs(x) * 100;
    const s = a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toFixed(d);
    if (+s === 0) return (0).toFixed(d) + "%";
    return (x > 0 ? "+" : MINUS) + s + "%";
  }
  function num(x, d) {
    if (x == null) return "–";
    if (d == null) d = Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 10 ? 2 : 3;
    return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", MINUS);
  }
  const fmtMonth = d3.timeFormat("%b %Y");
  const fmtDay = d3.timeFormat("%b %-d, %Y");
  const signClass = (x) => (x == null ? "" : x > 0 ? "pos" : x < 0 ? "neg" : "");

  // Six classes, three per side, no neutral band: the sign is always readable.
  function retClass(r) {
    if (r == null) return "empty";
    if (r <= -0.25) return "r-n3";
    if (r <= -0.1) return "r-n2";
    if (r < 0) return "r-n1";
    if (r < 0.1) return "r-p1";
    if (r < 0.25) return "r-p2";
    return "r-p3";
  }
  const RET_LEGEND = [
    ["r-n3", "−25% or worse"], ["r-n2", "−25% to −10%"], ["r-n1", "−10% to 0%"],
    ["r-p1", "0% to +10%"], ["r-p2", "+10% to +25%"], ["r-p3", "+25% or better"],
  ];
  function retLegend(el) {
    el.className = "legend";
    el.innerHTML = RET_LEGEND.map(([c, l]) => `<span class="key"><span class="sw ${c}"></span>${l}</span>`).join("");
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const seriesColor = (i) => `var(--s${(i % 8) + 1})`;

  // ---------- tooltip ----------
  let tipEl;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "tooltip";
      tipEl.setAttribute("role", "status");
      document.body.append(tipEl);
    }
    return tipEl;
  }
  // rows: [{color, value, label}] — text is set with textContent.
  function showTip(evt, title, rows) {
    const t = tip();
    t.replaceChildren();
    const h = document.createElement("div");
    h.className = "tt-title";
    h.textContent = title;
    t.append(h);
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "tt-row";
      if (r.color) {
        const i = document.createElement("i");
        i.style.background = r.color;
        row.append(i);
      }
      const b = document.createElement("b");
      b.textContent = r.value;
      if (r.cls) b.className = r.cls;
      const s = document.createElement("span");
      s.textContent = r.label || "";
      row.append(b, s);
      t.append(row);
    }
    const x = evt.clientX, y = evt.clientY;
    t.classList.add("show");
    const w = t.offsetWidth, hgt = t.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + hgt > innerHeight - 8) top = y - hgt - 14;
    t.style.left = Math.max(8, left) + "px";
    t.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { if (tipEl) tipEl.classList.remove("show"); }
  addEventListener("scroll", hideTip, { passive: true });

  // ---------- responsive render ----------
  function responsive(el, draw) {
    // Calling a chart again on the same element only swaps its draw function.
    if (el.__draw) { el.__draw = draw; el.__run(); return el.__run; }
    el.__draw = draw;
    let last = 0;
    const run = () => {
      const w = el.clientWidth;
      if (!w) return;
      last = w;
      el.__draw(w);
    };
    el.__run = run;
    new ResizeObserver(() => { if (el.clientWidth !== last) run(); }).observe(el);
    onTheme(run);
    run();
    return run;
  }

  // ---------- line chart ----------
  // opts: series [{id, name, color, values: [[Date, v]]}], log, yFormat, tipFormat,
  //       height, recessions [[Date, Date]], annotations [{date, label}], area, baseline,
  //       endLabels, yDomain
  function lineChart(el, opts) {
    const o = Object.assign({ height: 360, yFormat: (v) => v, log: false, area: false, recessions: [], annotations: [] }, opts);
    return responsive(el, (W) => {
      const series = o.series.filter((s) => s.values.length);
      const labels = o.endLabels ?? series.length <= 4;
      const narrow = W < 560;
      // reserveRight keeps stacked charts aligned with one that has end labels
      const m = { top: o.annotations.length ? 30 : 12, right: (labels || o.reserveRight) && !narrow ? 112 : 12, bottom: 26, left: 50 };
      const H = narrow ? Math.min(o.height, 300) : o.height;
      const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

      const all = series.flatMap((s) => s.values);
      // xLinear: a numeric horizontal axis (time in ms, frequency...) instead of dates
      const x = (o.xLinear ? d3.scaleLinear() : d3.scaleTime()).domain(o.xDomain || d3.extent(all, (d) => d[0])).range([0, iw]);
      let yd = o.yDomain || d3.extent(all, (d) => d[1]);
      if (o.baseline != null) yd = [Math.min(yd[0], o.baseline), Math.max(yd[1], o.baseline)];
      const y = (o.log ? d3.scaleLog() : d3.scaleLinear()).domain(yd).range([ih, 0]);
      if (!o.log) y.nice();

      const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", o.label || "");
      const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

      // recession bands
      g.append("g").selectAll("rect").data(o.recessions.filter((r) => r[1] >= x.domain()[0] && r[0] <= x.domain()[1]))
        .join("rect")
        .attr("x", (r) => x(Math.max(r[0], x.domain()[0])))
        .attr("width", (r) => Math.max(1, x(Math.min(r[1], x.domain()[1])) - x(Math.max(r[0], x.domain()[0]))))
        .attr("y", 0).attr("height", ih).attr("fill", "var(--recession)");

      // grid + axes
      const yTicks = o.log ? logTicks(y) : y.ticks(narrow ? 4 : 6);
      g.append("g").attr("class", "grid").selectAll("line").data(yTicks).join("line")
        .attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickValues(yTicks).tickFormat(o.yFormat).tickSize(0).tickPadding(8));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
        .call(d3.axisBottom(x).ticks(narrow ? 4 : 8).tickFormat(o.xFormat || null).tickSizeOuter(0).tickSize(4).tickPadding(6));
      if (o.baseline != null && !o.log) {
        g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", iw).attr("y1", y(o.baseline)).attr("y2", y(o.baseline));
      }

      // annotations: hairline + label, staggered on two rows
      const ann = g.append("g").attr("class", "annot");
      let lastX = [-1e9, -1e9];
      o.annotations.filter((a) => a.date >= x.domain()[0] && a.date <= x.domain()[1]).forEach((a) => {
        const ax = x(a.date);
        const row = ax - lastX[0] > 90 ? 0 : ax - lastX[1] > 90 ? 1 : -1;
        if (row < 0) return; // skip a marker whose label would collide with the last two
        lastX[row] = ax;
        ann.append("line").attr("x1", ax).attr("x2", ax).attr("y1", -m.top + 14 + row * 12).attr("y2", ih);
        ann.append("text").attr("x", ax + 4).attr("y", -m.top + 10 + row * 12 + 4).text(a.label);
      });

      // lines
      const line = d3.line().defined((d) => d[1] != null).x((d) => x(d[0])).y((d) => y(d[1]));
      if (o.area) {
        const area = d3.area().defined((d) => d[1] != null).x((d) => x(d[0])).y0(y(o.baseline ?? 0)).y1((d) => y(d[1]));
        g.append("g").selectAll("path").data(series).join("path")
          .attr("d", (s) => area(s.values)).attr("fill", (s) => s.color).attr("fill-opacity", series.length > 1 ? 0 : 0.14);
      }
      g.append("g").selectAll("path").data(series).join("path")
        .attr("d", (s) => line(s.values)).attr("fill", "none").attr("stroke", (s) => s.color)
        .attr("stroke-width", (s) => s.width || (series.length > 6 ? 1.5 : 2)).attr("stroke-linejoin", "round")
        .attr("opacity", (s) => s.opacity ?? 1);

      // end labels, pushed apart so they never overlap
      if (labels && !narrow) {
        const ends = series.map((s) => {
          const lastPt = s.values.filter((d) => d[1] != null).at(-1);
          return { s, y: y(lastPt[1]), v: lastPt[1] };
        }).sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
        const eg = g.append("g").attr("transform", `translate(${iw + 8},0)`);
        ends.forEach((e) => {
          eg.append("line").attr("x1", 0).attr("x2", 8).attr("y1", e.y).attr("y2", e.y)
            .attr("stroke", e.s.color).attr("stroke-width", 2);
          eg.append("text").attr("x", 12).attr("y", e.y + 4).style("fill", "var(--ink-2)").text(e.s.short || e.s.name);
        });
      }

      // crosshair + tooltip
      const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", ih).style("display", "none");
      const dots = g.append("g").style("display", "none");
      const bis = d3.bisector((d) => d[0]).center;
      g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent")
        .on("pointermove", (evt) => {
          const [px] = d3.pointer(evt);
          const xd = x.invert(px);
          const pts = series.map((s) => {
            const i = bis(s.values, xd);
            return { s, d: s.values[i] };
          }).filter((p) => p.d && (o.xLinear || Math.abs(p.d[0] - xd) < 1000 * 86400 * 120) && p.d[1] != null);
          if (!pts.length) return;
          const at = pts.reduce((a, b) => (Math.abs(b.d[0] - xd) < Math.abs(a.d[0] - xd) ? b : a)).d[0];
          cross.style("display", null).attr("x1", x(at)).attr("x2", x(at));
          dots.style("display", null).selectAll("circle").data(pts).join("circle")
            .attr("r", 3.5).attr("cx", (p) => x(p.d[0])).attr("cy", (p) => y(p.d[1]))
            .attr("fill", (p) => p.s.color).attr("stroke", "var(--surface)").attr("stroke-width", 2);
          const rows = pts.slice().sort((a, b) => b.d[1] - a.d[1])
            .map((p) => ({ color: p.s.color, value: (o.tipFormat || o.yFormat)((o.rawValue && o.rawValue(p.s, p.d)) ?? p.d[1]), label: p.s.name }));
          showTip(evt, (o.tipDate || fmtMonth)(at), rows);
        })
        .on("pointerleave", () => { cross.style("display", "none"); dots.style("display", "none"); hideTip(); });

      el.replaceChildren(svg.node());
    });
  }

  function logTicks(y) {
    const [a, b] = y.domain();
    const out = [];
    for (let p = Math.floor(Math.log10(a)); p <= Math.ceil(Math.log10(b)); p++) {
      for (const k of [1, 2, 5]) {
        const v = k * 10 ** p;
        if (v >= a && v <= b) out.push(v);
      }
    }
    // keep the axis readable: thin to powers of ten when the range is wide
    return out.length > 9 ? out.filter((v) => Math.log10(v) % 1 === 0) : out;
  }

  // ---------- annual bar chart ----------
  // data: [{year, value, ytd}]
  function barChart(el, opts) {
    const o = Object.assign({ height: 300 }, opts);
    return responsive(el, (W) => {
      const data = o.data;
      const narrow = W < 560;
      const H = narrow ? 240 : o.height;
      const m = { top: 16, right: 8, bottom: 26, left: 46 };
      const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
      const x = d3.scaleBand().domain(data.map((d) => d.year)).range([0, iw]).paddingInner(data.length > 40 ? 0.18 : 0.25);
      const ext = d3.extent(data, (d) => d.value);
      // headroom so the best/worst labels clear the plot edges
      const y = d3.scaleLinear().domain([Math.min(0, ext[0] * 1.12), Math.max(0, ext[1] * 1.12)]).nice().range([ih, 0]);

      const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", o.label || "");
      const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
      const ticks = y.ticks(narrow ? 4 : 6);
      g.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickValues(ticks).tickFormat((v) => pct(v, 0)).tickSize(0).tickPadding(8));
      const every = Math.ceil(data.length / (narrow ? 5 : 12));
      const yearTicks = data.map((d) => d.year).filter((yr) => yr % (every > 5 ? 10 : every > 2 ? 5 : every) === 0);
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
        .call(d3.axisBottom(x).tickValues(yearTicks.length ? yearTicks : x.domain()).tickSize(0).tickPadding(8));

      const r = Math.min(3, x.bandwidth() / 3);
      const bar = (d) => {
        const x0 = x(d.year), w = x.bandwidth(), y0 = y(0), y1 = y(d.value);
        const h = Math.abs(y1 - y0);
        if (h < 0.5) return `M${x0},${y0}h${w}`;
        const rr = Math.min(r, h);
        return d.value >= 0
          ? `M${x0},${y0}V${y1 + rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + w - rr}Q${x0 + w},${y1} ${x0 + w},${y1 + rr}V${y0}Z`
          : `M${x0},${y0}V${y1 - rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + w - rr}Q${x0 + w},${y1} ${x0 + w},${y1 - rr}V${y0}Z`;
      };
      g.append("g").selectAll("path").data(data).join("path")
        .attr("d", bar)
        .attr("fill", (d) => (d.value >= 0 ? "var(--pos-3)" : "var(--neg-3)"))
        .attr("fill-opacity", (d) => (d.ytd ? 0.45 : 1));
      g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0));

      // label the best and worst years only
      if (!narrow && data.length > 3) {
        const full = data.filter((d) => !d.ytd);
        const best = d3.greatest(full, (d) => d.value), worst = d3.least(full, (d) => d.value);
        for (const d of [best, worst]) {
          if (!d) continue;
          g.append("text").attr("x", x(d.year) + x.bandwidth() / 2).attr("text-anchor", "middle")
            .attr("y", d.value >= 0 ? y(d.value) - 5 : y(d.value) + 13)
            .style("fill", "var(--ink-2)").text(`${d.year}: ${spct(d.value, 0)}`);
        }
      }

      // hit targets: full column height
      g.append("g").selectAll("rect").data(data).join("rect")
        .attr("x", (d) => x(d.year) - (x.step() - x.bandwidth()) / 2).attr("width", x.step())
        .attr("y", 0).attr("height", ih).attr("fill", "transparent")
        .on("pointermove", (evt, d) => {
          showTip(evt, d.ytd ? `${d.year} (year to date)` : String(d.year),
            [{ value: spct(d.value), cls: signClass(d.value), label: o.name || "" }].concat(o.extra ? o.extra(d) : []));
        })
        .on("pointerleave", hideTip);
      el.replaceChildren(svg.node());
    });
  }

  // ---------- segmented buttons ----------
  function seg(el, options, value, onChange) {
    el.className = "seg";
    el.setAttribute("role", "group");
    el.replaceChildren();
    for (const [v, label] of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(v === value));
      b.addEventListener("click", () => {
        el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        onChange(v);
      });
      el.append(b);
    }
  }

  // Sortable table header: th[data-sort] keys, rows re-rendered by caller.
  function sortable(table, state, rerender) {
    table.querySelectorAll("th[data-sort]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.sort === state.key ? (state.dir < 0 ? "descending" : "ascending") : "none");
      th.onclick = () => {
        if (state.key === th.dataset.sort) state.dir = -state.dir;
        else { state.key = th.dataset.sort; state.dir = -1; }
        rerender();
      };
    });
  }

  function fail(err) {
    const p = document.createElement("p");
    p.className = "wrap note";
    p.textContent = `The data could not be loaded (${err.message}). If you opened the file directly, serve the folder with "python3 -m http.server".`;
    document.querySelector("main").prepend(p);
    console.error(err);
  }

  window.MH = {
    ROOT, shell, load, parseMonth, parseDay, pct, spct, num, fmtMonth, fmtDay, signClass,
    retClass, retLegend, css, seriesColor, showTip, hideTip, lineChart, barChart, seg, sortable, onTheme, responsive, fail,
  };
})();
