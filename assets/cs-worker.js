// Runs the compressed-sensing reconstruction off the main thread.
// In:  { id, n, frac, pattern: "random"|"regular", lambda, iters, noise (% of peak) }
// Out: { id, type: "start", ref, zero, lines, psnrZero } then { id, type: "iter", it, psnr, image? } and { id, type: "done" }
importScripts("imaging.js");

const cache = {};
function reference(n) {
  if (!cache[n]) {
    const img = Imaging.mrImage(Imaging.phantom(n, 3), { type: "se", tr: 4000, te: 100, field: 1.5 });
    cache[n] = { img, k: Imaging.toKspace(img, n), peak: Imaging.maxOf(img) };
  }
  return cache[n];
}

/** Regular undersampling with a fully sampled centre, as parallel imaging uses. */
function regularMask(n, frac) {
  const keep = new Uint8Array(n);
  const centre = Math.round(n * 0.08);
  for (let i = n / 2 - centre / 2; i < n / 2 + centre / 2; i++) keep[Math.round(i)] = 1;
  const R = Math.max(1, Math.round((n - centre) / Math.max(1, frac * n - centre)));
  for (let i = 0; i < n; i += R) keep[i] = 1;
  return keep;
}

self.onmessage = (e) => {
  const { id, n, frac, pattern, lambda, iters, noise } = e.data;
  const { img, k, peak } = reference(n);
  // measured k-space: the reference plus complex Gaussian noise
  const kn = { re: Float64Array.from(k.re), im: Float64Array.from(k.im) };
  if (noise) {
    const rand = Imaging.rng(3), s = (noise / 100) * peak * n;
    for (let i = 0; i < n * n; i++) { kn.re[i] += s * Imaging.gaussian(rand); kn.im[i] += s * Imaging.gaussian(rand); }
  }
  const lines = pattern === "regular" ? regularMask(n, frac) : Imaging.randomLineMask(n, frac);
  const zr = new Float64Array(n * n), zi = new Float64Array(n * n);
  for (let r = 0; r < n; r++) if (lines[r]) for (let c = 0; c < n; c++) { zr[r * n + c] = kn.re[r * n + c]; zi[r * n + c] = kn.im[r * n + c]; }
  const zero = Imaging.fromKspace({ re: zr, im: zi }, n).mag;
  self.postMessage({ id, type: "start", ref: img, zero, lines, psnrZero: Imaging.psnr(zero, img), kept: lines.reduce((s, v) => s + v, 0) });
  Imaging.csRecon(kn, lines, n, {
    lambda, iters,
    onIter: (it, x) => {
      const mag = x.map(Math.abs);
      self.postMessage({ id, type: "iter", it, psnr: Imaging.psnr(mag, img), image: it % 5 === 0 || it === iters ? mag : null });
    },
  });
  self.postMessage({ id, type: "done" });
};
