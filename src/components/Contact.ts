// =====================================================================
// CONTACT — panneau plein écran : email et WhatsApp.
// =====================================================================
import { lockPageScroll, unlockPageScroll, bindPanelWheel } from "../core/scrollLock";
const EMAIL = "oze.fr.contact@gmail.com";
const PHONE_DISPLAY = "+33 6 74 24 74 94";
// Le canal "téléphone" ouvre WhatsApp (wa.me attend le numéro sans + ni espaces).
const WHATSAPP = "https://wa.me/33674247494";

export class Contact {
  open: boolean;
  el!: HTMLElement;

  constructor() {
    this.open = false;
    this._build();
  }

  _build() {
    const el = document.createElement("div");
    el.className = "contact";
    el.innerHTML = `
      <div class="contact__head">
        <span class="contact__title">CONTACT</span>
        <button class="contact__close" aria-label="close">CLOSE ✕</button>
      </div>

      <div class="contact__body">
        <div class="contact__grid"></div>

        <div class="contact__inner">
          <div class="contact__intro">
            <span class="contact__tag">DISPONIBLE</span>
            <h2 class="contact__lead">Un projet à lancer,<br /><span>ou un problème à régler</span>&nbsp;?</h2>
            <p class="contact__sub">
              Écris moi, je réponds vite. Pas de formulaire interminable, tu parles direct à celui qui code.
            </p>
          </div>

          <div class="contact__channels">
            <a class="contact__channel" href="mailto:${EMAIL}">
              <span class="contact__ch-no">01</span>
              <span class="contact__ch-main">
                <span class="contact__ch-label">EMAIL</span>
                <span class="contact__ch-value">${EMAIL}</span>
              </span>
              <span class="contact__ch-arrow">→</span>
              <span class="contact__ch-sweep"></span>
            </a>
            <a class="contact__channel" href="${WHATSAPP}" target="_blank" rel="noopener">
              <span class="contact__ch-no">02</span>
              <span class="contact__ch-main">
                <span class="contact__ch-label">WHATSAPP</span>
                <span class="contact__ch-value">${PHONE_DISPLAY}</span>
              </span>
              <span class="contact__ch-arrow">→</span>
              <span class="contact__ch-sweep"></span>
            </a>
          </div>

          <div class="contact__meta">
            <div class="contact__cell">
              <span class="contact__k">STATUS</span>
              <span class="contact__v contact__v--live"><i></i>DISPONIBLE</span>
            </div>
            <div class="contact__cell">
              <span class="contact__k">BASE</span>
              <span class="contact__v">ANDORRE AD</span>
            </div>
            <div class="contact__cell">
              <span class="contact__k">RÉPONSE</span>
              <span class="contact__v">&lt; 24H</span>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector(".contact__close")!.addEventListener("click", () => this.hide());

    bindPanelWheel(el, () => el.querySelector(".contact__body"));
  }

  show() {
    this.open = true;
    lockPageScroll();
    this.el.classList.add("contact--open");
  }

  hide() {
    this.open = false;
    unlockPageScroll();
    this.el.classList.remove("contact--open");
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }
}
