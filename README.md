# Medical Imaging Lab

Interactive simulations of how MRI and CT images are made, from the physics that creates the signal to the algorithms that turn it into a picture. Everything runs in the browser on a synthetic head phantom.

**Live site:** https://angelmza1990.github.io/medical-imaging-lab/

## Modules

1. **[Spin physics](https://angelmza1990.github.io/medical-imaging-lab/spin-physics/)**: a Bloch-equation simulator. Watch 201 spins precess in the rotating frame, dephase with T2*, refocus into a spin echo and recover with T1; FID, spin echo and inversion recovery.
2. **[Tissue contrast](https://angelmza1990.github.io/medical-imaging-lab/contrast/)**: spin echo, inversion recovery and gradient echo on the head phantom at 1.5 T and 3 T, with presets for T1-weighted, T2-weighted, proton density, FLAIR and STIR, signal curves and contrast-to-noise.
3. **[k-space](https://angelmza1990.github.io/medical-imaging-lab/k-space/)**: the image's Fourier transform and what each part of it carries: low- and high-pass, aliasing from skipped lines, partial Fourier, random sampling, a corrupted sample (herringbone) and motion (ghosting), plus the wave behind any k-space point.
4. **[Accelerated MRI](https://angelmza1990.github.io/medical-imaging-lab/accelerated-mri/)**: compressed sensing against zero filling, with random or regular undersampling, noise and the sparsity weight, converging live in a web worker.
5. **[CT reconstruction](https://angelmza1990.github.io/medical-imaging-lab/ct/)**: the sinogram, plain and filtered back-projection (Ram-Lak, Shepp-Logan, Hann), the number of views, radiation dose as photon noise, and Hounsfield-unit windows.

The [overview](https://angelmza1990.github.io/medical-imaging-lab/) is also a short guide to the field and to the tools and datasets for going further; the [method](https://angelmza1990.github.io/medical-imaging-lab/method/) page documents the phantom, parameters, algorithms and limits.

## How it works

Static HTML, CSS and JavaScript; [D3.js](https://d3js.org/) for charts. All numerics are in one dependency-free file, `assets/imaging.js`:

- radix-2 FFT and centred 2D k-space
- a supersampled ellipse phantom with tissue fractions (partial volume)
- spin-echo, inversion-recovery and gradient-echo signal equations
- a Bloch simulator with hard pulses, exact precession and relaxation
- the Radon transform, a spatial-kernel ramp filter and back-projection
- an orthonormal Haar transform and FISTA compressed sensing with adaptive restart and cycle spinning

The tests in `tests/` check every routine against an analytic result: a direct DFT, Parseval's theorem, signal-equation limits, exponential relaxation, spin-echo refocusing, the T2* of a Lorentzian field spread, the Radon transform of a disk, Hounsfield units recovered within 3 HU, and compressed sensing beating zero filling. CI runs them and opens every page in headless Chrome on each push.

## Run it locally

```sh
python3 -m http.server 8080      # then open http://localhost:8080
node --test tests/*.test.js
```

## Disclaimer

Teaching simulations on a synthetic 2D phantom with approximate tissue parameters. Not a medical device.

## License

MIT.
