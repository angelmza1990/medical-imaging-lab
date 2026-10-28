// Image analysis: denoise the phantom's MR images, strip the skull with Otsu's threshold, segment the tissues
// with k-means and score every step against the phantom's true anatomy.
(function () {
  const I = window.Imaging;
  MH.shell("analysis");
  const $ = (id) => document.getElementById(id);
  const N = 128;
  const FOV_CM = 24, PIXEL_CM2 = (FOV_CM / N) ** 2;
  const CLASSES = ["fat", "gm", "wm", "csf", "lesion"];
  const COLOR_VAR = { fat: "--s4", gm: "--s3", wm: "--s1", csf: "--s7", lesion: "--s8" };
  const FIELD = 1.5;
  const nullTI = (t1, tr) => t1 * Math.log(2 / (1 + Math.exp(-tr / t1)));
  const SEQS = {
    t1: { name: "T1-weighted", seq: { type: "se", tr: 500, te: 15, field: FIELD } },
    t2: { name: "T2-weighted", seq: { type: "se", tr: 4000, te: 100, field: FIELD } },
    flair: { name: "FLAIR", seq: { type: "ir", tr: 9000, te: 120, ti: nullTI(I.TISSUES.csf.t1[FIELD], 9000), field: FIELD } },
  };
  const FEATURES = { t1: ["t1"], t1t2: ["t1", "t2"], all: ["t1", "t2", "flair"] };
  const FILTERS = {
    none: { label: "None", note: "No filtering: every pixel keeps its own noise." },
    gauss: { label: "Gaussian", note: "Averages each pixel with its neighbours, weighted by distance: less noise, softer edges." },
    median: { label: "Median", note: "Takes the middle value of a window: removes outliers and keeps edges, but rounds off thin structures." },
  };
  const SIZES = { gauss: [0.6, 1, 1.5], median: [1, 2, 3] };

  // ---------- the phantom, its truth and its clean images (computed once) ----------
  const ph = I.phantom(N, 4);
  const hard = I.labelMap(ph);
  const truth = Int32Array.from(hard, (t) => CLASSES.indexOf(I.TISSUE_KEYS[t]) + 1); // 0 = background (air, skull)
  const clean = {}, peak = {};
  for (const [k, s] of Object.entries(SEQS)) { clean[k] = I.mrImage(ph, s.seq); peak[k] = I.maxOf(clean[k]); }
  // Expected (normalized) signal of each tissue in each contrast: the cluster names come from these.
  const signature = Object.fromEntries(Object.entries(SEQS).map(([k, s]) => {
    const sig = I.tissueSignals(s.seq);
    return [k, CLASSES.map((c) => sig[c] / peak[k])];
  }));

  const state = { filter: "median", features: "all", post: "none" };
  const noise = Viz.slider($("s-noise"), { label: "Noise", min: 0, max: 12, step: 0.5, value: 4, format: (v) => (v ? `${v}% of peak` : "none"), onInput: schedule });
  const size = Viz.slider($("s-sigma"), { label: "Filter size", min: 0, max: 2, step: 1, value: 0, format: sizeLabel, onInput: schedule });
  function sizeLabel(v) {
    if (state.filter === "gauss") return `σ = ${SIZES.gauss[v]} px`;
    if (state.filter === "median") { const w = 2 * SIZES.median[v] + 1; return `${w} × ${w}`; }
    return "—";
  }
  MH.seg($("filter"), Object.entries(FILTERS).map(([k, f]) => [k, f.label]), state.filter, (v) => { state.filter = v; size.set(size.value()); schedule(true); });
  MH.seg($("post"), [["none", "None"], ["majority", "Majority 3 × 3"]], state.post, (v) => { state.post = v; schedule(true); });
  MH.seg($("features"), [["t1", "T1"], ["t1t2", "T1 + T2"], ["all", "T1 + T2 + FLAIR"]], state.features, (v) => { state.features = v; schedule(true); });

  const views = {
    t1: Viz.imageView($("v-t1"), N, { title: "T1-weighted" }),
    t2: Viz.imageView($("v-t2"), N, { title: "T2-weighted" }),
    flair: Viz.imageView($("v-flair"), N, { title: "FLAIR" }),
    den: Viz.imageView($("v-den"), N, { title: "T1, denoised" }),
  };

  // ---------- the pipeline ----------
  function denoise(img, filter, s) {
    if (filter === "gauss") return I.gaussianBlur(img, N, SIZES.gauss[s]);
    if (filter === "median") return I.medianFilter(img, N, SIZES.median[s]);
    return img;
  }

  function pipeline(noisePct, filter, s, features, post = state.post) {
    const noisy = {}, den = {}, norm = {};
    Object.keys(SEQS).forEach((k, i) => {
      noisy[k] = noisePct ? I.addRician(clean[k], (noisePct / 100) * peak[k], 11 + i) : clean[k];
      den[k] = denoise(noisy[k], filter, s);
      norm[k] = den[k].map((v) => v / peak[k]);
    });
    // Mask: Otsu on the brightest of the three contrasts, so fluid (dark on T1) stays in.
    const brightest = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) brightest[i] = Math.max(norm.t1[i], norm.t2[i], norm.flair[i]);
    const cut = I.otsu(brightest);
    const inside = [];
    for (let i = 0; i < N * N; i++) if (brightest[i] > cut) inside.push(i);
    const feats = FEATURES[features];
    const points = inside.map((i) => feats.map((k) => norm[k][i]));
    // Each cluster starts at the signal its tissue should have, from the signal equations, and keeps its name.
    const init = CLASSES.map((_, t) => feats.map((k) => signature[k][t]));
    const { labels } = I.kmeans(points, CLASSES.length, { init });
    const name = Int32Array.from(CLASSES, (_, t) => t);
    let seg = new Int32Array(N * N);
    inside.forEach((i, j) => { seg[i] = name[labels[j]] + 1; });
    if (post === "majority") seg = I.majorityFilter(seg, N);
    const mask = Int32Array.from(brightest, (v) => (v > cut ? 1 : 0));
    const truthMask = Int32Array.from(truth, (t) => (t ? 1 : 0));
    const dice = CLASSES.map((_, t) => I.dice(seg, truth, t + 1));
    return { noisy, den, norm, mask, seg, dice, maskDice: I.dice(mask, truthMask, 1), points, labels: Int32Array.from(labels, (l) => name[l]), inside, feats };
  }

  // ---------- drawing ----------
  const rgb = (v) => d3.rgb(MH.css(v));
  function paint(canvas, f) {
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext("2d"), img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const [r, g, b] = f(i);
      img.data[4 * i] = r; img.data[4 * i + 1] = g; img.data[4 * i + 2] = b; img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function labelColors() {
    return CLASSES.map((c) => { const x = rgb(COLOR_VAR[c]); return [x.r, x.g, x.b]; });
  }

  function draw(r) {
    const cols = labelColors();
    for (const k of Object.keys(SEQS)) views[k].draw(r.noisy[k], { min: 0, max: peak[k] * 1.05, format: (v) => (v / peak[k]).toFixed(3) });
    views.den.draw(r.den.t1, { min: 0, max: peak.t1 * 1.05, format: (v) => (v / peak.t1).toFixed(3) });
    views.den.setTitle(state.filter === "none" ? "T1, not filtered" : `T1, ${FILTERS[state.filter].label.toLowerCase()} filter`);
    const lab = (m) => (i) => (m[i] ? cols[m[i] - 1] : [0, 0, 0]);
    paint($("c-truth"), lab(truth));
    paint($("c-seg"), lab(r.seg));
    const g = (i) => { const v = Math.round(255 * Math.min(1, r.norm.t1[i])); return [v, v, v]; };
    paint($("c-mask"), (i) => { const v = g(i)[0] * 0.45; return r.mask[i] ? [v + 60, v + 110, v + 140] : [v * 0.4, v * 0.4, v * 0.4]; });
    paint($("c-err"), (i) => {
      if (r.seg[i] === truth[i]) { const v = g(i)[0] * 0.35; return [v, v, v]; }
      return truth[i] && r.seg[i] ? [235, 70, 70] : [245, 180, 40];
    });
    $("seg-legend").innerHTML = CLASSES.map((c) => `<span class="key"><span class="sw" style="background:var(${COLOR_VAR[c]})"></span>${I.TISSUES[c].name}</span>`).join("")
      + `<span class="key"><span class="sw" style="background:rgb(235,70,70)"></span>Wrong tissue</span><span class="key"><span class="sw" style="background:rgb(245,180,40)"></span>Wrong mask</span>`;

    // tiles
    const mean = d3.mean(r.dice);
    const area = (m, t) => { let c = 0; for (let i = 0; i < N * N; i++) if (m[i] === t) c++; return c * PIXEL_CM2; };
    const L = CLASSES.indexOf("lesion") + 1;
    const lt = area(truth, L), lm = area(r.seg, L);
    const correct = r.seg.reduce((s, v, i) => s + (v === truth[i] ? 1 : 0), 0) / (N * N);
    const tiles = [
      ["Mean Dice, 5 tissues", mean.toFixed(3), mean > 0.85 ? "good" : mean > 0.7 ? "usable" : "poor"],
      ["Head mask Dice", r.maskDice.toFixed(3), "Otsu threshold"],
      ["Lesion area", `${lm.toFixed(2)} cm²`, `true ${lt.toFixed(2)} cm² (${lm >= lt ? "+" : "−"}${Math.abs(((lm - lt) / lt) * 100).toFixed(0)}%)`],
      ["Pixels right", `${(correct * 100).toFixed(1)}%`, `of ${(N * N).toLocaleString("en-US")}`],
    ];
    $("tiles").innerHTML = tiles.map(([a, b, d]) => `<div class="tile"><p class="label">${a}</p><div class="value">${b}</div><div class="delta"><span>${d}</span></div></div>`).join("");

    // measurement table
    $("measure").innerHTML = `<thead><tr><th>Tissue</th><th class="num">True area</th><th class="num">Measured</th><th class="num">Error</th><th>Dice</th></tr></thead><tbody>${CLASSES.map((c, t) => {
      const a = area(truth, t + 1), m = area(r.seg, t + 1), d = r.dice[t];
      return `<tr><td><span class="swatch" style="background:var(${COLOR_VAR[c]})"></span>${I.TISSUES[c].name}</td><td class="num">${a.toFixed(1)}</td><td class="num">${m.toFixed(1)}</td><td class="num">${m >= a ? "+" : "−"}${Math.abs(((m - a) / a) * 100).toFixed(0)}%</td><td><span class="dice-bar" style="width:${Math.max(2, d * 60)}px"></span>${d.toFixed(3)}</td></tr>`;
    }).join("")}</tbody>`;

    scatter(r);
    $("features-note").textContent = state.features === "t1"
      ? "One contrast: grey matter, lesions and fluid sit close together on T1, so k-means confuses them."
      : state.features === "t1t2" ? "T2 pulls fluid and lesions away from grey matter." : "FLAIR darkens fluid but keeps lesions bright, separating the two.";
    $("filter-note").textContent = FILTERS[state.filter].note;
    $("post-note").textContent = state.post === "majority"
      ? "Each pixel takes the most common label around it: stray pixels on edges disappear, small structures shrink."
      : lm > 1.3 * lt ? "The lesion is over-counted: pixels on the scalp edge, half fat and half skull, have a signal close to a lesion's. Try the majority filter." : "";
  }

  function scatter(r) {
    const el = $("scatter");
    const W = el.clientWidth || 420, H = Math.min(340, Math.max(240, W * 0.75));
    const m = { top: 10, right: 12, bottom: 34, left: 40 };
    const x = d3.scaleLinear().domain([0, 1.1]).range([m.left, W - m.right]);
    const y = d3.scaleLinear().domain([0, 1.1]).range([H - m.bottom, m.top]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Pixels by T1 and T2 intensity, colored by cluster");
    const ax = svg.append("g");
    x.ticks(5).forEach((v) => { ax.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", m.top).attr("y2", H - m.bottom).attr("stroke", "var(--line)"); ax.append("text").attr("x", x(v)).attr("y", H - m.bottom + 14).attr("text-anchor", "middle").text(v.toFixed(1)); });
    y.ticks(5).forEach((v) => { ax.append("line").attr("x1", m.left).attr("x2", W - m.right).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "var(--line)"); ax.append("text").attr("x", m.left - 6).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(v.toFixed(1)); });
    ax.append("text").attr("x", (m.left + W - m.right) / 2).attr("y", H - 4).attr("text-anchor", "middle").text("T1-weighted intensity");
    ax.append("text").attr("transform", `translate(11,${(m.top + H - m.bottom) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("T2-weighted intensity");
    const step = Math.max(1, Math.floor(r.inside.length / 2500));
    const dots = svg.append("g");
    for (let j = 0; j < r.inside.length; j += step) {
      const i = r.inside[j];
      dots.append("circle").attr("cx", x(r.norm.t1[i])).attr("cy", y(r.norm.t2[i])).attr("r", 1.6)
        .attr("fill", `var(${COLOR_VAR[CLASSES[r.labels[j]]]})`).attr("fill-opacity", 0.55);
    }
    const sig = svg.append("g");
    CLASSES.forEach((c, t) => {
      const cx = x(signature.t1[t]), cy = y(signature.t2[t]);
      sig.append("path").attr("d", `M${cx - 6},${cy - 6}L${cx + 6},${cy + 6}M${cx - 6},${cy + 6}L${cx + 6},${cy - 6}`).attr("stroke", "var(--ink)").attr("stroke-width", 2.2);
      sig.append("text").attr("x", cx + 8).attr("y", cy - 6).style("fill", "var(--ink)").style("font-weight", 600).text(I.TISSUES[c].name.split(" (")[0]);
    });
    el.replaceChildren(svg.node());
    $("scatter-title").textContent = `Feature space, T1 against T2${r.feats.length === 1 ? " (clusters from T1 only)" : ""}`;
  }

  // ---------- noise sweep ----------
  const SWEEP = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];
  let sweepToken = 0;
  function sweep() {
    const token = ++sweepToken, out = { none: [], gauss: [], median: [] }, jobs = [];
    for (const f of Object.keys(out)) for (const nz of SWEEP) jobs.push([f, nz]);
    const s = size.value();
    (function next() {
      if (token !== sweepToken) return;
      const [f, nz] = jobs.shift();
      out[f].push([nz, d3.mean(pipeline(nz, f, s, state.features).dice)]);
      if (jobs.length) return setTimeout(next, 0);
      const color = { none: "var(--muted)", gauss: "var(--s2)", median: "var(--s1)" };
      MH.lineChart($("sweep"), {
        series: Object.keys(out).map((f) => ({ id: f, name: FILTERS[f].label, short: FILTERS[f].label, color: color[f], values: out[f] })),
        xLinear: true, height: 260, endLabels: false, yDomain: [Math.min(0.5, d3.min(Object.values(out).flat(), (d) => d[1])), 1],
        xFormat: (v) => `${v}%`, yFormat: (v) => v.toFixed(2), tipFormat: (v) => v.toFixed(3), tipDate: (v) => `noise ${v}% of peak`,
        annotations: [{ date: noise.value(), label: "current" }], label: "Mean Dice against noise",
      });
      $("sweep-legend").innerHTML = Object.keys(out).map((f) => `<span class="key"><span class="ln" style="background:${color[f]}"></span>${FILTERS[f].label}${f === "none" ? "" : `, ${sizeLabelFor(f, s)}`}</span>`).join("");
    })();
  }
  const sizeLabelFor = (f, s) => (f === "gauss" ? `σ = ${SIZES.gauss[s]} px` : `${2 * SIZES.median[s] + 1} × ${2 * SIZES.median[s] + 1}`);

  let timer = null, last = null;
  function schedule(full) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const t0 = performance.now();
      last = pipeline(noise.value(), state.filter, size.value(), state.features);
      draw(last);
      $("status").textContent = `Segmented ${last.inside.length.toLocaleString("en-US")} pixels in ${Math.round(performance.now() - t0)} ms.`;
      sweep(full);
    }, 60);
  }
  MH.onTheme(() => last && draw(last));
  window.addEventListener("resize", () => last && scatter(last));
  schedule(true);
})();
