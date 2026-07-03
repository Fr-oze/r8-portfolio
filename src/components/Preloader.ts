// =====================================================================
// PRELOADER — R8 en pixel-art qui traverse l'écran + compteur 000→100
// =====================================================================
// Dessine une R8 de profil en pixel-art sur un canvas 2D, la fait défiler
// de droite à gauche en boucle avec des motion lines. Le compteur est piloté
// par la VRAIE progression de chargement (voir setProgress / LoadingManager).

// Grille pixel-art de la R8 (vue de profil). 1 = carrosserie, 2 = vitres,
// 3 = phares, 4 = roues, 5 = jante. 0 = vide.
const SPRITE = [
  "00000000000000000000000000",
  "00000000111111111000000000",
  "00000011222222221110000000",
  "00011112222222222211111000",
  "01111111111111111111111130",
  "31111111111111111111111110",
  "01114011111111111114011100",
  "00040400000000000004040000",
  "00040400000000000004040000",
  "00004000000000000000400000",
];

const COLORS: Record<string, string> = {
  1: "#e8edf2", // carrosserie
  2: "#7f8a96", // vitres
  3: "#ff5a5a", // phare
  4: "#1c1f24", // pneu
  5: "#cfd6dd", // jante
};

export class Preloader {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  countEl: HTMLElement;
  ctx: CanvasRenderingContext2D;
  onComplete?: () => void;
  progress: number;
  shown: number;
  carX: number;
  done: boolean;
  exiting: boolean;
  raf: number;
  w = 0;
  h = 0;
  px = 3;
  exitX = 0;
  private _resize: () => void;

  constructor(onComplete?: () => void) {
    this.el = document.getElementById("preloader")!;
    this.canvas = document.getElementById("pixel-canvas") as HTMLCanvasElement;
    this.countEl = document.getElementById("preloader-count")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.onComplete = onComplete;

    this.progress = 0;       // cible réelle (0→1)
    this.shown = 0;          // valeur affichée (lerp)
    this.carX = 0;
    this.done = false;
    this.exiting = false;
    this.raf = 0;

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
    this.px = Math.max(3, Math.round(this.w / 240)); // taille d'un "pixel"
  }

  setProgress(p: number) {
    this.progress = Math.max(this.progress, Math.min(1, p));
  }

  drawCar(x: number, y: number) {
    const ctx = this.ctx;
    const px = this.px;
    const sw = SPRITE[0].length * px;

    // Motion lines / traînée derrière la voiture.
    ctx.strokeStyle = "rgba(180,200,220,0.18)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const ly = y + (i * SPRITE.length * px) / 7 + px;
      const len = 40 + Math.random() * 120;
      ctx.beginPath();
      ctx.moveTo(x + sw + 10 + i * 6, ly);
      ctx.lineTo(x + sw + 10 + i * 6 + len, ly);
      ctx.stroke();
    }

    // Sprite pixel par pixel.
    for (let r = 0; r < SPRITE.length; r++) {
      for (let c = 0; c < SPRITE[r].length; c++) {
        const k = SPRITE[r][c];
        if (k === "0") continue;
        ctx.fillStyle = COLORS[k] || "#fff";
        ctx.fillRect(x + c * px, y + r * px, px, px);
      }
    }
  }

  loop() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.w, this.h);

    // Compteur : lerp doux vers la progression réelle.
    this.shown += (this.progress - this.shown) * 0.08;
    const pct = Math.round(this.shown * 100);
    this.countEl.textContent = String(Math.min(pct, 100)).padStart(3, "0");

    const sw = SPRITE[0].length * this.px;
    const y = this.h / 2 - (SPRITE.length * this.px) / 2;

    if (!this.exiting) {
      // Boucle : traverse de droite à gauche.
      this.carX -= this.w / 130;
      if (this.carX < -sw) this.carX = this.w;
      this.drawCar(this.carX, y);

      // À 100 % (affiché), on déclenche la sortie.
      if (pct >= 100 && !this.done) {
        this.done = true;
        this.exiting = true;
        this.exitX = this.carX;
      }
    } else {
      // Sortie : la voiture file vers la gauche hors écran.
      this.exitX -= this.w / 45;
      this.drawCar(this.exitX, y);
      if (this.exitX < -sw - 40) {
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
