import * as THREE from "three";
import type { Stage } from "../core/Stage";
import { OrbScene } from "./OrbScene";

// =====================================================================
// ORB FLIGHT — mode vaisseau : l'orbe bascule à l'horizontale, des
// montagnes se lèvent sur le disque, et un petit vaisseau doit les
// esquiver le plus longtemps possible. Le disque tourne sous le
// vaisseau (le terrain défile), la souris pilote : X = latéral,
// Y = altitude. Crash = fin de run, clic pour rejouer.
// =====================================================================

const ENTER_DURATION = 1.9; // s — bascule de l'orbe + descente caméra
const EXIT_DURATION = 1.3;
const LANE_MIN = 0.55; // rayon min/max où le vaisseau peut voler
const LANE_MAX = 1.9;
const ALT_MIN = 0.16; // altitude locale (au-dessus du plan du disque)
const ALT_MAX = 0.95;
const BEST_KEY = "orb-flight-best";

type FlightState = "off" | "entering" | "playing" | "crashed" | "exiting";

const ease = (k: number) => k * k * (3 - 2 * k); // smoothstep
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class OrbFlightMode {
  stage: Stage;
  orb: OrbScene;
  active = false;
  // main.ts resynchronise sa variable de rotation quand on ressort du mode.
  onExited: ((finalSpin: number) => void) | null = null;

  private state: FlightState = "off";
  private k = 0; // avancement de la transition (0 = hero, 1 = vol)
  private peaks: THREE.Vector4[] = [];

  private ship: THREE.Group;
  private shipPos = new THREE.Vector3(1.35, 0.6, 0);
  private shipVel = new THREE.Vector2(0, 0); // vitesses instantanées (x, alt)
  private bank = 0; // roulis lissé
  private pitch = 0; // tangage lissé

  private spinPos = 0; // rotation du disque (le "défilement" du terrain)
  private speed = 0; // vitesse angulaire courante
  private dist = 0;
  private best = 0;
  private grace = 0; // s sans collision au départ (le temps de s'orienter)

  private savedCam = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    fov: 42,
  };
  private savedRot = new THREE.Euler();
  private targetCamPos = new THREE.Vector3();
  private targetCamQuat = new THREE.Quaternion();
  private _v = new THREE.Vector3();
  private _dummy = new THREE.PerspectiveCamera();

  private hud: HTMLElement | null;
  private distEl: HTMLElement | null;
  private bestEl: HTMLElement | null;
  private speedEl: HTMLElement | null;
  private introEl: HTMLElement | null;
  private overEl: HTMLElement | null;
  private overDistEl: HTMLElement | null;
  private overBestEl: HTMLElement | null;
  private flashEl: HTMLElement | null;

  constructor(stage: Stage, orb: OrbScene) {
    this.stage = stage;
    this.orb = orb;
    this.best = Number(localStorage.getItem(BEST_KEY) || 0);

    this.ship = this._buildShip();
    this.ship.visible = false;
    stage.add(this.ship);

    this.hud = document.getElementById("dive-hud");
    this.distEl = document.getElementById("dive-dist");
    this.bestEl = document.getElementById("dive-best");
    this.speedEl = document.getElementById("dive-speed");
    this.introEl = document.getElementById("dive-intro");
    this.overEl = document.getElementById("dive-over");
    this.overDistEl = document.getElementById("dive-over-dist");
    this.overBestEl = document.getElementById("dive-over-best");
    this.flashEl = document.getElementById("dive-flash");

    // Rejouer après un crash : clic n'importe où (sauf boutons du HUD).
    window.addEventListener("pointerdown", (e) => {
      if (this.state !== "crashed") return;
      if ((e.target as HTMLElement).closest("button")) return;
      this._restart();
    });
  }

  // Petit vaisseau wireframe : dard + ailes, tout en lignes additives.
  private _buildShip() {
    const g = new THREE.Group();
    const nose: [number, number, number] = [0, 0.02, -0.24];
    const tail: [number, number, number] = [0, 0.07, 0.14];
    const wingL: [number, number, number] = [-0.19, 0, 0.13];
    const wingR: [number, number, number] = [0.19, 0, 0.13];
    const belly: [number, number, number] = [0, -0.035, 0.1];
    const segs = [
      nose, wingL, nose, wingR, nose, tail, nose, belly,
      wingL, tail, wingR, tail, wingL, belly, wingR, belly,
      wingL, wingR,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(segs.flat(), 3));
    g.add(
      new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    );
    // lueur moteur
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.02, 0.16], 3));
    g.add(
      new THREE.Points(
        glowGeo,
        new THREE.PointsMaterial({
          color: 0xffffff,
          size: 4,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    );
    return g;
  }

  // Hauteur du terrain aux coordonnées locales du disque — miroir exact de
  // terrainH() dans le shader d'OrbScene.
  private _terrainAt(lx: number, ly: number) {
    let h = 0;
    for (const p of this.peaks) {
      const dx = lx - p.x;
      const dy = ly - p.y;
      h += p.z * Math.exp(-(dx * dx + dy * dy) / (p.w * p.w + 0.0001));
    }
    return Math.min(h, 1.15) * this.orb.uniforms.uTerrain.value;
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.state = "entering";
    this.k = 0;

    this.savedCam.pos.copy(this.stage.camera.position);
    this.savedCam.quat.copy(this.stage.camera.quaternion);
    this.savedCam.fov = this.stage.camera.fov;
    this.savedRot.copy(this.orb.group.rotation);
    this.spinPos = this.orb.group.rotation.z;

    this.peaks = this.orb.regeneratePeaks();
    this.orb.freezeForFlight();
    // neutralise la répulsion souris (elle déformerait le terrain)
    this.orb.uniforms.uMouse.value.set(999, 999, 999);

    this.speed = 0.35;
    this.dist = 0;
    this.grace = 1.8;
    // spawn en altitude : le temps que le joueur prenne les commandes
    this.shipPos.set(1.35, this.orb.group.position.y + 0.85, 0);
    this.shipVel.set(0, 0);

    document.body.classList.add("diving");
    this.hud?.classList.remove("dive-hud--hidden");
    this.overEl?.classList.remove("dive-over--show");
    this._updateHud();

    this.introEl?.classList.add("dive-hud__intro--show");
    setTimeout(() => this.introEl?.classList.remove("dive-hud__intro--show"), 5000);
  }

  exit() {
    if (!this.active || this.state === "exiting") return;
    this.state = "exiting";
    this.overEl?.classList.remove("dive-over--show");
    document.body.classList.remove("diving");
    this.hud?.classList.add("dive-hud--hidden");
  }

  private _restart() {
    this.peaks = this.orb.regeneratePeaks();
    this.speed = 0.35;
    this.dist = 0;
    this.grace = 1.8;
    this.shipVel.set(0, 0);
    this.overEl?.classList.remove("dive-over--show");
    this.state = "playing";
  }

  private _crash() {
    this.state = "crashed";
    this.introEl?.classList.remove("dive-hud__intro--show");
    if (this.dist > this.best) {
      this.best = Math.round(this.dist);
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    if (this.overDistEl) this.overDistEl.textContent = String(Math.round(this.dist));
    if (this.overBestEl) this.overBestEl.textContent = String(this.best);
    this.overEl?.classList.add("dive-over--show");
    // flash blanc bref
    if (this.flashEl) {
      this.flashEl.classList.remove("dive-flash--go");
      void this.flashEl.offsetWidth; // relance l'animation CSS
      this.flashEl.classList.add("dive-flash--go");
    }
    this._updateHud();
  }

  private _updateHud() {
    if (this.distEl) this.distEl.textContent = String(Math.round(this.dist));
    if (this.bestEl) this.bestEl.textContent = String(this.best);
    if (this.speedEl) this.speedEl.textContent = String(Math.round(this.speed * 100));
  }

  // Caméra de jeu : basse, juste derrière le vaisseau, regard vers le terrain
  // qui arrive. Recalculée chaque frame (le vaisseau bouge).
  private _computeGameCam() {
    this.targetCamPos.set(
      this.shipPos.x,
      this.shipPos.y + 0.5,
      this.shipPos.z + 2.1
    );
    const d = this._dummy;
    d.position.copy(this.targetCamPos);
    // la caméra penche légèrement avec le vaisseau
    d.up.set(Math.sin(this.bank * 0.45), Math.cos(this.bank * 0.45), 0);
    // regard biaisé vers le centre du disque : on voit le terrain qui
    // arrive plutôt que le vide au-delà du bord.
    d.lookAt(this.shipPos.x * 0.55, this.shipPos.y + 0.02, this.shipPos.z - 4);
    this.targetCamQuat.copy(d.quaternion);
  }

  update(t: number, dt: number, pointer: THREE.Vector2) {
    if (!this.active) return;
    const cam = this.stage.camera;
    const group = this.orb.group;

    // --- transitions entrée / sortie ---------------------------------------
    if (this.state === "entering" || this.state === "exiting") {
      const dir = this.state === "entering" ? 1 : -1;
      const dur = this.state === "entering" ? ENTER_DURATION : EXIT_DURATION;
      this.k = Math.max(0, Math.min(1, this.k + (dir * dt) / dur));
      const e = ease(this.k);

      // bascule du disque : de la pose hero à l'horizontale
      group.rotation.x = this.savedRot.x + (-Math.PI / 2 - this.savedRot.x) * e;
      group.rotation.y = this.savedRot.y * (1 - e);
      group.rotation.z = this.spinPos;
      this.orb.setTerrain(e);

      this._computeGameCam();
      cam.position.lerpVectors(this.savedCam.pos, this.targetCamPos, e);
      cam.quaternion.slerpQuaternions(this.savedCam.quat, this.targetCamQuat, e);
      cam.fov = this.savedCam.fov + (52 - this.savedCam.fov) * e;
      cam.updateProjectionMatrix();

      this.ship.visible = this.k > 0.4;
      this.ship.position.copy(this.shipPos);

      if (this.state === "entering" && this.k >= 1) this.state = "playing";
      if (this.state === "exiting" && this.k <= 0) {
        this.state = "off";
        this.active = false;
        // x/y reviennent à la pose hero ; z garde la rotation accumulée
        // pendant le vol (main.ts resynchronise son spin via onExited).
        group.rotation.set(this.savedRot.x, this.savedRot.y, this.spinPos);
        cam.position.copy(this.savedCam.pos);
        cam.quaternion.copy(this.savedCam.quat);
        cam.fov = this.savedCam.fov;
        cam.up.set(0, 1, 0);
        cam.updateProjectionMatrix();
        this.orb.setTerrain(0);
        this.orb.resumeAfterFlight();
        this.onExited?.(this.spinPos);
      }
      return;
    }

    // --- pilotage ------------------------------------------------------------
    if (this.state === "playing") {
      // le disque tourne sous le vaisseau : le terrain défile vers lui
      this.speed = Math.min(1.25, this.speed + dt * 0.014);
      this.spinPos -= this.speed * dt;
      group.rotation.z = this.spinPos;

      // distance parcourue = vitesse tangentielle au rayon du vaisseau
      this.dist += this.speed * this.shipPos.x * dt * 14;

      // souris : X = couloir latéral (rayon), Y = altitude
      const targetX =
        (LANE_MIN + LANE_MAX) / 2 + pointer.x * (LANE_MAX - LANE_MIN) * 0.5;
      const targetAlt = ALT_MIN + (pointer.y * 0.5 + 0.5) * (ALT_MAX - ALT_MIN);
      const baseY = group.position.y;
      const curAlt = this.shipPos.y - baseY;
      const nx = this.shipPos.x + (targetX - this.shipPos.x) * Math.min(1, dt * 4.5);
      const nAlt = curAlt + (targetAlt - curAlt) * Math.min(1, dt * 4);
      this.shipVel.set((nx - this.shipPos.x) / Math.max(dt, 1e-4), (nAlt - curAlt) / Math.max(dt, 1e-4));
      this.shipPos.x = Math.max(LANE_MIN, Math.min(LANE_MAX, nx));
      this.shipPos.y = baseY + nAlt;
      this.shipPos.z = 0;

      // collision : hauteur du terrain sous le vaisseau (coordonnées locales)
      this.grace = Math.max(0, this.grace - dt);
      this._v.copy(this.shipPos);
      group.worldToLocal(this._v);
      const h = this._terrainAt(this._v.x, this._v.y);
      if (this.grace <= 0 && this._v.z < h - 0.06) {
        this._crash();
      }

      this._updateHud();
    }

    // --- rendu vaisseau + caméra (playing et crashed) ------------------------
    const k = Math.min(1, dt * 6);
    this.bank += (clampN(-this.shipVel.x * 0.55, -0.7, 0.7) - this.bank) * k;
    this.pitch += (clampN(-this.shipVel.y * 0.35, -0.5, 0.5) - this.pitch) * k;
    this.ship.position.copy(this.shipPos);
    this.ship.rotation.set(this.pitch, 0, this.bank);
    // micro-tremblement qui monte avec la vitesse
    const shake = this.state === "playing" ? this.speed * 0.008 : 0;
    this._computeGameCam();
    cam.position.copy(this.targetCamPos);
    cam.position.x += Math.sin(t * 31) * shake;
    cam.position.y += Math.cos(t * 27) * shake;
    cam.quaternion.copy(this.targetCamQuat);
    cam.fov += (52 + this.speed * 8 - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }
}
