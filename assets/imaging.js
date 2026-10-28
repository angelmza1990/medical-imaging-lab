// Medical Imaging Lab — numerical core: FFT, phantom, MRI signal equations, Bloch dynamics,
// CT projection and reconstruction, wavelets and compressed sensing.
// Works in the page, in a Web Worker (importScripts) and in Node (require).
(function (root) {
  "use strict";

  // ======================= Fourier transform =======================
  /** In-place radix-2 complex FFT of length n (a power of two). inverse=true divides by n. */
  function fft(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { // bit-reversal permutation
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI) / len * (inverse ? 1 : -1);
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  /** 2D FFT of an n x n complex image stored row-major, in place. */
  function fft2(re, im, n, inverse = false) {
    const r = new Float64Array(n), c = new Float64Array(n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) { r[x] = re[y * n + x]; c[x] = im[y * n + x]; }
      fft(r, c, inverse);
      for (let x = 0; x < n; x++) { re[y * n + x] = r[x]; im[y * n + x] = c[x]; }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; c[y] = im[y * n + x]; }
      fft(r, c, inverse);
      for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = c[y]; }
    }
  }

  /** Swap quadrants so the zero frequency sits in the centre (its own inverse for even n). */
  function fftshift(a, n) {
    const out = new a.constructor(a.length), h = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[((y + h) % n) * n + ((x + h) % n)] = a[y * n + x];
    return out;
  }

  /** Centred k-space of a real image: returns { re, im } with k = 0 at (n/2, n/2). */
  function toKspace(img, n) {
    const re = Float64Array.from(img), im = new Float64Array(n * n);
    fft2(re, im, n);
    return { re: fftshift(re, n), im: fftshift(im, n) };
  }
  /** Image from centred k-space: returns { re, im, mag }. */
  function fromKspace(k, n) {
    const re = fftshift(k.re, n), im = fftshift(k.im, n);
    fft2(re, im, n, true);
    const mag = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) mag[i] = Math.hypot(re[i], im[i]);
    return { re, im, mag };
  }

  // ======================= random numbers =======================
  function rng(seed = 1) {
    let s = seed >>> 0 || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ======================= tissues and phantom =======================
  // Approximate relaxation times (ms) and relative proton density for brain tissues, from
  // published measurements (Stanisz et al. 2005; Wansapura et al. 1999; Lu et al. 2005).
  // Real values vary between studies, subjects and methods by 10-20%.
  const TISSUES = {
    air: { name: "Air", pd: 0, t1: { 1.5: 1, 3: 1 }, t2: { 1.5: 1, 3: 1 } },
    fat: { name: "Fat (scalp)", pd: 0.9, t1: { 1.5: 290, 3: 370 }, t2: { 1.5: 165, 3: 130 } },
    bone: { name: "Bone (skull)", pd: 0.05, t1: { 1.5: 250, 3: 300 }, t2: { 1.5: 1, 3: 1 } },
    gm: { name: "Grey matter", pd: 0.8, t1: { 1.5: 1100, 3: 1600 }, t2: { 1.5: 95, 3: 85 } },
    wm: { name: "White matter", pd: 0.7, t1: { 1.5: 780, 3: 1000 }, t2: { 1.5: 75, 3: 70 } },
    csf: { name: "Cerebrospinal fluid", pd: 1.0, t1: { 1.5: 4000, 3: 4300 }, t2: { 1.5: 2000, 3: 1800 } },
    lesion: { name: "Lesion (oedema)", pd: 0.9, t1: { 1.5: 1400, 3: 1800 }, t2: { 1.5: 180, 3: 160 } },
  };
  // CT attenuation, as linear attenuation relative to water (water = 1). 1 + HU/1000.
  const HU = { air: -1000, fat: -100, bone: 1000, gm: 40, wm: 25, csf: 5, lesion: 20 };

  // An axial "head" built from ellipses, drawn in order (later shapes overwrite earlier ones).
  // [tissue, cx, cy, a, b, angle in degrees], coordinates in [-1, 1].
  const HEAD = [
    ["fat", 0, 0, 0.72, 0.92, 0],
    ["bone", 0, 0, 0.68, 0.88, 0],
    ["gm", 0, -0.0184, 0.6624, 0.874, 0],
    ["wm", 0, -0.02, 0.5, 0.69, 0], // leaves a cortical ribbon of grey matter
    ["gm", 0.33, 0.1, 0.1, 0.22, -18], ["gm", -0.33, 0.1, 0.1, 0.22, 18], // deep grey matter
    ["csf", 0.12, 0, 0.06, 0.28, -18], ["csf", -0.12, 0, 0.08, 0.32, 18], // ventricles
    ["csf", 0, 0.35, 0.05, 0.05, 0],
    ["lesion", 0.32, -0.42, 0.09, 0.07, 30],
    ["lesion", -0.08, -0.605, 0.03, 0.02, 0],
    ["csf", 0, -0.1, 0.03, 0.03, 0],
  ];
  const TISSUE_KEYS = Object.keys(TISSUES);

  /**
   * Rasterize the phantom at n x n with s x s supersampling per pixel.
   * Returns { n, fractions: { tissue: Float32Array } } where each pixel's fractions sum to 1.
   */
  function phantom(n, s = 4, shapes = HEAD) {
    const fractions = Object.fromEntries(TISSUE_KEYS.map((k) => [k, new Float32Array(n * n)]));
    const pre = shapes.map(([t, cx, cy, a, b, deg]) => ({ t, cx, cy, a2: a * a, b2: b * b, c: Math.cos((deg * Math.PI) / 180), s: Math.sin((deg * Math.PI) / 180) }));
    const w = 1 / (s * s);
    for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
      for (let sy = 0; sy < s; sy++) for (let sx = 0; sx < s; sx++) {
        const x = ((px + (sx + 0.5) / s) / n) * 2 - 1;
        const y = 1 - ((py + (sy + 0.5) / s) / n) * 2;
        let tissue = "air";
        for (const e of pre) {
          const dx = x - e.cx, dy = y - e.cy;
          const u = dx * e.c + dy * e.s, v = -dx * e.s + dy * e.c;
          if ((u * u) / e.a2 + (v * v) / e.b2 <= 1) tissue = e.t;
        }
        fractions[tissue][py * n + px] += w;
      }
    }
    return { n, fractions };
  }

  // ======================= MRI signal equations =======================
  /** Spin echo (or any 90-degree excitation with full refocusing): PD (1 - e^-TR/T1) e^-TE/T2. */
  const spinEcho = (pd, t1, t2, tr, te) => pd * (1 - Math.exp(-tr / t1)) * Math.exp(-te / t2);

  /**
   * Inversion recovery spin echo, magnitude: PD |1 - 2 e^-TI/T1 + e^-TR/T1| e^-TE/T2.
   * Nulls a tissue when TI = T1 ln 2 (for TR >> T1).
   */
  const inversionRecovery = (pd, t1, t2, tr, te, ti) => pd * Math.abs(1 - 2 * Math.exp(-ti / t1) + Math.exp(-tr / t1)) * Math.exp(-te / t2);

  /** Spoiled gradient echo: PD sin(a) (1 - E1) / (1 - cos(a) E1) e^-TE/T2*, a in degrees. */
  function gradientEcho(pd, t1, t2s, tr, te, flipDeg) {
    const a = (flipDeg * Math.PI) / 180, e1 = Math.exp(-tr / t1);
    return pd * Math.sin(a) * (1 - e1) / (1 - Math.cos(a) * e1) * Math.exp(-te / t2s);
  }
  /** Ernst angle: the flip angle that maximizes spoiled gradient-echo signal, in degrees. */
  const ernstAngle = (tr, t1) => (Math.acos(Math.exp(-tr / t1)) * 180) / Math.PI;

  /** Image of the phantom for a sequence. seq: { type: "se"|"ir"|"gre", tr, te, ti, flip, field }. */
  function mrImage(ph, seq) {
    const n = ph.n, img = new Float64Array(n * n);
    const B = seq.field || 1.5;
    for (const k of TISSUE_KEYS) {
      const t = TISSUES[k], f = ph.fractions[k];
      if (!t.pd) continue;
      const t1 = t.t1[B], t2 = t.t2[B];
      const s = seq.type === "ir" ? inversionRecovery(t.pd, t1, t2, seq.tr, seq.te, seq.ti)
        : seq.type === "gre" ? gradientEcho(t.pd, t1, t2 * 0.7, seq.tr, seq.te, seq.flip)
        : spinEcho(t.pd, t1, t2, seq.tr, seq.te);
      for (let i = 0; i < n * n; i++) if (f[i]) img[i] += f[i] * s;
    }
    return img;
  }
  /** Signal of every tissue for a sequence (for contrast tables and curves). */
  function tissueSignals(seq) {
    const B = seq.field || 1.5;
    return Object.fromEntries(TISSUE_KEYS.filter((k) => TISSUES[k].pd).map((k) => {
      const t = TISSUES[k];
      const s = seq.type === "ir" ? inversionRecovery(t.pd, t.t1[B], t.t2[B], seq.tr, seq.te, seq.ti)
        : seq.type === "gre" ? gradientEcho(t.pd, t.t1[B], t.t2[B] * 0.7, seq.tr, seq.te, seq.flip)
        : spinEcho(t.pd, t.t1[B], t.t2[B], seq.tr, seq.te);
      return [k, s];
    }));
  }

  // ======================= Bloch equations =======================
  /** Rotate vector m = [x, y, z] about axis (unit [ux, uy, uz]) by angle radians (right-hand rule). */
  function rotate(m, ux, uy, uz, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), d = (ux * m[0] + uy * m[1] + uz * m[2]) * (1 - c);
    return [
      m[0] * c + (uy * m[2] - uz * m[1]) * s + ux * d,
      m[1] * c + (uz * m[0] - ux * m[2]) * s + uy * d,
      m[2] * c + (ux * m[1] - uy * m[0]) * s + uz * d,
    ];
  }

  /**
   * Simulate an ensemble of isochromats in the rotating frame.
   * opts: { t1, t2, offsets: [Hz...], events: [{ t, flip (deg), phase (deg) }], duration, dt (ms) }
   * Hard pulses are instantaneous rotations about an axis in the transverse plane.
   * Between events each isochromat precesses at its offset and relaxes exactly.
   * Returns { t: [...], mx, my, mz (ensemble means), spins: [[t, [[x,y,z]...]]] sampled for animation }.
   */
  function bloch(opts) {
    const { t1, t2, offsets, events, duration, dt = 0.5 } = opts;
    let spins = offsets.map(() => [0, 0, 1]);
    const ev = events.slice().sort((a, b) => a.t - b.t);
    const t = [], mx = [], my = [], mz = [], frames = [];
    let k = 0;
    const steps = Math.round(duration / dt);
    const e1 = Math.exp(-dt / t1), e2 = Math.exp(-dt / t2);
    const record = (time) => {
      let x = 0, y = 0, z = 0;
      for (const s of spins) { x += s[0]; y += s[1]; z += s[2]; }
      t.push(time); mx.push(x / spins.length); my.push(y / spins.length); mz.push(z / spins.length);
    };
    for (let i = 0; i <= steps; i++) {
      const time = i * dt;
      while (k < ev.length && ev[k].t <= time + 1e-9) {
        const p = ((ev[k].phase || 0) * Math.PI) / 180, a = (ev[k].flip * Math.PI) / 180;
        spins = spins.map((s) => rotate(s, Math.cos(p), Math.sin(p), 0, a));
        k++;
      }
      record(time);
      if (i % Math.max(1, Math.round(steps / 400)) === 0) frames.push([time, spins.map((s) => s.slice())]);
      // free precession (clockwise for positive offset, as for spins above resonance) and relaxation
      spins = spins.map((s, j) => {
        const r = rotate(s, 0, 0, 1, -2 * Math.PI * offsets[j] * (dt / 1000));
        return [r[0] * e2, r[1] * e2, 1 - (1 - r[2]) * e1];
      });
    }
    return { t, mx, my, mz, frames };
  }

  /** Off-resonance offsets (Hz) spread evenly over +/- width/2: a simple model of field inhomogeneity (T2*). */
  const spread = (n, width) => Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (i / (n - 1) - 0.5) * width));

  /**
   * Off-resonance offsets (Hz) drawn as evenly spaced quantiles of a Lorentzian with half-width hwhm.
   * A Lorentzian spread makes the free induction decay exponential, as in tissue:
   * the FID decays as e^(-t/T2*) with 1/T2* = 1/T2 + 2 pi hwhm.
   */
  const lorentzian = (n, hwhm) => Array.from({ length: n }, (_, i) => hwhm * Math.tan(Math.PI * ((i + 0.5) / n - 0.5)));
  const t2star = (t2, hwhm) => 1 / (1 / t2 + (2 * Math.PI * hwhm) / 1000);

  // ======================= CT: projection and reconstruction =======================
  /**
   * Parallel-beam Radon transform of an n x n image (pixel size 2/n in [-1, 1]).
   * angles in radians; nDet detector bins over [-1, 1]. Returns Float64Array(angles.length * nDet).
   * Line integrals are computed by sampling along each ray at half-pixel steps with bilinear interpolation.
   */
  function radon(img, n, angles, nDet) {
    const sino = new Float64Array(angles.length * nDet);
    const step = 1 / n; // half a pixel in [-1, 1] units
    const L = Math.SQRT2;
    const at = (x, y) => {
      const fx = ((x + 1) / 2) * n - 0.5, fy = ((1 - y) / 2) * n - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const g = (i, j) => (i < 0 || j < 0 || i >= n || j >= n ? 0 : img[j * n + i]);
      return (1 - ax) * (1 - ay) * g(x0, y0) + ax * (1 - ay) * g(x0 + 1, y0) + (1 - ax) * ay * g(x0, y0 + 1) + ax * ay * g(x0 + 1, y0 + 1);
    };
    angles.forEach((th, a) => {
      const c = Math.cos(th), s = Math.sin(th);
      for (let d = 0; d < nDet; d++) {
        const r = ((d + 0.5) / nDet) * 2 - 1;
        let sum = 0;
        for (let u = -L; u <= L; u += step) sum += at(r * c - u * s, r * s + u * c);
        sino[a * nDet + d] = sum * step;
      }
    });
    return sino;
  }

  /** Ramp-filter every projection in the frequency domain. window: "ramlak" | "shepp" | "hann". */
  function rampFilter(sino, nAng, nDet, window = "ramlak") {
    let m = 1;
    while (m < 2 * nDet) m <<= 1; // zero-pad to avoid wrap-around
    const out = new Float64Array(sino.length);
    const H = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const f = (k <= m / 2 ? k : m - k) / m; // cycles per sample, 0..0.5
      let w = 1;
      if (window === "shepp") w = f === 0 ? 1 : Math.sin(Math.PI * f) / (Math.PI * f);
      else if (window === "hann") w = 0.5 * (1 + Math.cos(2 * Math.PI * f));
      H[k] = f * w; // |nu| in cycles per sample; the 1/bin-width factor is applied in backproject
    }
    const re = new Float64Array(m), im = new Float64Array(m);
    for (let a = 0; a < nAng; a++) {
      re.fill(0); im.fill(0);
      for (let d = 0; d < nDet; d++) re[d] = sino[a * nDet + d];
      fft(re, im);
      for (let k = 0; k < m; k++) { re[k] *= H[k]; im[k] *= H[k]; }
      fft(re, im, true);
      for (let d = 0; d < nDet; d++) out[a * nDet + d] = re[d];
    }
    return out;
  }

  /**
   * Back-project projections over an n x n grid. With filtered projections and angles over [0, pi)
   * this is filtered back-projection; the scale makes a uniform disk come back at its true value.
   */
  function backproject(sino, angles, nDet, n) {
    const img = new Float64Array(n * n);
    const cs = angles.map(Math.cos), sn = angles.map(Math.sin);
    for (let py = 0; py < n; py++) {
      const y = 1 - ((py + 0.5) / n) * 2;
      for (let px = 0; px < n; px++) {
        const x = ((px + 0.5) / n) * 2 - 1;
        let sum = 0;
        for (let a = 0; a < angles.length; a++) {
          const r = x * cs[a] + y * sn[a];
          const fd = ((r + 1) / 2) * nDet - 0.5;
          const d0 = Math.floor(fd), w = fd - d0;
          if (d0 >= 0 && d0 + 1 < nDet) sum += (1 - w) * sino[a * nDet + d0] + w * sino[a * nDet + d0 + 1];
        }
        img[py * n + px] = sum;
      }
    }
    // detector bin width is 2/nDet; FBP sums over pi with d(theta) = pi / nAng
    const scale = Math.PI / angles.length / (2 / nDet);
    for (let i = 0; i < img.length; i++) img[i] *= scale;
    return img;
  }

  // ======================= wavelets and compressed sensing =======================
  /** In-place orthonormal 2D Haar transform with `levels` levels (n a power of two). */
  function haar2(a, n, levels, inverse = false) {
    const tmp = new Float64Array(n);
    const S = Math.SQRT1_2;
    const pass = (size, inv) => {
      for (let y = 0; y < size; y++) { // rows
        if (!inv) { for (let i = 0; i < size / 2; i++) { const p = a[y * n + 2 * i], q = a[y * n + 2 * i + 1]; tmp[i] = (p + q) * S; tmp[size / 2 + i] = (p - q) * S; } }
        else { for (let i = 0; i < size / 2; i++) { const p = a[y * n + i], q = a[y * n + size / 2 + i]; tmp[2 * i] = (p + q) * S; tmp[2 * i + 1] = (p - q) * S; } }
        for (let i = 0; i < size; i++) a[y * n + i] = tmp[i];
      }
      for (let x = 0; x < size; x++) { // columns
        if (!inv) { for (let i = 0; i < size / 2; i++) { const p = a[2 * i * n + x], q = a[(2 * i + 1) * n + x]; tmp[i] = (p + q) * S; tmp[size / 2 + i] = (p - q) * S; } }
        else { for (let i = 0; i < size / 2; i++) { const p = a[i * n + x], q = a[(size / 2 + i) * n + x]; tmp[2 * i] = (p + q) * S; tmp[2 * i + 1] = (p - q) * S; } }
        for (let i = 0; i < size; i++) a[i * n + x] = tmp[i];
      }
    };
    if (!inverse) for (let l = 0, size = n; l < levels; l++, size >>= 1) pass(size, false);
    else for (let l = levels - 1; l >= 0; l--) pass(n >> l, true);
  }

  /** Variable-density random Cartesian mask: keep a fraction of phase-encode lines, denser near the centre. */
  function randomLineMask(n, fraction, centre = 0.08, seed = 7) {
    const rand = rng(seed);
    const keep = new Uint8Array(n);
    const c = Math.max(2, Math.round(n * centre));
    for (let i = n / 2 - c / 2; i < n / 2 + c / 2; i++) keep[Math.round(i)] = 1;
    let have = keep.reduce((s, v) => s + v, 0);
    const target = Math.round(n * fraction);
    // probability falls with distance from the centre
    const p = Array.from({ length: n }, (_, i) => Math.pow(1 - Math.abs(i - n / 2) / (n / 2), 2) + 0.05);
    let guard = 0;
    while (have < target && guard++ < 100000) {
      const i = Math.floor(rand() * n);
      if (!keep[i] && rand() < p[i]) { keep[i] = 1; have++; }
    }
    return keep; // per line (row = phase encode), 1 = acquired
  }

  /** Circularly shift an n x n image by (dx, dy). */
  function shift2(a, n, dx, dy) {
    const out = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[((y + dy + n) % n) * n + ((x + dx + n) % n)] = a[y * n + x];
    return out;
  }

  /**
   * Compressed-sensing reconstruction: minimize ||M F x - y||^2 + lambda ||W x||_1, where F is the
   * unitary 2D Fourier transform (centred k-space), M keeps the acquired phase-encode lines and W is a
   * Haar wavelet transform. Solved with FISTA (accelerated iterative soft-thresholding). Each iteration
   * shifts the image by a random offset before thresholding ("cycle spinning"), which averages out the
   * blocky artefacts of a plain Haar basis. lambda is relative to the largest detail coefficient of
   * the zero-filled image. Works on the real part (the phantom is real).
   */
  function csRecon(k, lines, n, { lambda = 0.003, iters = 80, levels = 4, seed = 11, onIter } = {}) {
    const rand = rng(seed);
    const yr = new Float64Array(n * n), yi = new Float64Array(n * n);
    for (let r = 0; r < n; r++) if (lines[r]) for (let c = 0; c < n; c++) { yr[r * n + c] = k.re[r * n + c]; yi[r * n + c] = k.im[r * n + c]; }
    const zeroFilled = fromKspace({ re: yr, im: yi }, n).re;
    const a = n >> levels;
    const detailMax = (img) => {
      const w = Float64Array.from(img);
      haar2(w, n, levels);
      let mx = 0;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (r >= a || c >= a) mx = Math.max(mx, Math.abs(w[r * n + c]));
      return mx;
    };
    const thr = lambda * detailMax(zeroFilled);
    let x = zeroFilled, z = Float64Array.from(x), tk = 1;
    for (let it = 0; it < iters; it++) {
      // gradient step on the data term: v = z - F^H M (M F z - y); with a unitary F the step size 1 is safe
      const kz = toKspace(z, n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (lines[r]) { kz.re[i] -= yr[i]; kz.im[i] -= yi[i]; } else { kz.re[i] = 0; kz.im[i] = 0; }
      }
      const g = fromKspace(kz, n).re;
      let v = new Float64Array(n * n);
      for (let i = 0; i < n * n; i++) v[i] = z[i] - g[i];
      // proximal step: soft-threshold the detail coefficients of a randomly shifted copy
      const dx = Math.floor(rand() * 8), dy = Math.floor(rand() * 8);
      v = shift2(v, n, dx, dy);
      haar2(v, n, levels);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (r < a && c < a) continue;
        const i = r * n + c, w = v[i];
        v[i] = Math.sign(w) * Math.max(0, Math.abs(w) - thr);
      }
      haar2(v, n, levels, true);
      const xNew = shift2(v, n, -dx, -dy);
      // FISTA momentum
      const tNew = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
      for (let i = 0; i < n * n; i++) z[i] = xNew[i] + ((tk - 1) / tNew) * (xNew[i] - x[i]);
      x = xNew; tk = tNew;
      if (onIter) onIter(it + 1, x);
    }
    return x;
  }

  // ======================= image quality =======================
  /** Root-mean-square error between two images, relative to the reference's range. */
  function nrmse(a, ref) {
    let s = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ref.length; i++) { s += (a[i] - ref[i]) ** 2; lo = Math.min(lo, ref[i]); hi = Math.max(hi, ref[i]); }
    return Math.sqrt(s / ref.length) / (hi - lo || 1);
  }
  /** Peak signal-to-noise ratio in dB, using the reference's maximum as the peak. */
  function psnr(a, ref) {
    let s = 0, hi = 0;
    for (let i = 0; i < ref.length; i++) { s += (a[i] - ref[i]) ** 2; hi = Math.max(hi, ref[i]); }
    return 10 * Math.log10((hi * hi) / (s / ref.length));
  }

  const api = {
    fft, fft2, fftshift, toKspace, fromKspace, rng, gaussian,
    TISSUES, TISSUE_KEYS, HU, HEAD, phantom,
    spinEcho, inversionRecovery, gradientEcho, ernstAngle, mrImage, tissueSignals,
    rotate, bloch, spread, lorentzian, t2star,
    radon, rampFilter, backproject,
    haar2, randomLineMask, csRecon, nrmse, psnr,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Imaging = api;
})(typeof self !== "undefined" ? self : this);
