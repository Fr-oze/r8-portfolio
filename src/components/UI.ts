import { addSlider } from "../core/ui";

// =====================================================================
// UI — overlay style instrument : nav, horloge, stats, sliders
// =====================================================================
export class UI {
  el: HTMLElement;
  clockEl: HTMLElement;
  fpsEl: HTMLElement;
  partEl: HTMLElement;
  modeEl: HTMLElement | null;
  private _fpsAcc: number;
  private _fpsFrames: number;
  private _clockTimer: ReturnType<typeof setInterval> | null;

  constructor() {
    this.el = document.getElementById("ui")!;
    this.clockEl = document.getElementById("clock")!;
    this.fpsEl = document.getElementById("stat-fps")!;
    this.partEl = document.getElementById("stat-particles")!;
    this.modeEl = document.getElementById("stat-mode");

    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._clockTimer = null;
  }

  // Apparition en cascade après le scan.
  reveal() {
    this.el.classList.remove("ui--hidden");
    this.el.classList.add("ui--reveal");
    document.body.classList.add("ui-ready");
    this.startClock();
  }

  startClock() {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      this.clockEl.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    tick();
    this._clockTimer = setInterval(tick, 1000);
  }

  setParticles(n: number) {
    this.partEl.textContent = n.toLocaleString("en-US");
  }

  setMode(label: string) {
    if (this.modeEl) this.modeEl.textContent = label;
  }

  // Compteur FPS lissé (mise à jour ~2x/s).
  tickFps(dt: number) {
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      const fps = Math.round(this._fpsFrames / this._fpsAcc);
      this.fpsEl.textContent = String(fps);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  }

  buildControls({
    onDensity,
    onGlow,
    onRotation,
  }: {
    onDensity: (v: number) => void;
    onGlow: (v: number) => void;
    onRotation: (v: number) => void;
  }) {
    addSlider({
      label: "densité",
      min: 0, max: 1, value: 0.35, step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: onDensity,
    });
    addSlider({
      label: "glow",
      min: 0, max: 1.2, value: 0.3, step: 0.05,
      onInput: onGlow,
    });
    addSlider({
      label: "rotation",
      min: 0, max: 1, value: 0.1, step: 0.05,
      onInput: onRotation,
    });
  }
}
