// =====================================================================
// PRELOADER — orbe dense (trou + anneaux concentriques + flux + particules)
// qui se forme progressivement. À 100 %, densité proche du hero final.
// =====================================================================

const RINGS = 58;
const FLOW_LINES = 48;
const PARTICLES = 2800;

export class Preloader {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  countEl: HTMLElement;
  ctx: CanvasRenderingContext2D;
  onComplete?: () => void;
  progress: number;
  shown: number;
  done: boolean;
  exiting: boolean;
  exitK: number;
  raf: number;
  t0: number;
  w = 0;
  h = 0;
  private _resize: () => void;
  private seeds: number[];
  private particles: { a: number; r: number; s: number }[];

  constructor(onComplete?: () => void) {
    this.el = document.getElementById("preloader")!;
    this.canvas = document.getElementById("pixel-canvas") as HTMLCanvasElement;
    this.countEl = document.getElementById("preloader-count")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.onComplete = onComplete;

    this.progress = 0;
    this.shown = 0;
    this.done = false;
    this.exiting = false;
    this.exitK = 0;
    this.raf = 0;
    this.t0 = performance.now();
    this.seeds = Array.from({ length: RINGS }, () => Math.random() * 100);
    this.particles = Array.from({ length: PARTICLES }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.12 + Math.random() * 0.88,
      s: Math.random() * 10,
    }));

    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    this.resize();
    this.loop();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setProgress(p: number) {
    this.progress = Math.max(this.progress, Math.min(1, p));
  }

  private drawRing(cx: number, cy: number, r: number, seed: number, t: number, alpha: number, steps = 100) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const wob =
        Math.sin(a * 3 + seed + t * 0.7) * 0.04 +
        Math.sin(a * 7 - seed * 1.7 + t * 1.1) * 0.025;
      const rr = r * (1 + wob);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(232, 237, 242, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawFlow(cx: number, cy: number, maxR: number, seed: number, t: number, alpha: number, radial: boolean) {
    const ctx = this.ctx;
    const baseA = seed * 0.17;
    ctx.beginPath();
    const STEPS = 64;
    for (let i = 0; i <= STEPS; i++) {
      const k = i / STEPS;
      let r: number, a: number;
      if (radial) {
        r = maxR * (0.08 + k * 0.92);
        a = baseA + Math.sin(k * 8 + seed) * 0.2;
      } else {
        r = maxR * (0.3 + k * 0.7);
        a = baseA + k * 1.6 + Math.sin(k * 5 + seed) * 0.3;
      }
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(210, 220, 230, ${alpha * 0.55})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  private drawOrb(cx: number, cy: number, maxR: number, density: number, t: number, fade = 1) {
    const ctx = this.ctx;
    const voidR = maxR * 0.06;

    // trou central
    ctx.fillStyle = `rgba(0, 0, 0, ${0.95 * fade})`;
    ctx.beginPath();
    ctx.arc(cx, cy, voidR, 0, Math.PI * 2);
    ctx.fill();

    const ringCount = Math.max(3, Math.floor(RINGS * density));
    for (let i = 0; i < ringCount; i++) {
      const k = (i + 1) / RINGS;
      const r = voidR + (maxR - voidR) * Math.pow(k, 0.82);
      const alpha = (0.04 + 0.14 * (1 - Math.abs(k - 0.7) * 0.8)) * fade;
      this.drawRing(cx, cy, r, this.seeds[i], t, alpha);
    }

    const flowCount = Math.floor(FLOW_LINES * density);
    for (let i = 0; i < flowCount; i++) {
      const a = (0.05 + 0.1 * (1 - Math.abs(i / FLOW_LINES - 0.5))) * fade;
      this.drawFlow(cx, cy, maxR, i * 2.1, t, a, i < flowCount * 0.45);
    }

    const pCount = Math.floor(PARTICLES * density * density);
    for (let i = 0; i < pCount; i++) {
      const p = this.particles[i];
      const r = voidR + (maxR - voidR) * p.r;
      const a = p.a + Math.sin(t * 0.5 + p.s) * 0.02;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const alpha = (0.15 + 0.35 * (1 - p.r)) * fade;
      ctx.fillStyle = `rgba(232, 237, 242, ${alpha})`;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  loop() {
    const ctx = this.ctx;
    const t = (performance.now() - this.t0) / 1000;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.w, this.h);

    this.shown += (this.progress - this.shown) * 0.08;
    const pct = Math.round(this.shown * 100);
    this.countEl.textContent = String(Math.min(pct, 100)).padStart(3, "0");

    const cx = this.w / 2;
    const cy = this.h / 2;
    const maxR = Math.min(this.w, this.h) * 0.24;
  // densité : monte vite vers 1 pour coller au hero à la fin
    const density = Math.min(1, 0.08 + Math.pow(this.shown, 0.72) * 0.95);

    if (!this.exiting) {
      this.drawOrb(cx, cy, maxR, density, t);
      if (pct >= 100 && !this.done) {
        this.done = true;
        this.exiting = true;
      }
    } else {
      this.exitK = Math.min(1, this.exitK + 0.028);
      const grow = 1 + this.exitK * 1.8;
      const fade = 1 - this.exitK;
      this.drawOrb(cx, cy, maxR * grow, 1, t, fade);
      if (this.exitK >= 1) {
        this.finish();
        return;
      }
    }

    this.raf = requestAnimationFrame(() => this.loop());
  }

  finish() {
    cancelAnimationFrame(this.raf);
    this.el.classList.add("preloader--done");
    window.removeEventListener("resize", this._resize);
    setTimeout(() => {
      this.el.style.display = "none";
      this.onComplete?.();
    }, 700);
  }
}
