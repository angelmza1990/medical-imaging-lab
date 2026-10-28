// k-space explorer: sample, undersample or corrupt k-space and reconstruct with an inverse FFT.
(function () {
  const I = window.Imaging;
  MH.shell("kspace");
  const $ = (id) => document.getElementById(id);
  const N = 256, C = N / 2;

  const img = I.mrImage(I.phantom(N, 3), { type: "se", tr: 4000, te: 100, field: 1.5 });
  const ref = I.toKspace(img, N);
  const peak = Math.max(...img);

  const MODES = {
    full: { label: "All of k-space", note: "Every line acquired: the reference image." },
    lowpass: { label: "Only the centre", param: ["Radius kept", 2, 60, 1, 12, (v) => `${v}% of k max`], note: "Low frequencies only: correct contrast, no fine detail. Like a low-resolution scan." },
    highpass: { label: "Only the edges", param: ["Central radius removed", 1, 40, 1, 6, (v) => `${v}% of k max`], note: "High frequencies only: edges survive, the contrast between tissues is gone." },
    skip: { label: "Every other line", param: ["Acceleration (keep 1 line in R)", 2, 4, 1, 2, (v) => `R = ${v}`], note: "A wider line spacing shrinks the field of view by R, so the head folds over itself: aliasing. Parallel imaging (SENSE, GRAPPA) unfolds it with several receiver coils." },
    partial: { label: "Partial Fourier, zero-filled", param: ["Lines acquired", 52, 100, 1, 62, (v) => `${v}%`], note: "Lines on one side skipped and filled with zeros: some blurring and ringing along the phase direction." },
    conjugate: { label: "Partial Fourier, conjugate fill", param: ["Lines acquired", 52, 100, 1, 62, (v) => `${v}%`], note: "For a real-valued image k-space is symmetric, S(−k) = S(k)*, so the missing half can be computed from the acquired one. Real MR images carry a smooth phase, which is why scanners use phase-corrected (homodyne) versions of this trick." },
    random: { label: "Random lines", param: ["Lines acquired", 15, 90, 1, 35, (v) => `${v}%`], note: "Randomly skipped lines, denser at the centre: the artefact becomes noise-like instead of a coherent fold. That incoherence is what compressed sensing exploits." },
    spike: { label: "One corrupted point", param: ["Distance from the centre", 4, 120, 1, 40, (v) => `${v} samples`], note: "A single bad sample, for instance from an electrical spark, adds one stripe pattern to the whole image: the herringbone artefact." },
    motion: { label: "Motion during the scan", param: ["Lines acquired while moving", 0, 60, 1, 25, (v) => `${v}%`], note: "A shift while some lines are recorded adds a phase error to those lines only. The result is ghosts of the head repeated along the phase-encoding direction." },
  };
  const state = { mode: "partial", wave: null };

  // ---------- controls ----------
  const modes = $("modes");
  for (const [k, m] of Object.entries(MODES)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = m.label; b.dataset.mode = k;
    b.addEventListener("click", () => { state.mode = k; paramSlider(); draw(); });
    modes.append(b);
  }
  let param = null;
  function paramSlider() {
    modes.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    const p = MODES[state.mode].param;
    if (!p) { $("s-param").innerHTML = ""; param = null; return; }
    const [label, min, max, step, value, format] = p;
    param = Viz.slider($("s-param"), { label, min, max, step, value, format, onInput: draw });
  }
  const noise = Viz.slider($("s-noise"), { label: "Thermal noise in k-space", min: 0, max: 5, step: 0.25, value: 0, format: (v) => (v ? `${v}% of image peak` : "none"), onInput: draw });

  const vk = Viz.imageView($("v-k"), N, { title: "k-space (log magnitude)", note: "Click a point to see its wave." });
  const vi = Viz.imageView($("v-img"), N, { title: "Reconstruction" });
  const ve = Viz.imageView($("v-err"), N, { title: "Error against the full scan" });
  const vw = Viz.imageView($("v-wave"), N, { title: "One k-space point" });

  vk.canvas.addEventListener("click", (e) => {
    const r = vk.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N), y = Math.floor(((e.clientY - r.top) / r.height) * N);
    state.wave = [x - C, y - C];
    drawWave();
  });

  // ---------- sampling ----------
  function sample() {
    const mode = state.mode, p = param ? param.value() : 0;
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    let kept = 0;
    const lines = new Uint8Array(N);
    const take = (i) => { re[i] = ref.re[i]; im[i] = ref.im[i]; kept++; };
    const rmax = C; // k max in samples
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, r = Math.hypot(x - C, y - C) / rmax;
      let keep = true;
      if (mode === "lowpass") keep = r <= p / 100;
      else if (mode === "highpass") keep = r >= p / 100;
      else if (mode === "skip") keep = (y - C) % p === 0;
      else if (mode === "partial" || mode === "conjugate") keep = y < Math.round(N * p / 100);
      if (keep) { take(i); lines[y] = 1; }
    }
    if (mode === "random") {
      re.fill(0); im.fill(0); kept = 0; lines.fill(0);
      const l = I.randomLineMask(N, p / 100);
      for (let y = 0; y < N; y++) if (l[y]) { lines[y] = 1; for (let x = 0; x < N; x++) take(y * N + x); }
    }
    if (mode === "conjugate") {
      // S(-k) = conj(S(k)) for a real image; index of -k around the centre is (2C - y, 2C - x)
      for (let y = 0; y < N; y++) if (!lines[y]) for (let x = 0; x < N; x++) {
        const yy = 2 * C - y, xx = 2 * C - x;
        if (yy >= 0 && yy < N && xx >= 0 && xx < N && lines[yy]) { re[y * N + x] = ref.re[yy * N + xx]; im[y * N + x] = -ref.im[yy * N + xx]; }
      }
    }
    if (mode === "spike") {
      const i = C * N + C + p;
      re[i] += 400 * peak; // one strong bad sample
    }
    if (mode === "motion") {
      // a 4-pixel shift along x while a random share of lines is recorded: phase ramp e^(-i 2 pi kx dx / N)
      const rand = I.rng(5), dx = 4;
      for (let y = 0; y < N; y++) {
        if (rand() >= p / 100) continue;
        for (let x = 0; x < N; x++) {
          const i = y * N + x, ph = (-2 * Math.PI * (x - C) * dx) / N;
          const c = Math.cos(ph), s = Math.sin(ph), a = re[i], b = im[i];
          re[i] = a * c - b * s; im[i] = a * s + b * c;
        }
      }
    }
    const sigma = (noise.value() / 100) * peak * N; // k-space noise that gives this image-domain sigma
    if (sigma) {
      const rand = I.rng(9);
      for (let i = 0; i < N * N; i++) if (re[i] || im[i]) { re[i] += sigma * I.gaussian(rand); im[i] += sigma * I.gaussian(rand); }
    }
    // lines that had at least one sample acquired: what the scan had to spend time on
    return { re, im, kept, nLines: lines.reduce((s, v) => s + v, 0) };
  }

  function draw() {
    $("mode-note").textContent = MODES[state.mode].note;
    const k = sample();
    const kmag = Viz.magnitude(k.re, k.im);
    let kpk = 0;
    for (const v of kmag) kpk = Math.max(kpk, v);
    vk.draw(kmag, { log: true, max: Math.max(kpk, 1), format: (v) => v.toExponential(2) });
    const rec = I.fromKspace(k, N).mag;
    vi.draw(rec, { min: 0, max: peak * 1.02, format: (v) => (v / peak).toFixed(3), unit: "of peak" });
    const err = rec.map((v, i) => Math.abs(v - img[i]));
    ve.draw(err, { min: 0, max: peak * 0.5, format: (v) => (v / peak).toFixed(3), unit: "of peak" });
    ve.setNote("Brighter means a larger difference; the scale tops out at half the image peak.");
    const tiles = [
      ["Samples used", MH.pct(k.kept / (N * N), 0), `${k.kept.toLocaleString("en-US")} of ${(N * N).toLocaleString("en-US")}`],
      ["Scan time", MH.pct(k.nLines / N, 0), `${k.nLines} of ${N} phase-encoding lines`],
      ["PSNR", state.mode === "full" && !noise.value() ? "∞" : `${I.psnr(rec, img).toFixed(1)} dB`, "against the full scan"],
      ["Error", MH.pct(I.nrmse(rec, img), 1), "root-mean-square, of the image range"],
    ];
    $("tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><p class="label">${l}</p><div class="value">${v}</div><div class="delta"><span>${d}</span></div></div>`).join("");
    drawWave();
  }

  function drawWave() {
    const [kx, ky] = state.wave || [6, 3];
    const w = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) w[y * N + x] = Math.cos((2 * Math.PI * (kx * (x - C) + ky * (y - C))) / N);
    vw.draw(w, { min: -1, max: 1, format: (v) => v.toFixed(2) });
    const f = Math.hypot(kx, ky);
    vw.setNote(f ? `k = (${kx}, ${ky}): ${f.toFixed(1)} cycles across the field of view, one every ${(N / f).toFixed(1)} pixels.` : "k = (0, 0): the average brightness of the image.");
  }

  paramSlider();
  draw();
})();
