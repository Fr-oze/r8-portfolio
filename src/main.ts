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
import { bindLeakCalc } from "./components/LeakCalc";
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

// Mobile ≤720px : header classique + SVG fixe, pas de WebGL / pas de curseur.
const MOBILE_MQ = window.matchMedia("(max-width: 720px)");
const isMobileLayout = () => MOBILE_MQ.matches;
if (isMobileLayout()) document.body.classList.add("mobile-layout");

const ui = new UI();

// Panneau projets (liste + scroll infini), ouvert depuis le bouton haut-gauche
// et le lien PROJECTS du nav.
const projects = new Projects();
const DEMO_URL = "/demo/?src=site";
const goDemo = (src?: string) => {
  window.location.href = src ? `/demo/?src=${encodeURIComponent(src)}` : DEMO_URL;
};

document.getElementById("open-projects")?.addEventListener("click", () => projects.toggle());
document.getElementById("open-projects-cta")?.addEventListener("click", () => goDemo("hero"));
document.getElementById("quip-projects")?.addEventListener("click", () => goDemo("quip"));
// Panneau About : portrait 3D data/wireframe + présentation.
const about = new About();
document.getElementById("about-projects")?.addEventListener("click", () => {
  about.hide();
  projects.show();
});
// Panneau Contact : canal de transmission (email + téléphone).
const contact = new Contact();

// Liens de nav câblés par id (plus robuste qu'un matching sur le texte).
const navLink = (id: string, fn: () => void) =>
  document.getElementById(id)?.addEventListener("click", (e) => {
    e.preventDefault();
    fn();
  });
navLink("nav-projects", () => projects.show());
navLink("nav-about", () => about.show());
navLink("nav-contact", () => contact.show());
// nav-demo = lien réel /demo (pas de preventDefault)

// --- Sections de scroll (sous le hero — sans toucher à la scène 3D) ----------
const heroSpacer = document.querySelector(".hero-spacer");
const scrollSections = document.querySelectorAll(".scroll-section");

const syncPastHero = () => {
  const spacerH = heroSpacer?.clientHeight ?? window.innerHeight;
  // Dès qu'on entre dans le contenu commercial, on coupe le debug 3D.
  const threshold = spacerH * 0.35;
  document.body.classList.toggle("past-hero", window.scrollY > threshold);
};
window.addEventListener("scroll", syncPastHero, { passive: true });
window.addEventListener("resize", syncPastHero, { passive: true });
syncPastHero();

const pageScroll = document.querySelector(".page-scroll");
if (pageScroll && "IntersectionObserver" in window) {
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && entry.boundingClientRect.top < window.innerHeight * 0.75) {
        document.body.classList.add("past-hero");
      }
    },
    { threshold: [0, 0.05, 0.15] }
  ).observe(pageScroll);
}

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

bindLeakCalc(document.getElementById("leak-calc"));

document.getElementById("scroll-cases-cta")?.addEventListener("click", () => projects.show());

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

// ---------------------------------------------------------------------------
// MOBILE : pas de WebGL. Header classique + SVG fixe.
// ---------------------------------------------------------------------------
if (isMobileLayout()) {
  const pre = document.getElementById("preloader");
  pre?.classList.add("preloader--done");
  pre?.setAttribute("aria-hidden", "true");
  // UI tout de suite (pas d'attente scan 3D)
  requestAnimationFrame(() => {
    ui.reveal();
    setTimeout(() => {
      document.querySelector(".ui__quip")?.classList.add("ui__quip--show");
    }, 2200);
  });
} else {
  // -------------------------------------------------------------------------
  // DESKTOP : scène 3D + orbe réactif au curseur (inchangé)
  // -------------------------------------------------------------------------
  const stage = new Stage(document.getElementById("scene"));

  const preloader = new Preloader(() => {
    /* scène déjà en route derrière le preloader */
  });
  {
    const t0 = performance.now();
    const ramp = () => {
      const p = Math.min(1, (performance.now() - t0) / 1400);
      preloader.setProgress(p);
      if (p < 1) requestAnimationFrame(ramp);
    };
    requestAnimationFrame(ramp);
  }

  const orb = new OrbScene(stage);
  const lighting = new Lighting(stage, orb.group);
  const dive = new OrbFlightMode(stage, orb);

  document.getElementById("dive-start")?.addEventListener("click", () => dive.enter());
  document.getElementById("dive-exit")?.addEventListener("click", () => dive.exit());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dive.active) dive.exit();
  });

  let spin = 0;
  let density = 0.35;
  let userSpin = 0;
  let userTiltX = 0;
  let userTiltY = 0;

  dive.onExited = (finalSpin) => {
    spin = finalSpin - userSpin;
  };

  const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  function frameOrb() {
    const w = window.innerWidth,
      h = window.innerHeight;
    const desktop = w > 720;
    orb.group.position.set(0, desktop ? 0.15 : 0.1, 0);

    const fitD = orb.radius * 2 * (desktop ? 1.5 : 1.7);
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
    ui.reveal();
    setTimeout(() => {
      document.querySelector(".ui__quip")?.classList.add("ui__quip--show");
    }, 15000);
  };
  orb.onModeChange = (label) => {
    ui.setMode(label);
    ui.setModeControl(label);
  };

  orb.load();

  const composer = new EffectComposer(stage.renderer);
  composer.setPixelRatio(stage.dpr);
  composer.addPass(new RenderPass(stage.scene, stage.camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.75,
    0.5,
    1.0
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

  const overlayOpen = () => projects.open || about.open || contact.open;
  stage.setRender(() => {
    if (overlayOpen()) return;
    composer.render();
  });

  const pointer = new THREE.Vector2(0, 0);
  let dragging = false;

  window.addEventListener(
    "pointermove",
    (e) => {
      if (dragging) return;
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    },
    { passive: true }
  );

  const sceneEl = document.getElementById("scene")!;
  let dragStartX = 0;
  let dragStartY = 0;
  let spinAtGrab = 0;
  let tiltXAtGrab = 0;
  let tiltYAtGrab = 0;
  const DRAG_SENS = 0.006;
  const TILT_SENS = 0.004;

  sceneEl.style.cursor = "grab";
  sceneEl.style.touchAction = "none";

  sceneEl.addEventListener("pointerdown", (e) => {
    if (dive.active) return;
    if (document.body.classList.contains("past-hero")) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    spinAtGrab = userSpin;
    tiltXAtGrab = userTiltX;
    tiltYAtGrab = userTiltY;
    sceneEl.style.cursor = "grabbing";
    try {
      sceneEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    sceneEl.style.cursor = "grab";
    try {
      sceneEl.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!dragging) return;
      userSpin = spinAtGrab + (e.clientX - dragStartX) * DRAG_SENS;
      userTiltY = tiltYAtGrab + (e.clientX - dragStartX) * TILT_SENS;
      userTiltX = tiltXAtGrab + (e.clientY - dragStartY) * TILT_SENS;
      userTiltX = Math.max(-0.35, Math.min(0.35, userTiltX));
      userTiltY = Math.max(-0.45, Math.min(0.45, userTiltY));
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    },
    { passive: true }
  );

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

  stage.start((t, dt) => {
    if (overlayOpen()) return;

    if (dive.active) {
      dive.update(t, dt, pointer);
      orb.update(t, dt);
    } else {
      const mouseWorld = lighting.update(pointer, dt);
      orb.setMouseWorld(mouseWorld);
      orb.update(t, dt);

      if (!dragging) spin += dt * 0.02;
      orb.group.rotation.z = spin + userSpin;
      orb.group.rotation.y = dragging ? 0 : lighting.tiltY * 0.35;
      orb.group.rotation.x = -0.06 + (dragging ? 0 : lighting.tiltX * 0.35);
    }

    grain.uniforms.uTime.value = t;
    ui.tickFps(dt);
  });
}
