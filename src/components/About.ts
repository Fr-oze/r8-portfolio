import { lockPageScroll, unlockPageScroll, bindPanelWheel } from "../core/scrollLock";
import { PortraitScene } from "./PortraitScene";

// =====================================================================
// ABOUT — panneau plein écran (DA wireframe) : portrait 3D data/wireframe
// (rendu mixte points/arêtes/triangulation divisé spatialement) + texte de
// présentation. La scène 3D n'est créée qu'à la première ouverture.
// =====================================================================
export class About {
  open: boolean;
  portrait: PortraitScene | null;
  el!: HTMLElement;
  canvas!: HTMLCanvasElement;
  loader!: HTMLElement | null;
  private _onResize!: () => void;

  constructor() {
    this.open = false;
    this.portrait = null;
    this._build();
  }

  _build() {
    const el = document.createElement("div");
    el.className = "about";
    el.innerHTML = `
      <div class="about__head">
        <span class="about__title">ABOUT</span>
        <button class="about__close" aria-label="close">CLOSE ✕</button>
      </div>

      <div class="about__body">
        <figure class="about__portrait">
          <canvas id="portrait-canvas" class="about__canvas"></canvas>
          <div class="about__loader" data-loader>
            <div class="about__loader-bar"><i></i></div>
            <span class="about__loader-txt">CHARGEMENT DU MODÈLE 3D…</span>
          </div>
          <figcaption class="about__cap">
            <span>SUBJECT / MAXIMILLIEN</span>
            <span>RENDER / POINTS EDGES MESH</span>
          </figcaption>
        </figure>

        <div class="about__text">
          <span class="about__kind">ZÉRO LEAD MORT</span>
          <h2 class="about__name">MAXIMILLIEN</h2>
          <p class="about__lead">
            Je dirige une agence. Je connais la sensation d'ouvrir sa boîte mail le lundi et de trouver trois demandes de la semaine dernière jamais traitées. J'installe le système qui règle ça.
          </p>

          <div class="about__cols">
            <div class="about__col">
              <span class="about__h">POUR QUI</span>
              <ul>
                <li>Tu as du flux entrant, mais la moitié pourrit dans ta boîte mail</li>
                <li>Tu es sous l'eau sur la delivery, le commercial attend « quand tu as le temps »</li>
                <li>Tu veux que chaque lead soit traité sans que tu sois dessus</li>
              </ul>
            </div>
            <div class="about__col">
              <span class="about__h">CE QUE JE LIVRE</span>
              <ul>
                <li>Tunnel opt-in → mail → groupe WhatsApp (ressource)</li>
                <li>Dashboard : pipeline, récaps IA, alertes FUP</li>
                <li>Notifs téléphone + SOP commercial. Toi tu closes.</li>
              </ul>
            </div>
          </div>

          <div class="about__facts">
            <div><b>7 J</b><span>installation complète</span></div>
            <div><b>~6K€</b><span>fuite type / mois</span></div>
            <div><b>🇦🇩</b><span>Andorre, je bosse partout</span></div>
          </div>

          <p class="about__quip">
            Tu ne vas pas faire plus de marketing. Tu vas juste arrêter de jeter la moitié de ce que ton marketing te ramène.
          </p>

          <div class="about__cta">
            <button id="about-projects" class="about__btn">VOIR LA PREUVE →</button>
            <a href="mailto:oze.fr.contact@gmail.com" class="about__btn about__btn--ghost">CHIFFRER MA FUITE</a>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    this.el = el;
    this.canvas = el.querySelector("#portrait-canvas") as HTMLCanvasElement;
    this.loader = el.querySelector("[data-loader]");

    el.querySelector(".about__close")!.addEventListener("click", () => this.hide());

    bindPanelWheel(el, () => el.querySelector(".about__body"));

    // parallaxe : le portrait suit légèrement le curseur.
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.portrait) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.portrait.setPointer(x, y);
    });
    this.canvas.addEventListener("pointerleave", () => this.portrait?.clearPointer());

    this._onResize = () => this.portrait && this.portrait.resize();
    window.addEventListener("resize", this._onResize);
  }

  _ensurePortrait() {
    if (this.portrait) return;
    this.portrait = new PortraitScene(this.canvas);
    this.portrait.load();
  }

  show() {
    this.open = true;
    lockPageScroll();
    this.el.classList.add("about--open");
    this._ensurePortrait();
    // attendre le layout (canvas a sa taille) avant de dimensionner + lancer.
    requestAnimationFrame(() => {
      this.portrait.resize();
      this.portrait.start();
      this._watchLoad();
    });
  }

  // Masque le loader une fois le modèle construit et le fondu d'apparition bien
  // entamé, pour ne pas révéler un canvas vide.
  _watchLoad() {
    if (!this.loader) return;
    this.loader.classList.remove("about__loader--done");
    const tick = () => {
      if (!this.open) return;
      const p = this.portrait;
      if (p && p.ready && p.uniforms.uReveal.value > 0.35) {
        this.loader.classList.add("about__loader--done");
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  hide() {
    this.open = false;
    unlockPageScroll();
    this.el.classList.remove("about--open");
    // on coupe la boucle pour ne pas consommer le GPU en arrière-plan.
    this.portrait?.stop();
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }
}
