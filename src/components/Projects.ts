import { PROJECTS, type Project } from "../data/projects";
// =====================================================================
// PROJECTS — panneau plein écran (DA wireframe)
//  · vue LISTE en scroll infini (liste rendue 3× → boucle sans couture)
//  · vue DÉTAIL au clic : pourquoi / comment / ce qui a été fait / résultat
// =====================================================================

export class Projects {
  open: boolean;
  el!: HTMLElement;
  scroll!: HTMLElement;
  inner!: HTMLElement;
  detail!: HTMLElement;
  lightbox!: HTMLElement;
  lightboxImg!: HTMLImageElement;
  lightboxCap!: HTMLElement;
  private _hero: HTMLElement | null = null;
  private _onDetailScroll?: () => void;
  private _autoRunning = false;
  private _autoRaf = 0;

  constructor() {
    this.open = false;
    this._build();
  }

  // ----- LISTE -------------------------------------------------------------
  _row(p: Project, i: number) {
    const idx = String((i % PROJECTS.length) + 1).padStart(2, "0");
    const media = p.image
      ? `<img class="pj-row__img" src="${p.image}" alt="${p.name}" loading="lazy" />`
      : `<div class="pj-row__img pj-row__img--ph"><span>NO PREVIEW</span></div>`;
    return `
      <button class="pj-row" data-id="${p.id}">
        <span class="pj-row__idx">${idx}</span>
        <div class="pj-row__media">${media}</div>
        <div class="pj-row__body">
          <span class="pj-row__kind">${p.kind} · ${p.year}</span>
          <span class="pj-row__name">${p.name}</span>
          <span class="pj-row__text">${p.text}</span>
          <span class="pj-row__tags">${p.tags.map((t) => `<i>${t}</i>`).join("")}</span>
        </div>
        <span class="pj-row__go">→</span>
      </button>`;
  }

  // ----- DÉTAIL ------------------------------------------------------------
  _detailHTML(p: Project) {
    const d = p.detail || ({} as Project["detail"]);
    const feats = (d.features || [])
      .map(
        ([t, b, hl]) => `
        <div class="pj-feat ${hl ? "pj-feat--hl" : ""}">
          <span class="pj-feat__t">${t}</span>
          <span class="pj-feat__b">${b}</span>
        </div>`
      )
      .join("");
    const gallery = (d.gallery || [])
      .map(
        ([label, img, span]) => `
        <figure class="pj-shot${span === "wide" ? " pj-shot--wide" : ""}">
          <button class="pj-shot__btn" data-full="${img}" data-cap="${label}" aria-label="Agrandir : ${label}">
            <img src="${img}" alt="${label}" loading="lazy" />
            <span class="pj-shot__zoom">⤢</span>
          </button>
          <figcaption>${label}</figcaption>
        </figure>`
      )
      .join("");

    const brand = p.brand;
    const heroLogo = brand.logo
      ? `<div class="pj-hero__logo-wrap" style="--logo:url('${brand.logo}')">
           <img class="pj-hero__logo" src="${brand.logo}" alt="" />
           <span class="pj-hero__sheen"></span>
         </div>`
      : "";
    const styleVars = brand.accent ? ` style="--brand:${brand.accent}"` : "";

    return `
      <button class="pj-back">← INDEX</button>

      <section class="pj-hero" data-hero${styleVars}>
        <div class="pj-hero__halo"></div>
        <div class="pj-hero__inner">
          ${heroLogo}
          <h1 class="pj-hero__title">${this._kinetic(p.name)}</h1>
          <div class="pj-hero__line"></div>
          <span class="pj-hero__kind">${p.kind} · ${p.year}</span>
          ${d.role ? `<span class="pj-hero__role">${d.role}</span>` : ""}
        </div>
        <span class="pj-hero__scroll">SCROLL ↓</span>
      </section>

      <section class="pj-block">
        <span class="pj-block__tag">01 · LE PROBLÈME</span>
        <p>${d.problem || ""}</p>
      </section>

      <section class="pj-block">
        <span class="pj-block__tag">02 · CE QU'ON A FAIT</span>
        <p>${d.solution || ""}</p>
      </section>

      ${
        feats
          ? `<section class="pj-block">
               <span class="pj-block__tag">03 · LE DÉTAIL</span>
               <div class="pj-feats">${feats}</div>
             </section>`
          : ""
      }

      ${
        d.result
          ? `<section class="pj-block pj-block--result">
               <span class="pj-block__tag">04 · LE RÉSULTAT</span>
               <p>${d.result}</p>
             </section>`
          : ""
      }

      ${
        gallery
          ? `<section class="pj-block">
               <span class="pj-block__tag">05 · APERÇUS</span>
               <div class="pj-shots">${gallery}</div>
             </section>`
          : ""
      }

      ${
        p.url
          ? `<a class="pj-visit" href="https://${p.url}" target="_blank" rel="noreferrer">
               VOIR LE PROJET EN LIGNE · ${p.url} ↗
             </a>`
          : ""
      }

      <button class="pj-next" data-next="${this._nextId(p.id)}">
        <span class="pj-next__row">
          <span class="pj-next__hint">FIN · PROJET SUIVANT</span>
          <span class="pj-next__name">${this._nextName(p.id)} →</span>
        </span>
        <span class="pj-next__bar"><span class="pj-next__fill"></span></span>
        <span class="pj-next__sub">RESTEZ EN BAS POUR CHARGER · OU CLIQUEZ</span>
      </button>`;
  }

  // Découpe le titre en lettres : chaque lettre monte de derrière un masque,
  // décalée dans le temps (typo cinétique élégante).
  _kinetic(text: string) {
    let n = 0;
    return [...text]
      .map((ch) => {
        if (ch === " ") return `<span class="pj-ch pj-ch--sp">&nbsp;</span>`;
        const i = n++;
        return `<span class="pj-ch"><i style="--i:${i}">${ch}</i></span>`;
      })
      .join("");
  }

  _nextIndex(id: string) {
    const i = PROJECTS.findIndex((x) => x.id === id);
    return (i + 1) % PROJECTS.length;
  }
  _nextId(id: string) {
    return PROJECTS[this._nextIndex(id)].id;
  }
  _nextName(id: string) {
    return PROJECTS[this._nextIndex(id)].name;
  }

  _build() {
    const el = document.createElement("div");
    el.className = "projects";
    el.innerHTML = `
      <div class="projects__head">
        <span class="projects__title">PROJECTS · INDEX</span>
        <button class="projects__close" aria-label="close">CLOSE ✕</button>
      </div>
      <div class="projects__scroll">
        <div class="projects__inner"></div>
      </div>
      <div class="projects__detail"></div>
      <div class="pj-lightbox" data-lightbox hidden>
        <button class="pj-lightbox__close" aria-label="fermer">✕</button>
        <figure class="pj-lightbox__fig">
          <img class="pj-lightbox__img" alt="" />
          <figcaption class="pj-lightbox__cap"></figcaption>
        </figure>
      </div>`;
    document.body.appendChild(el);

    this.el = el;
    this.scroll = el.querySelector(".projects__scroll") as HTMLElement;
    this.inner = el.querySelector(".projects__inner") as HTMLElement;
    this.detail = el.querySelector(".projects__detail") as HTMLElement;
    this.lightbox = el.querySelector("[data-lightbox]") as HTMLElement;
    this.lightboxImg = this.lightbox.querySelector(".pj-lightbox__img") as HTMLImageElement;
    this.lightboxCap = this.lightbox.querySelector(".pj-lightbox__cap") as HTMLElement;

    // Triple rendu pour la boucle infinie.
    const once = PROJECTS.map((p, i) => this._row(p, i)).join("");
    this.inner.innerHTML = once + once + once;

    el.querySelector(".projects__close")!.addEventListener("click", () => this.hide());

    // Clic sur une ligne → vue détail.
    this.inner.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".pj-row");
      if (row?.dataset.id) this.showDetail(row.dataset.id);
    });

    this.scroll.addEventListener("scroll", () => this._loopScroll());

    // Clic sur un aperçu → lightbox plein écran.
    this.detail.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".pj-shot__btn");
      if (btn) this.openLightbox(btn.dataset.full, btn.dataset.cap);
    });
    this.lightbox.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".pj-lightbox__img")) return;
      this.closeLightbox();
    });
  }

  openLightbox(src?: string, cap?: string) {
    if (!src) return;
    this.lightboxImg.src = src;
    this.lightboxImg.alt = cap || "";
    this.lightboxCap.textContent = cap || "";
    this.lightbox.hidden = false;
    requestAnimationFrame(() => this.lightbox.classList.add("pj-lightbox--open"));
  }

  closeLightbox() {
    this.lightbox.classList.remove("pj-lightbox--open");
    const hide = () => {
      this.lightbox.hidden = true;
      this.lightboxImg.removeAttribute("src");
    };
    setTimeout(hide, 220);
  }

  _loopScroll() {
    const block = this.inner.scrollHeight / 3;
    const s = this.scroll.scrollTop;
    if (s < block * 0.5) this.scroll.scrollTop = s + block;
    else if (s > block * 1.5) this.scroll.scrollTop = s - block;
  }

  showDetail(id?: string) {
    const p = PROJECTS.find((x) => x.id === id);
    if (!p) return;
    this._cancelAutoNext();
    this.detail.innerHTML = this._detailHTML(p);
    this.detail.querySelector(".pj-back")!.addEventListener("click", () => this.showList());

    const nextBtn = this.detail.querySelector<HTMLElement>(".pj-next");
    nextBtn?.addEventListener("click", () => this.showDetail(nextBtn.dataset.next));

    this._hero = this.detail.querySelector("[data-hero]");

    // Scroll : on (ré)arme juste l'auto-avance en bas de page.
    this._onDetailScroll = () => this._checkBottom();
    this.detail.addEventListener("scroll", this._onDetailScroll);

    this.detail.scrollTop = 0;
    this.el.classList.add("projects--detail");

    // Le hero entre en scène (reveal CSS : logo + reflet, titre cinétique).
    requestAnimationFrame(() => {
      this._hero?.classList.add("pj-hero--in");
      this._checkBottom();
    });
  }

  _checkBottom() {
    const d = this.detail;
    // Page non scrollable (projet court) → pas d'auto-avance automatique.
    const scrollable = d.scrollHeight > d.clientHeight + 40;
    const atBottom = d.scrollTop + d.clientHeight >= d.scrollHeight - 8;
    if (scrollable && atBottom) this._startAutoNext();
    else this._cancelAutoNext();
  }

  _startAutoNext() {
    if (this._autoRunning) return;
    this._autoRunning = true;
    const fill = this.detail.querySelector<HTMLElement>(".pj-next__fill");
    const wrap = this.detail.querySelector<HTMLElement>(".pj-next");
    const nextId = wrap?.dataset.next;
    wrap?.classList.add("pj-next--armed");
    const DURATION = 3000; // 3 s en bas → chargement
    const start = performance.now();
    const step = (now: number) => {
      if (!this._autoRunning) return;
      const prog = Math.min(1, (now - start) / DURATION);
      if (fill) fill.style.transform = `scaleX(${prog})`;
      if (prog >= 1) {
        this._autoRunning = false;
        if (nextId) this.showDetail(nextId);
        return;
      }
      this._autoRaf = requestAnimationFrame(step);
    };
    this._autoRaf = requestAnimationFrame(step);
  }

  _cancelAutoNext() {
    this._autoRunning = false;
    cancelAnimationFrame(this._autoRaf);
    const fill = this.detail.querySelector<HTMLElement>(".pj-next__fill");
    const wrap = this.detail.querySelector<HTMLElement>(".pj-next");
    if (fill) fill.style.transform = "scaleX(0)";
    wrap?.classList.remove("pj-next--armed");
  }

  showList() {
    this._cancelAutoNext();
    if (this._onDetailScroll) this.detail.removeEventListener("scroll", this._onDetailScroll);
    this.detail.innerHTML = "";
    this._hero = null;
    this.el.classList.remove("projects--detail");
  }

  show() {
    this.open = true;
    this.showList();
    this.el.classList.add("projects--open");
    requestAnimationFrame(() => {
      this.scroll.scrollTop = this.inner.scrollHeight / 3;
    });
  }

  hide() {
    this.open = false;
    this._cancelAutoNext();
    this.closeLightbox();
    this.showList();
    this.el.classList.remove("projects--open");
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }
}
