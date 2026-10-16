/* Aurora MP3 background: three large, heavily blurred glows that
 * wander slowly behind the glass. They take the colours of the album cover, drift
 * slowly, brighten a little with the sound, and settle when stopped. */

class AMAurora {
  constructor(host) {
    this.host = host;
    this.blobs = [0, 1, 2].map(i => {
      const el = document.createElement('div');
      el.className = 'amp-glow amp-glow-' + i;
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);
      return el;
    });
    // Each glow follows its own slow looping path (Lissajous-style)
    this.paths = [
      { ax: 0.42, ay: 0.30, fx: 1.0, fy: 0.7, px: 0.0, py: 1.3, cx: 0.25, cy: 0.18, size: 0.95 },
      { ax: 0.38, ay: 0.36, fx: 0.8, fy: 1.1, px: 2.1, py: 0.4, cx: 0.75, cy: 0.42, size: 0.85 },
      { ax: 0.34, ay: 0.28, fx: 1.2, fy: 0.9, px: 4.0, py: 2.6, cx: 0.45, cy: 0.80, size: 0.80 }
    ];
    this.phase = 0;
    this.speed = 0.2;      // eased
    this.bright = 0.35;    // eased
    this.cols = [[236, 72, 153], [249, 115, 22], [180, 83, 9]];
    this.target = { cols: this.cols, speed: 0.2, bright: 0.35 };
    this.running = false;
    this.still = false;
  }

  // cols: three [r,g,b]; playing/pulsing/pulsePeriod/level
  update({ cols, playing, pulsing, pulsePeriod, level }) {
    // a slow drift (~60 s loops) when playing, near-still when stopped; pulse quickens it a little with shorter breaths
    const base = playing ? (pulsing ? Math.min(0.3, 3 / Math.max(4, pulsePeriod)) : 0.1) : 0.035;
    this.target = { cols, speed: base, bright: playing ? 0.45 + Math.min(1, level || 0) * 0.25 : 0.22 };
  }

  setStill(s) { this.still = s; }

  start() {
    if (this.running) return;
    this.running = true;
    let last = 0;
    const loop = ts => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden || ts - last < 40) return;
      const dt = Math.min(0.2, (ts - (last || ts)) / 1000);
      last = ts;
      this.step(dt);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  step(dt) {
    const t = this.target, k = Math.min(1, dt * 0.8);
    this.speed += (t.speed - this.speed) * k;
    this.bright += (t.bright - this.bright) * Math.min(1, dt * 3);
    this.cols = this.cols.map((c, i) => c.map((v, j) => v + (t.cols[i][j] - v) * Math.min(1, dt * 0.7)));
    if (!this.still) this.phase += dt * this.speed;
    const w = this.host.clientWidth || 360, h = this.host.clientHeight || 600;
    const unit = Math.max(w, h * 0.7);
    this.blobs.forEach((el, i) => {
      const p = this.paths[i], ph = this.phase;
      const x = (p.cx + p.ax * Math.sin(ph * p.fx + p.px)) * w;
      const y = (p.cy + p.ay * Math.sin(ph * p.fy + p.py)) * h;
      const s = unit * p.size * (0.9 + 0.15 * Math.sin(ph * 0.7 + i));
      const c = this.cols[i];
      // fixed 400 px element, positioned and sized with transform only (cheap: no re-layout or re-blur)
      el.style.setProperty('--amp-x', (x - 200).toFixed(1) + 'px');
      el.style.setProperty('--amp-y', (y - 200).toFixed(1) + 'px');
      el.style.setProperty('--amp-k', (s / 400).toFixed(3));
      el.style.setProperty('--amp-c', `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);
      el.style.setProperty('--amp-o', (this.bright * (i === 2 ? 0.75 : 1)).toFixed(3));
    });
  }
}

/* Three glow colours from a cover image: the most common saturated colours, softened for a dark ground. */
function amPalette(url) {
  return new Promise(resolve => {
    const fallback = [[90, 120, 170], [200, 130, 90], [60, 80, 110]];
    if (!url) return resolve(fallback);
    const img = new Image();
    img.onload = () => {
      try {
        const n = 24, c = document.createElement('canvas'); c.width = c.height = n;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, n, n);
        const px = g.getImageData(0, 0, n, n).data, bins = new Map();
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], gg = px[i + 1], b = px[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          const sat = mx ? (mx - mn) / mx : 0, key = (r >> 5) << 6 | (gg >> 5) << 3 | (b >> 5);
          const w = 0.25 + sat * 1.5 + (mx > 40 ? 0.25 : 0);
          const e = bins.get(key) || { r: 0, g: 0, b: 0, w: 0 };
          e.r += r * w; e.g += gg * w; e.b += b * w; e.w += w; bins.set(key, e);
        }
        const cols = [...bins.values()].sort((a, z) => z.w - a.w).map(e => [e.r / e.w, e.g / e.w, e.b / e.w]);
        const out = [];
        for (const col of cols) { if (out.every(o => Math.abs(o[0] - col[0]) + Math.abs(o[1] - col[1]) + Math.abs(o[2] - col[2]) > 90)) out.push(col); if (out.length === 3) break; }
        while (out.length < 3) out.push(out[0] ? out[0].map(v => v * 0.6) : fallback[out.length]);
        resolve(out.map(col => { const mx = Math.max(...col, 1), k = mx < 90 ? 90 / mx : 1; return col.map(v => Math.min(255, Math.round(v * k))); }));
      } catch (e) { resolve(fallback); }
    };
    img.onerror = () => resolve(fallback);
    img.src = url;
  });
}
