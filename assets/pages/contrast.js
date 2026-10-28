// Tissue contrast: MR images of the head phantom for any spin-echo, inversion-recovery or gradient-echo timing.
(function () {
  const I = window.Imaging;
  MH.shell("contrast");
  const $ = (id) => document.getElementById(id);
  const N = 256;
  const SHOWN = ["fat", "wm", "gm", "csf", "lesion"];
  const COLOR = { fat: "var(--s1)", wm: "var(--s2)", gm: "var(--s3)", csf: "var(--s4)", lesion: "var(--s5)" };

  const ph = I.phantom(N, 3);
  const state = { type: "se", field: 1.5 };
  const view = Viz.imageView($("image"), N, { title: "Simulated image" });

  // TI that nulls a tissue for a given TR: 1 - 2e^(-TI/T1) + e^(-TR/T1) = 0
  const nullTI = (t1, tr) => Math.round(t1 * Math.log(2 / (1 + Math.exp(-tr / t1))));
  const PRESETS = [
    ["T1-weighted", () => ({ type: "se", tr: 500, te: 15 })],
    ["T2-weighted", () => ({ type: "se", tr: 4000, te: 100 })],
    ["Proton density", () => ({ type: "se", tr: 3500, te: 15 })],
    ["FLAIR", (B) => ({ type: "ir", tr: 9000, te: 120, ti: nullTI(I.TISSUES.csf.t1[B], 9000) })],
    ["STIR", (B) => ({ type: "ir", tr: 3500, te: 40, ti: nullTI(I.TISSUES.fat.t1[B], 3500) })],
    ["Gradient echo T1", () => ({ type: "gre", tr: 20, te: 4, flip: 25 })],
  ];

  const tr = Viz.slider($("s-tr"), { label: "Repetition time TR", min: 10, max: 10000, step: 10, value: 500, format: (v) => `${v} ms`, onInput: draw });
  const te = Viz.slider($("s-te"), { label: "Echo time TE", min: 2, max: 250, step: 1, value: 15, format: (v) => `${v} ms`, onInput: draw });
  const ti = Viz.slider($("s-ti"), { label: "Inversion time TI", min: 20, max: 4000, step: 10, value: 2400, format: (v) => `${v} ms`, onInput: draw });
  const flip = Viz.slider($("s-flip"), { label: "Flip angle", min: 1, max: 90, step: 1, value: 25, format: (v) => `${v}°`, onInput: draw });
  const noise = Viz.slider($("s-noise"), { label: "Noise", min: 0, max: 10, step: 0.5, value: 1, format: (v) => (v ? `${v}% of peak` : "none"), onInput: draw });

  const seqSeg = () => MH.seg($("seq"), [["se", "Spin echo"], ["ir", "Inversion recovery"], ["gre", "Gradient echo"]], state.type, (v) => { state.type = v; draw(); });
  seqSeg();
  MH.seg($("field"), [[1.5, "1.5 T"], [3, "3 T"]], state.field, (v) => { state.field = v; draw(); });
  const presets = $("presets");
  presets.className = "chips";
  for (const [label, f] of PRESETS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = label;
    b.addEventListener("click", () => {
      const p = f(state.field);
      state.type = p.type;
      tr.set(p.tr); te.set(p.te);
      if (p.ti) ti.set(p.ti);
      if (p.flip) flip.set(p.flip);
      seqSeg();
      draw();
    });
    presets.append(b);
  }

  const seq = () => ({ type: state.type, tr: tr.value(), te: te.value(), ti: ti.value(), flip: flip.value(), field: state.field });

  function weighting(s) {
    const sig = I.tissueSignals(s);
    if (s.type === "ir") {
      const nulled = SHOWN.filter((k) => sig[k] < 0.02 * Math.max(...SHOWN.map((x) => sig[x])));
      if (nulled.includes("csf")) return "Fluid suppressed (FLAIR-like)";
      if (nulled.includes("fat")) return "Fat suppressed (STIR-like)";
      return "Inversion recovery";
    }
    if (s.type === "gre") return "Gradient echo";
    // which tissue is brighter tells the weighting
    if (sig.csf > sig.wm * 1.2) return "T2-weighted";
    if (sig.wm > sig.gm * 1.05 && sig.fat > sig.csf) return "T1-weighted";
    return "Proton-density weighted";
  }

  function draw() {
    const s = seq();
    $("s-ti").style.display = s.type === "ir" ? "" : "none";
    $("s-flip").style.display = s.type === "gre" ? "" : "none";
    const img = I.mrImage(ph, s);
    let peak = 0;
    for (const v of img) peak = Math.max(peak, v);
    // complex Gaussian noise, then the magnitude: MR magnitude images have Rician noise
    const sigma = (noise.value() / 100) * peak, rand = I.rng(42), out = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = sigma ? Math.hypot(img[i] + sigma * I.gaussian(rand), sigma * I.gaussian(rand)) : img[i];
    view.draw(out, { min: 0, max: peak * 1.02, format: (v) => (v / peak).toFixed(3), unit: "of peak" });
    const w = weighting(s);
    view.setTitle(`${w}, ${s.field} T`);
    $("weighting").textContent = "Signal by tissue";

    const sig = I.tissueSignals(s);
    const mx = Math.max(...SHOWN.map((k) => sig[k]));
    $("signals").innerHTML = `<thead><tr><th>Tissue</th><th>T1</th><th>T2</th><th>Signal</th></tr></thead><tbody>` +
      SHOWN.map((k) => `<tr><td><span class="dot" style="background:${COLOR[k]}"></span>${I.TISSUES[k].name}</td><td>${I.TISSUES[k].t1[s.field]}</td><td>${I.TISSUES[k].t2[s.field]}</td>
        <td><b>${(sig[k] / mx).toFixed(2)}</b></td></tr>`).join("") + "</tbody>";
    const cnr = sigma ? Math.abs(sig.gm - sig.wm) / sigma : null;
    const ratio = sig.wm / sig.gm;
    $("contrast-note").innerHTML = `Signals relative to the brightest tissue. White to grey matter: <b>${ratio.toFixed(2)}</b>` +
      (cnr != null ? `; contrast-to-noise <b>${cnr.toFixed(1)}</b>` : "") +
      ` <span class="muted">(times in ms)</span>.`;
    curves(s);
  }

  function curves(s) {
    const D = (f, lo, hi, n = 160) => Array.from({ length: n + 1 }, (_, i) => { const x = lo + ((hi - lo) * i) / n; return [x, f(x)]; });
    const B = s.field;
    const sig = (k, o) => I.tissueSignals({ ...s, ...o })[k];
    const mk = (f) => SHOWN.map((k) => ({ id: k, name: I.TISSUES[k].name, short: I.TISSUES[k].name, color: COLOR[k], values: f(k) }));
    const opts = (cur, label) => ({ xLinear: true, height: 230, endLabels: false, baseline: 0, xFormat: (v) => `${v}`, yFormat: (v) => v.toFixed(2), tipFormat: (v) => v.toFixed(3), tipDate: (v) => `${label} ${v.toFixed(0)} ms`, annotations: [{ date: cur, label: "current" }] });
    const teMax = s.type === "gre" ? 40 : 250;
    MH.lineChart($("c1"), { ...opts(s.te, "TE"), series: mk((k) => D((x) => sig(k, { te: x }), 0, teMax)), label: "Signal against TE" });
    if (s.type === "ir") {
      $("c2-title").textContent = "Signal against inversion time";
      MH.lineChart($("c2"), { ...opts(s.ti, "TI"), series: mk((k) => D((x) => sig(k, { ti: x }), 0, 4000)), label: "Signal against TI" });
    } else if (s.type === "gre") {
      $("c2-title").textContent = "Signal against flip angle";
      MH.lineChart($("c2"), { ...opts(s.flip, "flip"), tipDate: (v) => `flip ${v.toFixed(0)}°`, series: mk((k) => D((x) => sig(k, { flip: x }), 1, 90)), label: "Signal against flip angle" });
    } else {
      $("c2-title").textContent = "Signal against repetition time";
      MH.lineChart($("c2"), { ...opts(s.tr, "TR"), series: mk((k) => D((x) => sig(k, { tr: x }), 10, 6000)), label: "Signal against TR" });
    }
    $("legend").innerHTML = SHOWN.map((k) => `<span class="key"><span class="ln" style="background:${COLOR[k]}"></span>${I.TISSUES[k].name}</span>`).join("");
  }

  draw();
})();
