// node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../assets/imaging.js");
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);

test("FFT matches a direct DFT and inverts exactly", () => {
  const n = 64, rand = I.rng(3);
  const re = Float64Array.from({ length: n }, () => rand() - 0.5), im = Float64Array.from({ length: n }, () => rand() - 0.5);
  const R = Float64Array.from(re), M = Float64Array.from(im);
  I.fft(R, M);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      sr += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      si += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
    close(R[k], sr, 1e-9, `re[${k}]`);
    close(M[k], si, 1e-9, `im[${k}]`);
  }
  I.fft(R, M, true);
  for (let t = 0; t < n; t++) { close(R[t], re[t], 1e-12); close(M[t], im[t], 1e-12); }
});

test("2D FFT conserves energy (Parseval) and the centred k-space round-trips", () => {
  const n = 32, rand = I.rng(5);
  const img = Float64Array.from({ length: n * n }, () => rand());
  const k = I.toKspace(img, n);
  let e1 = 0, e2 = 0;
  for (let i = 0; i < n * n; i++) { e1 += img[i] ** 2; e2 += k.re[i] ** 2 + k.im[i] ** 2; }
  close(e2 / (n * n), e1, 1e-8);
  // the DC term sits at the centre and equals the sum of the image
  close(k.re[(n / 2) * n + n / 2], img.reduce((s, v) => s + v, 0), 1e-9);
  const back = I.fromKspace(k, n);
  for (let i = 0; i < n * n; i++) close(back.re[i], img[i], 1e-10);
});

test("phantom fractions sum to one in every pixel", () => {
  const ph = I.phantom(64, 3);
  for (let i = 0; i < 64 * 64; i++) {
    const s = I.TISSUE_KEYS.reduce((a, k) => a + ph.fractions[k][i], 0);
    close(s, 1, 1e-5);
  }
  assert.ok(ph.fractions.wm.reduce((a, v) => a + v, 0) > 100);
});

test("signal equations behave at their limits", () => {
  close(I.spinEcho(1, 1000, 100, 1e9, 0), 1, 1e-12);            // full recovery, no decay
  close(I.spinEcho(1, 1000, 100, 1e9, 100), Math.exp(-1), 1e-12);
  close(I.spinEcho(1, 1000, 100, 1000, 0), 1 - Math.exp(-1), 1e-12);
  // inversion recovery nulls a tissue at TI = T1 ln 2 when TR >> T1
  close(I.inversionRecovery(1, 1000, 100, 1e9, 0, 1000 * Math.LN2), 0, 1e-12);
  // the Ernst angle maximizes the gradient-echo signal
  const tr = 20, t1 = 1000, ae = I.ernstAngle(tr, t1);
  const s = (a) => I.gradientEcho(1, t1, 50, tr, 0, a);
  assert.ok(s(ae) > s(ae - 1) && s(ae) > s(ae + 1));
  close(ae, (Math.acos(Math.exp(-tr / t1)) * 180) / Math.PI, 1e-12);
});

test("Bloch: relaxation follows the exponentials", () => {
  const r = I.bloch({ t1: 800, t2: 80, offsets: [0], events: [{ t: 0, flip: 90 }], duration: 400, dt: 1 });
  const i = r.t.indexOf(80);
  close(Math.hypot(r.mx[i], r.my[i]), Math.exp(-1), 1e-9, "Mxy(T2)");
  close(r.mz[r.t.indexOf(400)], 1 - Math.exp(-400 / 800), 1e-9, "Mz(400)");
  // a 90 degree pulse about x tips z into -y (right-hand rule)
  close(r.my[0], -1, 1e-12);
});

test("Bloch: a spin echo refocuses dephasing but not T2 decay", () => {
  const te = 60, t2 = 100;
  const r = I.bloch({ t1: 1000, t2, offsets: I.spread(201, 200), events: [{ t: 0, flip: 90 }, { t: te / 2, flip: 180, phase: 90 }], duration: 100, dt: 0.5 });
  const mag = (t) => { const i = r.t.indexOf(t); return Math.hypot(r.mx[i], r.my[i]); };
  assert.ok(mag(15) < 0.3, `dephased before the 180: ${mag(15)}`);
  close(mag(te), Math.exp(-te / t2), 0.01, "echo amplitude");
});

test("CT: Radon transform of a disk and filtered back-projection", () => {
  const n = 128, R = 0.5;
  const img = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const X = ((x + 0.5) / n) * 2 - 1, Y = 1 - ((y + 0.5) / n) * 2;
    if (X * X + Y * Y <= R * R) img[y * n + x] = 1;
  }
  const nA = 180, nD = 192, ang = Array.from({ length: nA }, (_, i) => (i * Math.PI) / nA);
  const s = I.radon(img, n, ang, nD);
  // the projection of a disk is 2 sqrt(R^2 - r^2), the same at every angle
  for (const d of [96, 120, 140]) {
    const r = ((d + 0.5) / nD) * 2 - 1;
    const expect = r * r < R * R ? 2 * Math.sqrt(R * R - r * r) : 0;
    close(s[d], expect, 0.03, `bin ${d}`);
    close(s[90 * nD + d], expect, 0.03, `bin ${d} at 90 degrees`);
  }
  const f = I.backproject(I.rampFilter(s, nA, nD), ang, nD, n);
  close(f[64 * n + 64], 1, 0.03, "inside");
  close(f[64 * n + 40], 1, 0.05, "inside, off centre");
  close(f[4 * n + 64], 0, 0.05, "outside");
});

test("Haar transform is orthonormal and invertible", () => {
  const n = 32, rand = I.rng(9);
  const a = Float64Array.from({ length: n * n }, () => rand());
  const b = Float64Array.from(a);
  I.haar2(b, n, 3);
  let e1 = 0, e2 = 0;
  for (let i = 0; i < n * n; i++) { e1 += a[i] ** 2; e2 += b[i] ** 2; }
  close(e2, e1, 1e-9);
  I.haar2(b, n, 3, true);
  for (let i = 0; i < n * n; i++) close(b[i], a[i], 1e-12);
});

test("compressed sensing beats zero filling on undersampled k-space", () => {
  const n = 64;
  const ph = I.phantom(n, 2);
  const img = I.mrImage(ph, { type: "se", tr: 2500, te: 90, field: 1.5 });
  const k = I.toKspace(img, n);
  const lines = I.randomLineMask(n, 0.35);
  const zr = new Float64Array(n * n), zi = new Float64Array(n * n);
  for (let r = 0; r < n; r++) if (lines[r]) for (let c = 0; c < n; c++) { zr[r * n + c] = k.re[r * n + c]; zi[r * n + c] = k.im[r * n + c]; }
  const zero = I.fromKspace({ re: zr, im: zi }, n).mag;
  const cs = I.csRecon(k, lines, n, { lambda: 0.003, iters: 80 });
  // at least 5 dB better than filling the missing lines with zeros
  assert.ok(I.psnr(cs, img) > I.psnr(zero, img) + 5, `cs ${I.psnr(cs, img)} dB vs zero-filled ${I.psnr(zero, img)} dB`);
});
