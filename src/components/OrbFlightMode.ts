import * as THREE from "three";
import type { Stage } from "../core/Stage";
import { OrbScene } from "./OrbScene";

// =====================================================================
// ORB FLIGHT — mode vaisseau : l'orbe bascule à l'horizontale (ses
// montagnes se lèvent) puis se fond dans un TERRAIN INFINI généré
// procéduralement. On avance TOUT DROIT : le monde défile vers la
// caméra et les montagnes se génèrent au fur et à mesure.
// Les pics sont une liste unique (uniform) partagée entre le shader
// (visuel) et le JS (collision) → la hitbox est exactement le visuel.
// Pilote automatique engagé à l'entrée ; FLÈCHES pour prendre la main
// (←/→ = latéral, ↑/↓ = altitude), A ré-engage l'auto.
// =====================================================================

const ENTER_DURATION = 2.1; // s — bascule de l'orbe + fondu vers le terrain
const EXIT_DURATION = 1.4;
const LANE_X = 1.9; // demi-largeur du couloir de vol
const ALT_MIN = 0.16;
const ALT_MAX = 1.0;
const BEST_KEY = "orb-flight-best";

// terrain infini
const T_LEN = 60; // profondeur visible (unités monde)
const T_HALF_W = 7; // demi-largeur du maillage
const FPEAK_N = 26; // pics simultanés (fenêtre glissante)
const CROSS_LINES = 72;
const CROSS_SEGS = 110;
const LON_LINES = 34;
const LON_SEGS = 100;
const DUST_N = 2600;

type FlightState = "off" | "entering" | "playing" | "crashed" | "exiting";

const ease = (k: number) => k * k * (3 - 2 * k); // smoothstep
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sstep = (a: number, b: number, x: number) => {
  const k = clampN((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

interface FPeak {
  x: number; // position latérale (monde)
  Z: number; // coordonnée terrain (z monde - scroll) : fixe pour un pic
  h: number;
  w: number;
}

// Le shader échantillonne la hauteur en q = (x, z - uScroll) : quand uScroll
// augmente, chaque pic avance vers la caméra. Même somme de gaussiennes des
// deux côtés (GLSL et JS), mêmes données -> hitbox = visuel.
const TERRAIN_GLSL = /* glsl */ `
  #define FPEAK_N ${FPEAK_N}
  uniform float uScroll;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec4  uPeaks[FPEAK_N];
  varying float vH;
  varying float vZ;
  float terrainH(vec2 q) {
    float h = 0.0;
    for (int i = 0; i < FPEAK_N; i++) {
      vec2 d = q - uPeaks[i].xy;
      float w = uPeaks[i].w;
      h += uPeaks[i].z * exp(-dot(d, d) / (w * w + 0.0001));
    }
    return min(h, 1.2);
  }
`;

export class OrbFlightMode {
  stage: Stage;
  orb: OrbScene;
  active = false;
  // main.ts resynchronise sa variable de rotation quand on ressort du mode.
  onExited: ((finalSpin: number) => void) | null = null;

  private state: FlightState = "off";
  private k = 0; // avancement de la transition (0 = hero, 1 = vol)

  private terrain: THREE.Group;
  private tUniforms = {
    uScroll: { value: 0 },
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uDpr: { value: 1 },
    uPeaks: {
      value: Array.from({ length: FPEAK_N }, () => new THREE.Vector4(0, -999, 0, 1)),
    },
  };
  private fpeaks: FPeak[] = [];
  private scroll = 0;

  private ship: THREE.Group;
  private shipPos = new THREE.Vector3(0, 0.85, 0);
  private shipVel = new THREE.Vector2(0, 0); // vitesses instantanées (x, alt)
  private bank = 0; // roulis lissé
  private pitch = 0; // tangage lissé

  private speed = 0; // unités monde / s
  private dist = 0;
  private best = 0;
  private grace = 0; // s sans collision au départ (le temps de s'orienter)

  private auto = true; // pilote automatique (démo) — flèches = reprise en main
  private keys = { left: false, right: false, up: false, down: false };
  private ctrlX = 0; // consignes courantes (latéral, altitude)
  private ctrlAlt = 0.7;

  private savedCam = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    fov: 42,
  };
  private savedRot = new THREE.Euler();
  private spinPos = 0;
  private targetCamPos = new THREE.Vector3();
  private targetCamQuat = new THREE.Quaternion();
  private _dummy = new THREE.PerspectiveCamera();

  private hud: HTMLElement | null;
  private distEl: HTMLElement | null;
  private bestEl: HTMLElement | null;
  private speedEl: HTMLElement | null;
  private modeEl: HTMLElement | null;
  private introEl: HTMLElement | null;
  private overEl: HTMLElement | null;
  private overDistEl: HTMLElement | null;
  private overBestEl: HTMLElement | null;
  private flashEl: HTMLElement | null;

  constructor(stage: Stage, orb: OrbScene) {
    this.stage = stage;
    this.orb = orb;
    this.best = Number(localStorage.getItem(BEST_KEY) || 0);
    this.tUniforms.uDpr.value = stage.dpr;

    this.terrain = new THREE.Group();
    this.terrain.visible = false;
    stage.add(this.terrain);
    this._buildTerrain();

    this.ship = this._buildShip();
    this.ship.visible = false;
    stage.add(this.ship);

    this.hud = document.getElementById("dive-hud");
    this.distEl = document.getElementById("dive-dist");
    this.bestEl = document.getElementById("dive-best");
    this.speedEl = document.getElementById("dive-speed");
    this.modeEl = document.getElementById("dive-mode");
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

    // Clavier : flèches = piloter (et couper l'autopilote), A = ré-engager.
    const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (ARROWS.includes(e.key)) {
        e.preventDefault();
        if (this.state === "crashed") this._restart();
        if (this.auto) this._setAuto(false);
        if (e.key === "ArrowLeft") this.keys.left = true;
        if (e.key === "ArrowRight") this.keys.right = true;
        if (e.key === "ArrowUp") this.keys.up = true;
        if (e.key === "ArrowDown") this.keys.down = true;
      } else if (e.key === "a" || e.key === "A") {
        this._setAuto(true);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "ArrowLeft") this.keys.left = false;
      if (e.key === "ArrowRight") this.keys.right = false;
      if (e.key === "ArrowUp") this.keys.up = false;
      if (e.key === "ArrowDown") this.keys.down = false;
    });
  }

  private _setAuto(v: boolean) {
    this.auto = v;
    if (v) this.keys = { left: false, right: false, up: false, down: false };
    if (this.modeEl) this.modeEl.textContent = v ? "AUTO" : "MANUEL";
    this.hud?.classList.toggle("dive-hud--auto", v);
  }

  // --- TERRAIN INFINI --------------------------------------------------------

  private _buildTerrain() {
    // lignes transversales (le relief se lit dessus)
    {
      const verts = CROSS_LINES * CROSS_SEGS * 2;
      const pos = new Float32Array(verts * 3);
      let w = 0;
      for (let i = 0; i < CROSS_LINES; i++) {
        const z = 4 - (i / (CROSS_LINES - 1)) * (T_LEN - 1);
        for (let s = 0; s < CROSS_SEGS; s++) {
          for (let e = 0; e < 2; e++) {
            const x = -T_HALF_W + (((s + e) / CROSS_SEGS) * 2 * T_HALF_W);
            pos[w * 3] = x;
            pos[w * 3 + 1] = 0;
            pos[w * 3 + 2] = z;
            w++;
          }
        }
      }
      this.terrain.add(new THREE.LineSegments(this._tGeo(pos), this._tLineMat()));
    }
    // lignes longitudinales (sensation d'avancer tout droit)
    {
      const verts = LON_LINES * LON_SEGS * 2;
      const pos = new Float32Array(verts * 3);
      let w = 0;
      for (let i = 0; i < LON_LINES; i++) {
        const x = -T_HALF_W + (i / (LON_LINES - 1)) * 2 * T_HALF_W;
        for (let s = 0; s < LON_SEGS; s++) {
          for (let e = 0; e < 2; e++) {
            const z = 4 - (((s + e) / LON_SEGS) * (T_LEN - 1));
            pos[w * 3] = x;
            pos[w * 3 + 1] = 0;
            pos[w * 3 + 2] = z;
            w++;
          }
        }
      }
      this.terrain.add(new THREE.LineSegments(this._tGeo(pos), this._tLineMat()));
    }
    // poussière posée sur le relief
    {
      const pos = new Float32Array(DUST_N * 3);
      for (let i = 0; i < DUST_N; i++) {
        pos[i * 3] = (Math.random() * 2 - 1) * T_HALF_W;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = 4 - Math.random() * (T_LEN - 1);
      }
      this.terrain.add(new THREE.Points(this._tGeo(pos), this._tPointMat()));
    }
  }

  private _tGeo(pos: Float32Array) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -T_LEN / 2), T_LEN);
    return geo;
  }

  private _tLineMat() {
    return new THREE.ShaderMaterial({
      uniforms: this.tUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${TERRAIN_GLSL}
        void main() {
          vec2 q = vec2(position.x, position.z - uScroll);
          float h = terrainH(q);
          vH = h;
          vZ = position.z;
          gl_Position = projectionMatrix * viewMatrix *
            vec4(position.x, h, position.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${TERRAIN_GLSL}
        void main() {
          float fadeFar = smoothstep(${(-T_LEN + 6).toFixed(1)}, ${(-T_LEN * 0.5).toFixed(1)}, vZ);
          float b = 0.45 + vH * 0.55;
          float a = uOpacity * fadeFar * (0.13 + vH * 0.3);
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
  }

  private _tPointMat() {
    return new THREE.ShaderMaterial({
      uniforms: this.tUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${TERRAIN_GLSL}
        uniform float uDpr;
        void main() {
          vec2 q = vec2(position.x, position.z - uScroll);
          float h = terrainH(q);
          vH = h;
          vZ = position.z;
          gl_PointSize = (0.8 + h * 1.6) * uDpr;
          gl_Position = projectionMatrix * viewMatrix *
            vec4(position.x, h + 0.01, position.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${TERRAIN_GLSL}
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (length(uv) > 0.5) discard;
          float fadeFar = smoothstep(${(-T_LEN + 6).toFixed(1)}, ${(-T_LEN * 0.5).toFixed(1)}, vZ);
          float a = uOpacity * fadeFar * (0.1 + vH * 0.3);
          gl_FragColor = vec4(vec3(0.8), a);
        }
      `,
    });
  }

  // Un pic : position latérale large (visuel au-delà du couloir), hauteur et
  // largeur aléatoires. Anti-mur : pas deux pics infranchissables trop
  // proches en Z dans le couloir de vol.
  private _makePeak(Z: number): FPeak {
    const p: FPeak = {
      x: (Math.random() * 2 - 1) * (T_HALF_W - 1.2),
      Z,
      h: 0.35 + Math.random() * 0.85,
      w: 0.5 + Math.random() * 0.75,
    };
    if (p.h > 0.78 && Math.abs(p.x) < LANE_X + 0.6) {
      for (const q of this.fpeaks) {
        if (q.h > 0.78 && Math.abs(q.x) < LANE_X + 0.6 && Math.abs(q.Z - p.Z) < 3.0) {
          p.h = 0.45 + Math.random() * 0.22;
          break;
        }
      }
    }
    return p;
  }

  private _initFPeaks() {
    this.fpeaks = [];
    for (let i = 0; i < FPEAK_N; i++) {
      // répartis devant le vaisseau (z monde négatif), jamais sous le spawn
      const Z = -7 - (i / FPEAK_N) * (T_LEN - 9) + (Math.random() - 0.5) * 1.6;
      this.fpeaks.push(this._makePeak(Z));
    }
    this._pushPeaks();
  }

  // Recyclage : un pic passé derrière la caméra respawn à l'horizon.
  private _recyclePeaks() {
    for (const p of this.fpeaks) {
      if (p.Z + this.scroll > 6) {
        Object.assign(p, this._makePeak(-this.scroll - (T_LEN - 3) - Math.random() * 3));
      }
    }
    this._pushPeaks();
  }

  private _pushPeaks() {
    const arr: THREE.Vector4[] = this.tUniforms.uPeaks.value;
    for (let i = 0; i < FPEAK_N; i++) {
      const p = this.fpeaks[i];
      arr[i].set(p.x, p.Z, p.h, p.w);
    }
  }

  // Hauteur du terrain en coordonnées terrain (x, Zq) — miroir exact de
  // terrainH() du shader, sur les mêmes données.
  private _flightH(x: number, Zq: number) {
    let h = 0;
    for (const p of this.fpeaks) {
      const dx = x - p.x;
      const dz = Zq - p.Z;
      h += p.h * Math.exp(-(dx * dx + dz * dz) / (p.w * p.w + 0.0001));
    }
    return Math.min(h, 1.2);
  }

  // --- VAISSEAU ---------------------------------------------------------------

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

  // Pilote automatique : scanne les couloirs et vise le plus dégagé sur les
  // prochaines secondes, altitude au-dessus du relief à venir.
  private _autopilot(dt: number) {
    const LANES = 13;
    let bestX = this.ctrlX;
    let bestCost = Infinity;
    let bestH = 0;
    for (let i = 0; i < LANES; i++) {
      const x = -LANE_X + (2 * LANE_X * i) / (LANES - 1);
      let danger = 0;
      for (const tau of [0.1, 0.3, 0.55, 0.85, 1.2]) {
        danger = Math.max(danger, this._flightH(x, -this.scroll - this.speed * tau));
      }
      const blocked = danger > ALT_MAX - 0.2 ? 10 : 0; // couloir infranchissable
      const cost = danger * 2 + blocked + Math.abs(x - this.shipPos.x) * 0.5;
      if (cost < bestCost) {
        bestCost = cost;
        bestX = x;
        bestH = danger;
      }
    }
    const gain = Math.min(1, dt * (2.5 + this.speed * 0.6));
    this.ctrlX += (bestX - this.ctrlX) * gain;
    const altTarget = clampN(bestH + 0.32, ALT_MIN + 0.18, ALT_MAX);
    this.ctrlAlt += (altTarget - this.ctrlAlt) * gain;
  }

  // --- CYCLE DE VIE -------------------------------------------------------------

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

    // les montagnes se lèvent sur le disque pendant la bascule (décor de
    // transition), puis le terrain infini prend le relais
    this.orb.regeneratePeaks();
    this.orb.freezeForFlight();
    this.orb.uniforms.uMouse.value.set(999, 999, 999);

    this.scroll = 0;
    this.tUniforms.uScroll.value = 0;
    this._initFPeaks();
    this.terrain.visible = true;
    this.tUniforms.uOpacity.value = 0;

    this.speed = 3.2;
    this.dist = 0;
    this.grace = 1.8;
    this.shipPos.set(0, 0.85, 0);
    this.shipVel.set(0, 0);
    this.ctrlX = 0;
    this.ctrlAlt = 0.7;
    this._setAuto(true); // démo : l'autopilote montre la navigation

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
    this.scroll = 0;
    this.tUniforms.uScroll.value = 0;
    this._initFPeaks();
    this.speed = 3.2;
    this.dist = 0;
    this.grace = 1.8;
    this.shipVel.set(0, 0);
    this.ctrlX = this.shipPos.x;
    this.ctrlAlt = clampN(this.shipPos.y, ALT_MIN, ALT_MAX);
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
    if (this.speedEl) this.speedEl.textContent = String(Math.round(this.speed * 10));
  }

  // Caméra de jeu : basse, juste derrière le vaisseau, regard DROIT devant.
  private _computeGameCam() {
    this.targetCamPos.set(this.shipPos.x, this.shipPos.y + 0.5, this.shipPos.z + 2.1);
    const d = this._dummy;
    d.position.copy(this.targetCamPos);
    // la caméra penche légèrement avec le vaisseau
    d.up.set(Math.sin(this.bank * 0.45), Math.cos(this.bank * 0.45), 0);
    d.lookAt(this.shipPos.x, this.shipPos.y + 0.02, this.shipPos.z - 6);
    this.targetCamQuat.copy(d.quaternion);
  }

  update(t: number, dt: number, _pointer: THREE.Vector2) {
    if (!this.active) return;
    const cam = this.stage.camera;
    const group = this.orb.group;
    this.tUniforms.uTime.value = t;
    this.tUniforms.uDpr.value = this.stage.dpr;

    // --- transitions entrée / sortie ---------------------------------------
    if (this.state === "entering" || this.state === "exiting") {
      const dir = this.state === "entering" ? 1 : -1;
      const dur = this.state === "entering" ? ENTER_DURATION : EXIT_DURATION;
      this.k = Math.max(0, Math.min(1, this.k + (dir * dt) / dur));
      const e = ease(this.k);

      // 1) bascule du disque + montée des montagnes sur l'orbe
      group.rotation.x = this.savedRot.x + (-Math.PI / 2 - this.savedRot.x) * e;
      group.rotation.y = this.savedRot.y * (1 - e);
      group.rotation.z = this.spinPos;
      this.orb.setTerrain(e);
      // 2) fondu croisé : l'orbe s'efface, le terrain infini apparaît
      this.orb.setFade(1 - sstep(0.45, 0.92, e));
      this.tUniforms.uOpacity.value = sstep(0.4, 1, e) * 0.95;

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
        this.terrain.visible = false;
        this.ship.visible = false;
        group.rotation.set(this.savedRot.x, this.savedRot.y, this.spinPos);
        this.orb.setFade(1);
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
      // avance TOUT DROIT : le monde défile, les pics se recyclent à l'horizon
      this.speed = Math.min(10, this.speed + dt * 0.14);
      this.scroll += this.speed * dt;
      this.tUniforms.uScroll.value = this.scroll;
      this.dist += this.speed * dt;
      this._recyclePeaks();

      // consignes : autopilote ou flèches du clavier
      if (this.auto) {
        this._autopilot(dt);
      } else {
        const RX = 3.4; // vitesse latérale (unités/s)
        const RA = 1.3; // vitesse verticale
        if (this.keys.left) this.ctrlX -= RX * dt;
        if (this.keys.right) this.ctrlX += RX * dt;
        if (this.keys.up) this.ctrlAlt += RA * dt;
        if (this.keys.down) this.ctrlAlt -= RA * dt;
        this.ctrlX = clampN(this.ctrlX, -LANE_X, LANE_X);
        this.ctrlAlt = clampN(this.ctrlAlt, ALT_MIN, ALT_MAX);
      }
      const nx = this.shipPos.x + (this.ctrlX - this.shipPos.x) * Math.min(1, dt * 6);
      const nAlt = this.shipPos.y + (this.ctrlAlt - this.shipPos.y) * Math.min(1, dt * 5);
      this.shipVel.set(
        (nx - this.shipPos.x) / Math.max(dt, 1e-4),
        (nAlt - this.shipPos.y) / Math.max(dt, 1e-4)
      );
      this.shipPos.x = clampN(nx, -LANE_X, LANE_X);
      this.shipPos.y = nAlt;
      this.shipPos.z = 0;

      // collision : hauteur EXACTE du terrain sous le vaisseau
      this.grace = Math.max(0, this.grace - dt);
      const h = this._flightH(this.shipPos.x, -this.scroll);
      if (this.grace <= 0 && this.shipPos.y < h - 0.05) {
        this._crash();
      }

      this._updateHud();
    }

    // --- rendu vaisseau + caméra (playing et crashed) ------------------------
    const k = Math.min(1, dt * 6);
    this.bank += (clampN(-this.shipVel.x * 0.4, -0.7, 0.7) - this.bank) * k;
    this.pitch += (clampN(-this.shipVel.y * 0.35, -0.5, 0.5) - this.pitch) * k;
    this.ship.position.copy(this.shipPos);
    this.ship.rotation.set(this.pitch, 0, this.bank);
    // micro-tremblement qui monte avec la vitesse
    const shake = this.state === "playing" ? this.speed * 0.0012 : 0;
    this._computeGameCam();
    cam.position.copy(this.targetCamPos);
    cam.position.x += Math.sin(t * 31) * shake;
    cam.position.y += Math.cos(t * 27) * shake;
    cam.quaternion.copy(this.targetCamQuat);
    cam.fov += (52 + this.speed * 1.1 - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }
}
