// Accelerated MRI: zero-filled against compressed-sensing reconstruction, computed in a worker.
(function () {
  MH.shell("cs");
  const $ = (id) => document.getElementById(id);
  const N = 256;
  const state = { pattern: "random" };

  MH.seg($("pattern"), [["random", "Random lines"], ["regular", "Regular lines"]], state.pattern, (v) => { state.pattern = v; run(); });
  const frac = Viz.slider($("s-frac"), { label: "Lines acquired", min: 15, max: 70, step: 1, value: 30, format: (v) => `${v}% (${(100 / v).toFixed(1)}× faster)` });
  const noise = Viz.slider($("s-noise"), { label: "Noise", min: 0, max: 3, step: 0.25, value: 0, format: (v) => (v ? `${v}% of peak` : "none") });
  // lambda on a log scale: slider value v -> 10^v
  const lam = Viz.slider($("s-lambda"), { label: "Sparsity weight λ", min: -3.5, max: -0.5, step: 0.05, value: -2.5, format: (v) => Math.pow(10, v).toPrecision(2) });
  const iters = Viz.slider($("s-iters"), { label: "Iterations", min: 10, max: 150, step: 10, value: 40, format: (v) => `${v}` });
  [frac.input, noise.input].forEach((i) => i.addEventListener("change", run));
  $("run").addEventListener("click", run);

  const vz = Viz.imageView($("v-zero"), N, { title: "Zero-filled", note: "Inverse FFT with the missing lines set to zero." });
  const vc = Viz.imageView($("v-cs"), N, { title: "Compressed sensing", note: "Sparsity in Haar wavelets, FISTA." });
  const vr = Viz.imageView($("v-ref"), N, { title: "Fully sampled", note: "The target: every line acquired." });

  let worker, job = 0, peak = 1, psnrs = [], zeroPsnr = 0;
  function run() {
    if (worker) worker.terminate();
    worker = new Worker("../assets/cs-worker.js");
    const id = ++job;
    psnrs = [];
    $("run").disabled = true;
    $("status").textContent = "Reconstructing…";
    const t0 = performance.now();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "start") {
        peak = Imaging.maxOf(m.ref);
        const show = { min: 0, max: peak * 1.02, format: (v) => (v / peak).toFixed(3), unit: "of peak" };
        vr.draw(m.ref, show);
        vz.draw(m.zero, show);
        zeroPsnr = m.psnrZero;
        $("mask").innerHTML = Array.from(m.lines, (l) => `<i style="background:${l ? "#e8eef7" : "transparent"}"></i>`).join("");
        $("mask-note").textContent = `${m.kept} of ${N} phase-encoding lines (rows of k-space), ${MH.pct(m.kept / N, 0)}.`;
        tiles(null);
      } else if (m.type === "iter") {
        psnrs.push([m.it, m.psnr]);
        if (m.image) vc.draw(m.image, { min: 0, max: peak * 1.02, format: (v) => (v / peak).toFixed(3), unit: "of peak" });
        if (m.it % 5 === 0) { chart(); tiles(m.psnr); }
        $("status").textContent = `Iteration ${m.it} of ${iters.value()}…`;
      } else if (m.type === "done") {
        chart();
        tiles(psnrs.at(-1)[1]);
        $("run").disabled = false;
        $("status").textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
      }
    };
    worker.postMessage({ id, n: N, frac: frac.value() / 100, pattern: state.pattern, lambda: Math.pow(10, lam.value()), iters: iters.value(), noise: noise.value() });
  }

  function tiles(cs) {
    const t = [
      ["Acceleration", `${(100 / frac.value()).toFixed(1)}×`, `${frac.value()}% of the lines`],
      ["Zero-filled", `${zeroPsnr.toFixed(1)} dB`, "PSNR against the full scan"],
      ["Compressed sensing", cs == null ? "…" : `${cs.toFixed(1)} dB`, cs == null ? "running" : `${cs - zeroPsnr >= 0 ? "+" : ""}${(cs - zeroPsnr).toFixed(1)} dB over zero filling`],
    ];
    $("tiles").innerHTML = t.map(([l, v, d]) => `<div class="tile"><p class="label">${l}</p><div class="value">${v}</div><div class="delta"><span>${d}</span></div></div>`).join("");
  }

  function chart() {
    if (!psnrs.length) return;
    const zero = [[0, zeroPsnr], [iters.value(), zeroPsnr]];
    MH.lineChart($("conv"), {
      series: [
        { id: "cs", name: "Compressed sensing", short: "CS", color: "var(--s1)", values: [[0, zeroPsnr]].concat(psnrs) },
        { id: "zf", name: "Zero-filled", short: "Zero-filled", color: "var(--muted)", values: zero, width: 1.25 },
      ],
      xLinear: true, height: 200, endLabels: false, xDomain: [0, iters.value()],
      xFormat: (v) => `${v}`, yFormat: (v) => `${v.toFixed(0)} dB`, tipFormat: (v) => `${v.toFixed(2)} dB`, tipDate: (v) => `iteration ${v.toFixed(0)}`, label: "PSNR by iteration",
    });
    $("conv-legend").innerHTML = `<span class="key"><span class="ln" style="background:var(--s1)"></span>Compressed sensing, PSNR by iteration</span><span class="key"><span class="ln" style="background:var(--muted)"></span>Zero-filled</span>`;
  }

  run();
})();
