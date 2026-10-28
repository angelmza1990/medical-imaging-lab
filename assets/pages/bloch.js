// Spin physics: Bloch simulation of an ensemble of isochromats with a 3D vector view.
(function () {
  const I = window.Imaging;
  MH.shell("bloch");
  const $ = (id) => document.getElementById(id);

  const SEQ = {
    fid: { label: "FID", note: "A single 90° pulse, then the free induction decay." },
    se: { label: "Spin echo", note: "90° pulse, then a 180° pulse at TE/2 that refocuses the spins into an echo at TE." },
    ir: { label: "Inversion recovery", note: "180° inversion, then a 90° pulse at TI. The signal is whatever Mz had recovered to." },
  };
  const PRESETS = [["wm", "White matter"], ["gm", "Grey matter"], ["csf", "Fluid (CSF)"], ["fat", "Fat"]];
  const state = { seq: "se" };

  const t1 = Viz.slider($("s-t1"), { label: "T1", min: 100, max: 4000, step: 10, value: 780, format: (v) => `${v} ms`, onInput: run });
  const t2 = Viz.slider($("s-t2"), { label: "T2", min: 10, max: 2000, step: 5, value: 75, format: (v) => `${v} ms`, onInput: run });
  const spreadS = Viz.slider($("s-spread"), { label: "Field spread across the voxel (half width)", min: 0, max: 60, step: 1, value: 3, format: (v) => `${v} Hz`, onInput: run });
  const te = Viz.slider($("s-te"), { label: "Echo time TE", min: 10, max: 300, step: 5, value: 80, format: (v) => `${v} ms`, onInput: run });
  const ti = Viz.slider($("s-ti"), { label: "Inversion time TI", min: 20, max: 4000, step: 10, value: 300, format: (v) => `${v} ms`, onInput: run });

  MH.seg($("seq"), Object.entries(SEQ).map(([k, v]) => [k, v.label]), state.seq, (v) => { state.seq = v; run(); });
  for (const [k, label] of PRESETS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = label;
    b.addEventListener("click", () => { t1.set(I.TISSUES[k].t1[1.5]); t2.set(I.TISSUES[k].t2[1.5]); run(); });
    $("presets").append(b);
  }

  let result = null, frame = 0, timer = null;
  const scrub = $("scrub");
  scrub.addEventListener("input", () => { stop(); frame = +scrub.value; drawVectors(); });
  $("play").addEventListener("click", () => (timer ? stop() : play()));
  function play() {
    if (frame >= result.frames.length - 1) frame = 0;
    $("play").textContent = "Pause";
    timer = setInterval(() => {
      frame++;
      if (frame >= result.frames.length - 1) { frame = result.frames.length - 1; stop(); }
      scrub.value = frame;
      drawVectors();
    }, 30);
  }
  function stop() { clearInterval(timer); timer = null; $("play").textContent = "Play"; }

  function run() {
    stop();
    const T1 = t1.value(), T2 = t2.value(), TE = te.value(), TI = ti.value();
    $("seq-note").textContent = SEQ[state.seq].note;
    $("s-te").style.display = state.seq === "se" ? "" : "none";
    $("s-ti").style.display = state.seq === "ir" ? "" : "none";
    let events, duration;
    if (state.seq === "fid") { events = [{ t: 0, flip: 90 }]; duration = Math.min(1500, Math.max(150, 4 * T2)); }
    else if (state.seq === "se") { events = [{ t: 0, flip: 90 }, { t: TE / 2, flip: 180, phase: 90 }]; duration = Math.round(TE * 1.8); }
    else { events = [{ t: 0, flip: 180 }, { t: TI, flip: 90 }]; duration = Math.round(TI + Math.min(800, Math.max(100, 3 * T2))); }
    const offsets = I.lorentzian(201, spreadS.value());
    result = I.bloch({ t1: T1, t2: T2, offsets, events, duration, dt: duration / 1600 });
    result.events = events;
    scrub.max = result.frames.length - 1;
    frame = state.seq === "se" ? result.frames.findIndex((f) => f[0] >= TE) : 0;
    if (frame < 0) frame = 0;
    scrub.value = frame;
    drawVectors();
    drawCurves(T2, TE, TI);
    drawTiles(T1, T2, TE, TI);
  }

  // ---------- 3D view ----------
  // oblique projection: x towards the viewer (down-left), y to the right, z up
  const P = (v, R, cx, cy) => [cx + R * (v[1] - 0.55 * v[0]), cy + R * (0.38 * v[0] - v[2])];
  function drawVectors() {
    const el = $("vectors");
    const W = el.clientWidth || 520, H = Math.round(W * 0.6), R = H * 0.36, cx = W * 0.5, cy = H * 0.55;
    const [t, spins] = result.frames[frame];
    const m = spins.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]).map((v) => v / spins.length);
    const line = (a, b, attrs) => { const p = P(a, R, cx, cy), q = P(b, R, cx, cy); return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" ${attrs}/>`; };
    let ring = "";
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; const p = P([Math.cos(a), Math.sin(a), 0], R, cx, cy); ring += `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`; }
    const shown = spins.filter((_, i) => i % 10 === 5); // 20 of the 201 spins, across the distribution
    const lab = (v, s) => { const p = P(v, R, cx, cy); return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle">${s}</text>`; };
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spin vectors at ${t.toFixed(0)} ms">
      <path d="${ring}" fill="var(--bg)" stroke="var(--line-2)"/>
      ${line([-1.1, 0, 0], [1.1, 0, 0], 'stroke="var(--line-2)"')}${line([0, -1.1, 0], [0, 1.1, 0], 'stroke="var(--line-2)"')}${line([0, 0, -1.1], [0, 0, 1.15], 'stroke="var(--line-2)"')}
      ${lab([1.3, 0, 0], "x")}${lab([0, 1.22, 0.02], "y")}${lab([0, 0.04, 1.25], "z (B₀)")}
      ${shown.map((s) => line([0, 0, 0], s, 'stroke="var(--s3)" stroke-width="1.2" opacity="0.8"')).join("")}
      ${line([0, 0, 0], m, 'stroke="var(--s1)" stroke-width="4" stroke-linecap="round"')}
      ${(() => { const p = P(m, R, cx, cy); return `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="var(--s1)"/>`; })()}
    </svg>`;
    $("time").textContent = `${t.toFixed(0)} ms`;
  }

  // ---------- curves ----------
  function drawCurves(T2, TE, TI) {
    const { t, mx, my, mz } = result;
    const step = Math.max(1, Math.floor(t.length / 600));
    const pick = (f) => t.filter((_, i) => i % step === 0).map((tt, j) => [tt, f(j * step)]);
    const series = [
      { id: "mxy", name: "Transverse |Mxy| (the signal)", short: "|Mxy|", color: "var(--s1)", values: pick((i) => Math.hypot(mx[i], my[i])) },
      { id: "mz", name: "Longitudinal Mz", short: "Mz", color: "var(--s2)", values: pick((i) => mz[i]) },
    ];
    const start = state.seq === "ir" ? TI : 0;
    series.push({ id: "t2", name: "Pure T2 decay, e^(−t/T2)", short: "T2 decay", color: "var(--muted)", width: 1.25,
      values: pick((i) => (t[i] >= start ? Math.exp(-(t[i] - start) / T2) * (state.seq === "ir" ? Math.abs(result.mz[result.t.findIndex((x) => x >= TI) - 1] ?? 1) : 1) : null)) });
    MH.lineChart($("curves"), {
      series, xLinear: true, height: 260, endLabels: false, baseline: 0, yDomain: [-1, 1],
      xFormat: (v) => `${v} ms`, yFormat: (v) => v.toFixed(1), tipFormat: (v) => v.toFixed(3), tipDate: (v) => `${v.toFixed(1)} ms`,
      annotations: result.events.map((e) => ({ date: e.t, label: `${e.flip}°` })).concat(state.seq === "se" ? [{ date: TE, label: "echo" }] : []),
      label: "Magnetization over time",
    });
    $("curves-legend").innerHTML = series.map((s) => `<span class="key"><span class="ln" style="background:${s.color}"></span>${s.name}</span>`).join("");
  }

  function drawTiles(T1, T2, TE, TI) {
    const { t, mx, my } = result;
    const tiles = [["Larmor frequency", "63.9 MHz", "at 1.5 T; 127.7 MHz at 3 T"], ["T2*", `${I.t2star(T2, spreadS.value()).toFixed(1)} ms`, `1/T2* = 1/T2 + 2π × ${spreadS.value()} Hz`]];
    if (state.seq === "se") {
      const i = t.findIndex((x) => x >= TE);
      tiles.push(["Echo amplitude", Math.hypot(mx[i], my[i]).toFixed(3), `e^(−TE/T2) = ${Math.exp(-TE / T2).toFixed(3)}`]);
      const j = t.findIndex((x) => x >= TE / 2) - 1;
      tiles.push(["Just before the 180°", Math.hypot(mx[j], my[j]).toFixed(3), "dephasing plus T2 decay"]);
    } else if (state.seq === "fid") {
      const i = t.findIndex((x) => x >= T2);
      tiles.push(["Signal at t = T2", Math.hypot(mx[i], my[i]).toFixed(3), `pure T2 would leave ${Math.exp(-1).toFixed(3)}`]);
    } else {
      const i = t.findIndex((x) => x >= TI);
      tiles.push(["Signal after the 90°", Math.hypot(mx[i], my[i]).toFixed(3), "|Mz| just before the pulse"]);
      tiles.push(["Null point", `${Math.round(T1 * Math.LN2)} ms`, "TI = T1 ln 2"]);
    }
    $("tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><p class="label">${l}</p><div class="value">${v}</div><div class="delta"><span>${d}</span></div></div>`).join("");
  }

  new ResizeObserver(() => result && drawVectors()).observe($("vectors"));
  run();
})();
