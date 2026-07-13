import "./style.css";
import * as THREE from "three";
import { Stage } from "./core/Stage";
import { Preloader } from "./components/Preloader";
import { OrbScene } from "./components/OrbScene";
import { Lighting } from "./components/Lighting";
import { UI } from "./components/UI";
import { Projects } from "./components/Projects";
import { About } from "./components/About";
import { Contact } from "./components/Contact";
import { OrbFlightMode } from "./components/OrbFlightMode";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CinematicShader } from "./shaders/cinematic";

// Détection tactile : ajustements UI (CTA, tailles de cibles).
const isTouch =
  window.matchMedia?.("(pointer: coarse)").matches ||
  "ontouchstart" in window ||
  navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");

// --- Setup scène + composants ----------------------------------------------
const stage = new Stage(document.getElementById("scene"));

// La sphère est générée (aucun asset à télécharger) : le compteur du preloader
// est piloté par une rampe courte, le temps que la scène soit prête.
const preloader = new Preloader(() => onPreloaderDone());
{
  const t0 = performance.now();
  const ramp = () => {
    const p = Math.min(1, (performance.now() - t0) / 1400);
    preloader.setProgress(p);
    if (p < 1) requestAnimationFrame(ramp);
  };
  requestAnimationFrame(ramp);
}

const ui = new UI();

// Panneau projets (liste + scroll infini), ouvert depuis le bouton haut-gauche
// et le lien PROJECTS du nav.
const projects = new Projects();
document.getElementById("open-projects")?.addEventListener("click", () => projects.toggle());
document.getElementById("open-projects-cta")?.addEventListener("click", () => projects.show());
document.getElementById("quip-projects")?.addEventListener("click", () => projects.show());
// Panneau About : portrait 3D data/wireframe + présentation.
const about = new About();
document.getElementById("about-projects")?.addEventListener("click", () => {
  about.hide();
  projects.show();
});
// Bouton ABOUT dédié au mobile (les liens nav y sont masqués).
document.getElementById("about-mobile")?.addEventListener("click", () => about.show());

// Panneau Contact : canal de transmission (email + téléphone).
const contact = new Contact();
// Bouton CONTACT dédié au mobile (les liens nav y sont masqués).
document.getElementById("contact-mobile")?.addEventListener("click", () => contact.show());
// Le bouton "ME CONTACTER" d'About ouvre le panneau Contact.
about.el.querySelector(".about__btn--ghost")?.addEventListener("click", (e) => {
  e.preventDefault();
  about.hide();
  contact.show();
});

// Liens de nav câblés par id (plus robuste qu'un matching sur le texte).
const navLink = (id: string, fn: () => void) =>
  document.getElementById(id)?.addEventListener("click", (e) => {
    e.preventDefault();
    fn();
  });
navLink("nav-projects", () => projects.show());
navLink("nav-about", () => about.show());
navLink("nav-contact", () => contact.show());

// --- Sections de scroll (sous le hero — sans toucher à la scène 3D) ----------
const heroSpacer = document.querySelector(".hero-spacer");
const scrollSections = document.querySelectorAll(".scroll-section");

const syncPastHero = () => {
  const threshold = (heroSpacer?.clientHeight ?? window.innerHeight) * 0.55;
  document.body.classList.toggle("past-hero", window.scrollY > threshold);
};
window.addEventListener("scroll", syncPastHero, { passive: true });
syncPastHero();

if ("IntersectionObserver" in window) {
  const sectionIo = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add("scroll-section--in");
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  scrollSections.forEach((s) => sectionIo.observe(s));
} else {
  scrollSections.forEach((s) => s.classList.add("scroll-section--in"));
}

document.querySelectorAll(".project-card[data-project]").forEach((card) => {
  card.addEventListener("click", () => {
    const id = (card as HTMLElement).dataset.project;
    if (!id) return;
    projects.show();
    projects.showDetail(id);
  });
});

document.getElementById("scroll-contact-cta")?.addEventListener("click", () => contact.show());

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Lightbox d'abord : on ferme l'image agrandie avant le reste.
  if (projects.lightbox && !projects.lightbox.hidden) {
    projects.closeLightbox();
    return;
  }
  if (contact.open) {
    contact.hide();
    return;
  }
  if (about.open) {
    about.hide();
    return;
  }
  if (!projects.open) return;
  // Échap : détail → liste, puis liste → fermer.
  if (projects.el.classList.contains("projects--detail")) projects.showList();
  else projects.hide();
});

const orb = new OrbScene(stage);
const lighting = new Lighting(stage, orb.group);
const dive = new OrbFlightMode(stage, orb);

document.getElementById("dive-start")?.addEventListener("click", () => dive.enter());
document.getElementById("dive-exit")?.addEventListener("click", () => dive.exit());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dive.active) dive.exit();
});

let spin = 0; // rotation lente du disque dans son plan (z)
let density = 0.35; // valeur courante du slider de densité

// Le disque a tourné pendant le vol : on resynchronise pour éviter tout saut.
dive.onExited = (finalSpin) => {
  spin = finalSpin - userSpin;
};

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Cadrage responsive : recul de la caméra calculé d'après le ratio écran pour
// que la sphère (déformée, donc un peu plus large que son rayon) reste entière.
function frameOrb() {
  const w = window.innerWidth, h = window.innerHeight;
  const desktop = w > 720;
  orb.group.position.set(0, desktop ? 0.15 : 0.1, 0);

  const fitD = orb.radius * 2 * (desktop ? 1.5 : 1.7); // diamètre + marge
  const aspect = w / h;
  const vFov = (stage.camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distH = fitD / 2 / Math.tan(hFov / 2);
  const distV = fitD / 2 / Math.tan(vFov / 2);
  stage.camera.position.z = clampN(Math.max(distH, distV) + 1.2, 6, 26);
  stage.camera.updateProjectionMatrix();
}

orb.onReady = () => {
  orb.setDetail(density);
  ui.setParticles(orb.particleCount);
  frameOrb();
};
orb.onScanComplete = () => {
  ui.reveal(); // UI en cascade
  // La phrase signature apparaît après 15 s sur l'interface.
  setTimeout(() => {
    document.querySelector(".ui__quip")?.classList.add("ui__quip--show");
  }, 15000);
};
orb.onModeChange = (label) => {
  ui.setMode(label);
  ui.setModeControl(label);
};

orb.load();

// --- Post-processing : bloom + grain/vignette ------------------------------
const composer = new EffectComposer(stage.renderer);
composer.setPixelRatio(stage.dpr);
composer.addPass(new RenderPass(stage.scene, stage.camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.75, 0.5, 0.1
);
composer.addPass(bloom);
const grain = new ShaderPass(CinematicShader);
grain.uniforms.uResolution.value = [window.innerWidth, window.innerHeight];
composer.addPass(grain);

stage.onResize((w, h) => {
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  grain.uniforms.uResolution.value = [w, h];
  if (orb.ready && !dive.active) frameOrb();
});
// Un panneau plein écran (projets/about) est opaque devant la scène → inutile de
// rendre la sphère dessous (et ça évite tout flash qui transparaîtrait au scroll).
const overlayOpen = () => projects.open || about.open || contact.open;
stage.setRender(() => {
  if (overlayOpen()) return;
  composer.render();
});

// --- Souris ----------------------------------------------------------------
const pointer = new THREE.Vector2(0, 0);
window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

// --- Drag : faire tourner le disque dans son plan (rotation z) --------------
const sceneEl = document.getElementById("scene");
let dragging = false;
let dragStartX = 0;
let userSpin = 0;      // rotation manuelle cumulée (plan du disque)
let spinAtGrab = 0;
const DRAG_SENS = 0.006; // radians par pixel

sceneEl.style.cursor = "grab";
sceneEl.addEventListener("pointerdown", (e) => {
  if (dive.active) return;
  dragging = true;
  dragStartX = e.clientX;
  spinAtGrab = userSpin;
  sceneEl.style.cursor = "grabbing";
});
window.addEventListener("pointerup", () => {
  dragging = false;
  sceneEl.style.cursor = "grab";
});
window.addEventListener("pointermove", (e) => {
  if (dragging) userSpin = spinAtGrab + (e.clientX - dragStartX) * DRAG_SENS;
});

// --- Contrôles (construits une fois le DOM prêt) ----------------------------
ui.buildControls({
  onDensity: (v) => {
    density = v;
    orb.setDetail(v);
    if (orb.ready) ui.setParticles(orb.particleCount);
  },
  onGlow: (v) => {
    bloom.strength = v;
    orb.uniforms.uGlow.value = v;
    lighting.setIntensity(0.4 + v);
  },
  onModeCycle: () => orb.cycleMode(),
});

// --- Boucle ----------------------------------------------------------------
function onPreloaderDone() {
  // rien de spécial : la scène tourne déjà derrière le preloader.
}

stage.start((t, dt) => {
  if (overlayOpen()) return;

  if (dive.active) {
    dive.update(t, dt, pointer);
    orb.update(t, dt);
  } else {
    const mouseWorld = lighting.update(pointer, dt);
    orb.setMouseWorld(mouseWorld);
    orb.update(t, dt);

    // Rotation lente DANS le plan du disque (pas de bascule 3D) + parallaxe
    // discrète vers le curseur.
    if (!dragging) spin += dt * 0.02;
    orb.group.rotation.z = spin + userSpin;
    orb.group.rotation.y = dragging ? 0 : lighting.tiltY * 0.35;
    orb.group.rotation.x = -0.06 + (dragging ? 0 : lighting.tiltX * 0.35);
  }

  grain.uniforms.uTime.value = t;
  ui.tickFps(dt);
});
