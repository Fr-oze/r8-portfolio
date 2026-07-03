import "./style.css";
import * as THREE from "three";
import { Stage } from "./core/Stage";
import { Preloader } from "./components/Preloader";
import { CarScene } from "./components/CarScene";
import { Lighting } from "./components/Lighting";
import { UI } from "./components/UI";
import { Projects } from "./components/Projects";
import { About } from "./components/About";
import { Contact } from "./components/Contact";
import { DriveMode } from "./components/DriveMode";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CinematicShader } from "./shaders/cinematic";

// Détection tactile : active les contrôles de conduite tactiles + ajustements UI.
const isTouch =
  window.matchMedia?.("(pointer: coarse)").matches ||
  "ontouchstart" in window ||
  navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");

// --- Setup scène + composants ----------------------------------------------
const stage = new Stage(document.getElementById("scene"));

// LoadingManager : synchronise le compteur du preloader au VRAI chargement.
const manager = new THREE.LoadingManager();
const preloader = new Preloader(() => onPreloaderDone());
manager.onProgress = (url, loaded, total) => preloader.setProgress(loaded / total);
// Sécurité : si peu de requêtes, on pousse la progression à la fin du load.
manager.onLoad = () => preloader.setProgress(1);

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

const car = new CarScene(stage, manager);
const lighting = new Lighting(stage, car.group);
const drive = new DriveMode(stage, car);

document.getElementById("drive-start")?.addEventListener("click", () => drive.enter());
document.getElementById("drive-exit")?.addEventListener("click", () => drive.exit());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drive.active) drive.exit();
});

let rotationSpeed = 0.1;
let spin = 0; // angle d'auto-rotation continu
let density = 0.35; // valeur courante du slider de densité

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// Cadrage responsive : échelle + position de la voiture ET recul de la caméra
// calculé d'après le ratio écran. En portrait (mobile), le FOV horizontal se
// resserre → on recule la caméra pour que la voiture (large) reste entière.
function frameCar() {
  const w = window.innerWidth, h = window.innerHeight;
  const desktop = w > 720;
  const scale = desktop ? 1.5 : 1.15;
  car.group.scale.setScalar(scale);
  car.group.position.y = desktop ? 0.5 : 0.35;
  // pivot de rotation = origine du groupe → on le laisse au centre écran (x=0),
  // sinon la voiture orbite autour d'un point décalé. Le recentrage horizontal
  // se fait à la source, sur l'ancrage de la géométrie (voir CarScene._build).
  car.group.position.x = 0;

  const long = car.size ? Math.max(car.size.x, car.size.z) : 4.2;
  const fitW = long * scale * (desktop ? 1.3 : 1.55); // largeur à cadrer + marge
  const aspect = w / h;
  const vFov = (stage.camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const dist = fitW / 2 / Math.tan(hFov / 2);
  stage.camera.position.z = clampN(dist + 1.2, 6, 26);
  stage.camera.updateProjectionMatrix();
}

car.onReady = () => {
  car.setDetail(density);
  ui.setParticles(car.particleCount);
  frameCar();
};
car.onScanComplete = () => {
  ui.reveal(); // UI en cascade
  // La phrase signature apparaît après 15 s sur l'interface.
  setTimeout(() => {
    document.querySelector(".ui__quip")?.classList.add("ui__quip--show");
  }, 15000);
};
car.onModeChange = (label) => ui.setMode(label);

car.load();

// --- Post-processing : bloom + grain/vignette ------------------------------
const composer = new EffectComposer(stage.renderer);
composer.setPixelRatio(stage.dpr);
composer.addPass(new RenderPass(stage.scene, stage.camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.3, 0.5, 0.1
);
composer.addPass(bloom);
const grain = new ShaderPass(CinematicShader);
grain.uniforms.uResolution.value = [window.innerWidth, window.innerHeight];
composer.addPass(grain);

stage.onResize((w, h) => {
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  grain.uniforms.uResolution.value = [w, h];
  if (car.ready && !drive.active) frameCar();
});
// Un panneau plein écran (projets/about) est opaque devant la scène → inutile de
// rendre la R8 dessous (et ça évite tout flash qui transparaîtrait au scroll).
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

// --- Drag : attraper la R8 pour la faire pivoter gauche/droite (yaw seul) ---
const sceneEl = document.getElementById("scene");
let dragging = false;
let dragStartX = 0;
let userYaw = 0;       // rotation manuelle cumulée
let yawAtGrab = 0;
const DRAG_SENS = 0.006; // radians par pixel

sceneEl.style.cursor = "grab";
sceneEl.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragStartX = e.clientX;
  yawAtGrab = userYaw;
  sceneEl.style.cursor = "grabbing";
});
window.addEventListener("pointerup", () => {
  dragging = false;
  sceneEl.style.cursor = "grab";
});
window.addEventListener("pointermove", (e) => {
  if (dragging) userYaw = yawAtGrab + (e.clientX - dragStartX) * DRAG_SENS;
});

// --- Sliders (construits une fois le DOM prêt) -----------------------------
ui.buildControls({
  onDensity: (v) => {
    density = v;
    car.setDetail(v);
    if (car.ready) ui.setParticles(car.particleCount);
  },
  onGlow: (v) => {
    bloom.strength = v;
    car.uniforms.uGlow.value = v;
    lighting.setIntensity(0.4 + v);
  },
  onRotation: (v) => (rotationSpeed = v),
});

// --- Boucle ----------------------------------------------------------------
function onPreloaderDone() {
  // rien de spécial : la scène tourne déjà derrière le preloader.
}

stage.start((t, dt) => {
  // Scène figée tant qu'un panneau opaque est ouvert (rien à animer derrière).
  if (overlayOpen()) return;
  if (drive.active) {
    // Mode conduite : DriveMode pilote position/rotation de la voiture + caméra.
    drive.update(t, dt);
    car.update(t, dt);
  } else {
    const mouseWorld = lighting.update(pointer, dt);
    car.setMouseWorld(mouseWorld);
    car.update(t, dt);

    // Pendant le drag : pas d'auto-rotation, on ne suit que le geste (yaw).
    // Sinon : auto-rotation continue + léger tilt vertical vers le curseur.
    if (!dragging) spin += rotationSpeed * dt * 0.4;
    car.group.rotation.y = spin + userYaw + (dragging ? 0 : lighting.tiltY);
    car.group.rotation.x = dragging ? car.group.rotation.x * 0.9 : lighting.tiltX;
  }

  grain.uniforms.uTime.value = t;
  ui.tickFps(dt);
});
