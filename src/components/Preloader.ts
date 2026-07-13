// =====================================================================
// PRELOADER — orbe de lignes concentriques froissées qui se forme au
// centre + compteur 000→100 piloté par la progression réelle.
// =====================================================================
// Même langage que la scène hero : anneaux déformés par un bruit doux,
// tracés en 2D. À 100 %, l'orbe se dilate et s'efface.

const RINGS = 26;

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
  exitK: number; // 0..1 : avancement de la sortie (dilatation + fondu)
  raf: number;
  t0: number;
  w = 0;
  h = 0;
  private _resize: () => void;
  private seeds: number[];

  constructor(onComplete?: () => void) {
    this.el = document.getElementById("preloader")!;
    this.canvas = document.getElementById("pixel-canvas") as HTMLCanvasElement;
    this.countEl = document.getElementById("preloader-count")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.onComplete = onComplete;

    this.progress = 0; // cible réelle (0→1)
    this.shown = 0;    // valeur affichée (lerp)
    this.done = false;
    this.exiting = false;
    this.exitK = 0;
    this.raf = 0;
    this.t0 = performance.now();
    this.seeds = Array.from({ length: RINGS }, () => Math.random() * 100);

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

  // Anneau déformé : rayon modulé par 2 sinus déphasés (froissé organique).
  private drawRing(cx: number, cy: number, r: number, seed: number, t: number, alpha: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    const STEPS = 90;
    for (let i = 0; i <= STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      const wob =
        Math.sin(a * 3 + seed + t * 0.7) * 0.055 +
        Math.sin(a * 7 - seed * 1.7 + t * 1.1) * 0.03;
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

  loop() {
    const ctx = this.ctx;
    const t = (performance.now() - this.t0) / 1000;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.w, this.h);

    // Compteur : lerp doux vers la progression réelle.
    this.shown += (this.progress - this.shown) * 0.08;
    const pct = Math.round(this.shown * 100);
    this.countEl.textContent = String(Math.min(pct, 100)).padStart(3, "0");

    const cx = this.w / 2;
    const cy = this.h / 2;
    const maxR = Math.min(this.w, this.h) * 0.22;

    if (!this.exiting) {
      // L'orbe se densifie avec la progression : les anneaux apparaissent
      // du centre vers l'extérieur.
      const visible = Math.max(2, Math.floor(RINGS * (0.15 + this.shown * 0.85)));
      for (let i = 0; i < visible; i++) {
        const k = (i + 1) / RINGS;
        const alpha = 0.05 + 0.12 * (1 - Math.abs(k - 0.75));
        this.drawRing(cx, cy, maxR * (0.25 + k * 0.75), this.seeds[i], t, alpha);
      }
      if (pct >= 100 && !this.done) {
        this.done = true;
        this.exiting = true;
      }
    } else {
      // Sortie : dilatation + fondu.
      this.exitK = Math.min(1, this.exitK + 0.035);
      const grow = 1 + this.exitK * 2.2;
      const fade = 1 - this.exitK;
      for (let i = 0; i < RINGS; i++) {
        const k = (i + 1) / RINGS;
        const alpha = (0.05 + 0.12 * (1 - Math.abs(k - 0.75))) * fade;
        this.drawRing(cx, cy, maxR * (0.25 + k * 0.75) * grow, this.seeds[i], t, alpha);
      }
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
