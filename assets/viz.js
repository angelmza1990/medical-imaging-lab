// Medical Imaging Lab — image views: grayscale canvases with windowing and a value readout.
(function () {
  /**
   * An image panel. Call view.draw(data, opts) with a Float64Array of n*n values.
   * opts: { min, max } display window (defaults to the data range), log (show log(1 + v / max)),
   *       unit (readout label), format (value -> text)
   */
  function imageView(el, n, { title, note } = {}) {
    el.classList.add("img-view");
    el.innerHTML = `${title ? `<div class="img-title"></div>` : ""}<div class="img-box"><canvas width="${n}" height="${n}"></canvas><div class="img-readout"></div></div>${note ? `<div class="img-note"></div>` : ""}`;
    if (title) el.querySelector(".img-title").textContent = title;
    if (note) el.querySelector(".img-note").textContent = note;
    const canvas = el.querySelector("canvas"), ctx = canvas.getContext("2d");
    const readout = el.querySelector(".img-readout");
    const imgData = ctx.createImageData(n, n);
    let last = null, opts = {};
    function draw(data, o = {}) {
      last = data;
      opts = o;
      let lo = o.min, hi = o.max;
      if (lo == null || hi == null) {
        let a = Infinity, b = -Infinity;
        for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < a) a = v; if (v > b) b = v; }
        if (lo == null) lo = o.log ? 0 : a;
        if (hi == null) hi = b;
      }
      const span = hi - lo || 1;
      const logMax = Math.log1p(hi);
      for (let i = 0; i < n * n; i++) {
        let t = o.log ? Math.log1p(Math.max(0, data[i])) / (logMax || 1) : (data[i] - lo) / span;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const g = Math.round(t * 255);
        imgData.data[4 * i] = imgData.data[4 * i + 1] = imgData.data[4 * i + 2] = g;
        imgData.data[4 * i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * n), y = Math.floor(((e.clientY - r.top) / r.height) * n);
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      const v = last[y * n + x];
      readout.textContent = `(${x}, ${y})  ${opts.format ? opts.format(v) : v.toFixed(3)}${opts.unit ? " " + opts.unit : ""}`;
      readout.style.opacity = 1;
    });
    canvas.addEventListener("pointerleave", () => { readout.style.opacity = 0; });
    return { draw, canvas, setTitle: (t) => { const h = el.querySelector(".img-title"); if (h) h.textContent = t; }, setNote: (t) => { const h = el.querySelector(".img-note"); if (h) h.textContent = t; } };
  }

  /** Magnitude of a complex array. */
  function magnitude(re, im) {
    const out = new Float64Array(re.length);
    for (let i = 0; i < re.length; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }

  /** A labelled range slider: returns { value(), set(v) }. */
  function slider(el, { label, min, max, step, value, format = (v) => v, onInput }) {
    el.className = "field slider";
    el.innerHTML = `<span class="slider-head"><span></span><b></b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
    el.querySelector(".slider-head span").textContent = label;
    const input = el.querySelector("input"), out = el.querySelector("b");
    const show = () => { out.textContent = format(+input.value); };
    input.addEventListener("input", () => { show(); onInput && onInput(+input.value); });
    show();
    return { value: () => +input.value, set: (v) => { input.value = v; show(); }, input };
  }

  window.Viz = { imageView, magnitude, slider };
})();
