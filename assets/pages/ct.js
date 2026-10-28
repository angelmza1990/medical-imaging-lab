// CT reconstruction: sinogram of the head phantom, simple and filtered back-projection, views and dose.
(function () {
  const I = window.Imaging;
  MH.shell("ct");
  const $ = (id) => document.getElementById(id);
  const N = 256, ND = 256, MAX_VIEWS = 360;
  const VIEWS = [12, 18, 24, 36, 45, 60, 90, 120, 180, 360]; // divisors of 360, so each set is a subset
  // Physical scale for noise: water attenuates 0.2 per cm and one unit of the phantom is 12.5 cm,
  // so the line integrals in phantom units are multiplied by 2.5 to get -ln(I/I0).
  const SCALE = 2.5;
  const WINDOWS = { brain: [80, 40, "Brain: width 80, level 40 HU"], soft: [400, 40, "Soft tissue: width 400, level 40 HU"], bone: [2000, 500, "Bone: width 2000, level 500 HU"] };
  const FILTERS = {
    none: "Plain back-projection: every projection smeared back with no filter. The result is a 1/r blur of the true image.",
    ramlak: "Ram-Lak: the pure ramp |f|. Sharpest, and the noisiest.",
    shepp: "Shepp-Logan: the ramp times a sinc, slightly softer at high frequencies.",
    hann: "Hann: the ramp rolled off smoothly to zero. Least noise, least sharp.",
  };
  const state = { filter: "ramlak", window: "brain" };

  // ---------- phantom in attenuation units (water = 1) ----------
  const ph = I.phantom(N, 3);
  const mu = new Float64Array(N * N);
  for (const k of I.TISSUE_KEYS) { const f = ph.fractions[k]; for (let i = 0; i < N * N; i++) mu[i] += f[i] * (1 + I.HU[k] / 1000); }
  const refHU = mu.map((v) => (v - 1) * 1000);
  const soft = refHU.map((v) => v > -500 && v < 500); // pixels to score: tissue, not air or bone edges
  // interior white matter, for the noise measurement
  const wm = [];
  for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) {
    let ok = true;
    for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4 && ok; dx++) ok = ph.fractions.wm[(y + dy) * N + x + dx] === 1;
    if (ok) wm.push(y * N + x);
  }

  const views = Viz.slider($("s-views"), { label: "Projection angles over 180°", min: 0, max: VIEWS.length - 1, step: 1, value: VIEWS.length - 2, format: (v) => `${VIEWS[v]}`, onInput: draw });
  // log10 of photons per ray; the top of the scale switches noise off
  const NOISE_FREE = 8;
  const dose = Viz.slider($("s-dose"), { label: "Photons per ray (dose)", min: 4, max: NOISE_FREE, step: 0.25, value: 6.5, format: (v) => (v >= NOISE_FREE ? "no noise" : `${Math.round(Math.pow(10, v)).toLocaleString("en-US")}`), onInput: draw });
  MH.seg($("filter"), Object.keys(FILTERS).map((k) => [k, { none: "None", ramlak: "Ram-Lak", shepp: "Shepp-Logan", hann: "Hann" }[k]]), state.filter, (v) => { state.filter = v; draw(); });
  MH.seg($("window"), [["brain", "Brain"], ["soft", "Soft tissue"], ["bone", "Bone"]], state.window, (v) => { state.window = v; draw(); });

  const vs = Viz.imageView($("v-sino"), N, { title: "Sinogram", note: "Rows: projection angle, 0° at the top to 180° at the bottom. Columns: detector position." });
  const vr = Viz.imageView($("v-rec"), N, { title: "Reconstruction" });
  const vref = Viz.imageView($("v-ref"), N, { title: "True attenuation" });
  const ve = Viz.imageView($("v-err"), N, { title: "Error", note: "Absolute difference, black = 0, white = 100 HU or more." });

  let full = null;
  setTimeout(() => {
    const ang = Array.from({ length: MAX_VIEWS }, (_, i) => (i * Math.PI) / MAX_VIEWS);
    full = { ang, sino: I.radon(mu, N, ang, ND) };
    draw();
  }, 30);

  function draw() {
    if (!full) return;
    const nv = VIEWS[views.value()], stepV = MAX_VIEWS / nv;
    const ang = [], sino = new Float64Array(nv * ND);
    for (let a = 0; a < nv; a++) {
      ang.push(full.ang[a * stepV]);
      for (let d = 0; d < ND; d++) sino[a * ND + d] = full.sino[a * stepV * ND + d];
    }
    // Poisson noise on the detected photons (Gaussian approximation), then back to line integrals
    const lg = dose.value();
    if (lg < NOISE_FREE) {
      const I0 = Math.pow(10, lg), rand = I.rng(17);
      for (let i = 0; i < sino.length; i++) {
        const mean = I0 * Math.exp(-SCALE * sino[i]);
        const counts = Math.max(1, mean + Math.sqrt(mean) * I.gaussian(rand));
        sino[i] = -Math.log(counts / I0) / SCALE;
      }
    }
    // sinogram shown stretched to a square
    const sq = new Float64Array(N * N);
    for (let y = 0; y < N; y++) { const a = Math.min(nv - 1, Math.floor((y / N) * nv)); for (let x = 0; x < N; x++) sq[y * N + x] = sino[a * ND + Math.floor((x / N) * ND)]; }
    vs.draw(sq, { min: 0, format: (v) => v.toFixed(3), unit: "line integral" });

    let rec;
    if (state.filter === "none") {
      rec = I.backproject(sino, ang, ND, N);
      // unfiltered back-projection has no meaningful HU scale: stretch it to the display range
      let lo = Infinity, hi = -Infinity;
      for (const v of rec) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      rec = rec.map((v) => ((v - lo) / (hi - lo)) * 1000);
    } else {
      rec = I.backproject(I.rampFilter(sino, nv, ND, state.filter), ang, ND, N).map((v) => (v - 1) * 1000);
    }
    const [w, l, wn] = WINDOWS[state.window];
    const win = { min: l - w / 2, max: l + w / 2, format: (v) => `${v.toFixed(0)}`, unit: "HU" };
    // plain back-projection has no HU scale: show its own range, which is what makes the 1/r blur visible
    vr.draw(rec, state.filter === "none" ? { format: (v) => v.toFixed(0), unit: "(arbitrary units)" } : win);
    vr.setTitle(`Reconstruction, ${nv} views`);
    vref.draw(refHU, win);
    const err = state.filter === "none" ? new Float64Array(N * N) : rec.map((v, i) => Math.abs(v - refHU[i]));
    ve.draw(err, { min: 0, max: 100, format: (v) => `${v.toFixed(0)}`, unit: "HU" });
    ve.setNote(state.filter === "none" ? "Not defined: plain back-projection is not in Hounsfield units." : "Absolute difference, black = 0, white = 100 HU or more.");
    $("filter-note").textContent = FILTERS[state.filter];
    $("window-note").textContent = `${wn}. Values below the window show black, above it white.`;

    let se = 0, c = 0;
    for (let i = 0; i < N * N; i++) if (soft[i]) { se += (rec[i] - refHU[i]) ** 2; c++; }
    const m = wm.reduce((s, i) => s + rec[i], 0) / wm.length;
    const sd = Math.sqrt(wm.reduce((s, i) => s + (rec[i] - m) ** 2, 0) / wm.length);
    const tiles = [
      ["Views", `${nv}`, `over 180°, ${ND} detector bins`],
      ["Error in tissue", state.filter === "none" ? "–" : `${Math.sqrt(se / c).toFixed(0)} HU`, "root-mean-square, edges included"],
      ["White matter", state.filter === "none" ? "–" : `${m.toFixed(0)} ± ${sd.toFixed(0)} HU`, `mean ± noise; true value ${I.HU.wm} HU`],
      ["Dose", lg >= NOISE_FREE ? "Noise-free" : `${Math.round(Math.pow(10, lg)).toLocaleString("en-US")}`, "photons per ray before the head"],
    ];
    $("tiles").innerHTML = tiles.map(([a, b, d]) => `<div class="tile"><p class="label">${a}</p><div class="value">${b}</div><div class="delta"><span>${d}</span></div></div>`).join("");
    $("status").textContent = "Drag the sliders: the reconstruction runs in your browser.";
  }
})();
