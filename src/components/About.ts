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
          <span class="about__kind">GROWTH DEVELOPER</span>
          <h2 class="about__name">MAXIMILLIEN</h2>
          <p class="about__lead">
            Tu m'amènes un problème, je te ramène le logiciel qui le règle. J'aime les dossiers compliqués, ceux où il faut creuser avant de coder.
          </p>

          <div class="about__cols">
            <div class="about__col">
              <span class="about__h">CE QUE J'AMÈNE</span>
              <ul>
                <li>2,6 M€ générés pour une boîte en construisant ses outils et ses tunnels</li>
                <li>Partenaire de croissance, je joue le résultat avec toi pas juste la livraison</li>
                <li>Je m'adapte à ta situation, c'est ton problème qui décide de la solution</li>
              </ul>
            </div>
            <div class="about__col">
              <span class="about__h">COMMENT</span>
              <ul>
                <li>On trouve toujours un moyen, même quand ça paraît bloqué au départ</li>
                <li>Un seul interlocuteur, de l'idée à la prod, tu parles à celui qui code</li>
                <li>Je livre vite, je corrige en direct, sans attendre le comité</li>
              </ul>
            </div>
          </div>

          <div class="about__facts">
            <div><b>2,6 M€</b><span>générés pour un client</span></div>
            <div><b>SOLO</b><span>de l'idée à la prod</span></div>
            <div><b>🇦🇩</b><span>basé en Andorre, je bosse partout</span></div>
          </div>

          <p class="about__quip">
            La sphère qui vit derrière, c'est le même code que celui de mes outils. J'aime quand un logiciel utile est aussi beau à regarder, c'est toute l'idée de ce que je construis.
          </p>

          <div class="about__cta">
            <button id="about-projects" class="about__btn">VOIR LES PROJETS →</button>
            <a href="mailto:oze.fr.contact@gmail.com" class="about__btn about__btn--ghost">ME CONTACTER</a>
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
