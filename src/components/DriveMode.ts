import * as THREE from "three";

// =====================================================================
// DRIVE MODE — vue 3e personne + route procédurale + conduite/autopilote
// =====================================================================
// La route est une polyligne fixée dans le monde, générée en continu devant
// la voiture (courbure douce via somme de sinus) et purgée derrière. La
// voiture avance selon son cap/vitesse ; sans input → autopilote qui vise un
// point plus loin sur la route. Rendu data : rails + pointillé central +
// barreaux, fondu vers le lointain. Caméra derrière, lissée.

import type { Stage } from "../core/Stage";
import type { CarScene } from "./CarScene";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)); // angle dans [-π,π]

interface RoadNode {
  p: THREE.Vector2;
  dir: THREE.Vector2;
  s: number;
  h: number;
}

export class DriveMode {
  stage: Stage;
  car: CarScene;
  active: boolean;
  SPACING: number;
  HALF_W: number;
  cruise: number;
  maxSpeed: number;
  accel: number;
  steerRate: number;
  autoTurn: number;
  keepForce: number;
  pos: THREE.Vector2;
  heading: number;
  prevHeading: number;
  private _turn: number;
  carS: number;
  terrainY: number;
  speed: number;
  private _lastSpeed: number;
  pitch: number;
  roll: number;
  autopilot: boolean;
  STEER_SIGN: number;
  nodes: RoadNode[];
  idx: number;
  private _gen: { s: number; h: number; p: THREE.Vector2 };
  keys: Record<string, boolean>;
  private _look: THREE.Vector3;
  private _snap: boolean;
  private _savedCam: { pos: THREE.Vector3; quat: THREE.Quaternion };
  private _savedCar: { pos: THREE.Vector3; rot: THREE.Euler; scale: number };
  hud: HTMLElement | null;
  autoBtn: HTMLElement | null;
  speedEl: HTMLElement | null;
  mapCanvas: HTMLCanvasElement | null;
  mapCtx: CanvasRenderingContext2D | null;
  // construits dans _build* :
  private _arr!: Float32Array;
  uCar!: { value: THREE.Vector2 };
  road!: THREE.LineSegments;
  MAXP!: number;
  pPos!: Float32Array;
  pVel!: Float32Array;
  pLife!: Float32Array;
  pSeed!: Float32Array;
  pHead!: number;
  parts!: THREE.Points;
  private _earr!: Float32Array;
  env!: THREE.LineSegments;
  uGrid!: { uCar: { value: THREE.Vector2 }; uTime: { value: number }; uPulse: { value: number } };
  grid!: THREE.Mesh;
  carBaseY = 0;

  constructor(stage: Stage, car: CarScene) {
    this.stage = stage;
    this.car = car;
    this.active = false;

    // --- paramètres ---
    this.SPACING = 4;     // distance entre nœuds de route
    this.HALF_W = 6.6;    // demi-largeur (route 2×2 voies)
    this.cruise = 22;     // vitesse de croisière (autopilote)
    this.maxSpeed = 48;
    this.accel = 24;
    this.steerRate = 1.6; // rad/s en manuel
    this.autoTurn = 1.4;  // rad/s max en autopilote
    this.keepForce = 2.6; // force de recentrage douce en manuel (rad/s)

    // --- état véhicule (plan XZ : pos.x = X, pos.y = Z) ---
    this.pos = new THREE.Vector2(0, 0);
    this.heading = 0; // 0 = vers -Z (dans l'écran)
    this.prevHeading = 0;
    this._turn = 0; // taux de rotation lissé (rad/s)
    this.carS = 0;  // distance parcourue (pour l'altitude du terrain)
    this.terrainY = 0;
    this.speed = 0;
    this._lastSpeed = 0;
    this.pitch = 0;
    this.roll = 0;
    this.autopilot = true; // par défaut ; une touche → manuel ; bouton → auto
    this.STEER_SIGN = 1;   // mettre -1 si la direction est inversée

    // --- route ---
    this.nodes = [];
    this.idx = 0;
    this._gen = { s: 0, h: 0, p: new THREE.Vector2(0, 0) };

    // --- input ---
    this.keys = {};
    this._bindKeys();

    // --- caméra ---
    this._look = new THREE.Vector3();
    this._snap = false;
    this._savedCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this._savedCar = {
      pos: new THREE.Vector3(),
      rot: new THREE.Euler(),
      scale: 1,
    };

    this._buildRoad();
    this._buildParticles();
    this._buildEnv();
    this._buildGrid();

    // HUD
    this.hud = document.getElementById("drive-hud");
    this.autoBtn = document.getElementById("drive-auto");
    this.speedEl = document.getElementById("drive-speed");
    this.mapCanvas = document.getElementById("drive-map") as HTMLCanvasElement | null;
    this.mapCtx = this.mapCanvas ? this.mapCanvas.getContext("2d") : null;
    this.autoBtn?.addEventListener("click", () => {
      this.autopilot = true; // réengage l'autopilote
    });
    this._bindTouch();
  }

  // boutons tactiles (mobile) → alimentent le même objet `keys` que le clavier.
  _bindTouch() {
    const btns = document.querySelectorAll(".drive-touch__btn");
    btns.forEach((btn) => {
      const k = btn.getAttribute("data-k") || "";
      const down = (e: Event) => {
        e.preventDefault();
        if (!this.active) return;
        this.keys[k] = true;
        this.autopilot = false; // toute action → manuel
        btn.classList.add("--active");
      };
      const up = (e: Event) => {
        e.preventDefault();
        this.keys[k] = false;
        btn.classList.remove("--active");
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
    });
  }

  // ----- ROUTE : objet de rendu -------------------------------------------
  _buildRoad() {
    const CAP = 6000; // verts max (rails + dashes + barreaux)
    this._arr = new Float32Array(CAP * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._arr, 3));
    geo.setDrawRange(0, 0);

    this.uCar = { value: new THREE.Vector2(0, 0) };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCar: this.uCar },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec2 uCar;
        varying float vFade;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float d = distance(wp.xz, uCar);
          // fondu : net autour de la voiture, s'éteint au loin.
          vFade = (1.0 - smoothstep(40.0, 210.0, d)) * smoothstep(2.0, 14.0, d);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vFade;
        void main() {
          if (vFade <= 0.001) discard;
          gl_FragColor = vec4(vec3(0.85), vFade * 0.7);
        }
      `,
    });
    this.road = new THREE.LineSegments(geo, mat);
    this.road.frustumCulled = false;
    this.road.visible = false;
    this.stage.scene.add(this.road);
  }

  // ----- PARTICULES DE DRIFT (pool en ring buffer) -------------------------
  _buildParticles() {
    this.MAXP = 700;
    this.pPos = new Float32Array(this.MAXP * 3);
    this.pVel = new Float32Array(this.MAXP * 3);
    this.pLife = new Float32Array(this.MAXP); // 1 = neuf, 0 = mort
    this.pSeed = new Float32Array(this.MAXP);
    this.pHead = 0;
    for (let i = 0; i < this.MAXP; i++) {
      this.pPos[i * 3 + 1] = -999;
      this.pSeed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute("aLife", new THREE.BufferAttribute(this.pLife, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(this.pSeed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: this.stage.dpr } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSeed;
        uniform float uDpr;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float sz = 2.0 + 8.0 * (1.0 - aLife) + aSeed * 2.0; // gonfle en vieillissant
          gl_PointSize = sz * uDpr * (60.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vLife;
        void main() {
          if (vLife <= 0.001) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          if (r > 0.5) discard;
          float core = smoothstep(0.5, 0.08, r);
          gl_FragColor = vec4(vec3(0.92), core * vLife * 0.45);
        }
      `,
    });
    this.parts = new THREE.Points(g, mat);
    this.parts.frustumCulled = false;
    this.parts.visible = false;
    this.stage.scene.add(this.parts);
  }

  _emit(n: number, x: number, y: number, z: number, vx: number, vz: number) {
    for (let j = 0; j < n; j++) {
      const i = this.pHead;
      this.pHead = (this.pHead + 1) % this.MAXP;
      this.pPos[i * 3] = x + (Math.random() - 0.5) * 0.5;
      this.pPos[i * 3 + 1] = y + Math.random() * 0.2;
      this.pPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
      this.pVel[i * 3] = vx + (Math.random() - 0.5) * 2.2;
      this.pVel[i * 3 + 1] = 0.5 + Math.random() * 1.3;
      this.pVel[i * 3 + 2] = vz + (Math.random() - 0.5) * 2.2;
      this.pLife[i] = 1.0;
    }
  }

  _updateParticles(dt: number) {
    const LIFE = 0.7;
    for (let i = 0; i < this.MAXP; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] = Math.max(0, this.pLife[i] - dt / LIFE);
      const drag = 1 - Math.min(1, dt * 2.0);
      this.pVel[i * 3] *= drag;
      this.pVel[i * 3 + 2] *= drag;
      this.pVel[i * 3 + 1] -= dt * 1.0; // retombée douce
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    this.parts.geometry.attributes.position.needsUpdate = true;
    this.parts.geometry.attributes.aLife.needsUpdate = true;
    (this.parts.material as THREE.ShaderMaterial).uniforms.uDpr.value = this.stage.dpr;
  }

  // ----- DÉCOR : lampadaires + immeubles (wireframe 3D) --------------------
  _buildEnv() {
    const CAP = 40000;
    this._earr = new Float32Array(CAP * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._earr, 3));
    geo.setDrawRange(0, 0);
    // partage l'uniform uCar avec la route pour le fondu de distance.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCar: this.uCar },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec2 uCar;
        varying float vFade;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float d = distance(wp.xz, uCar);
          vFade = (1.0 - smoothstep(60.0, 240.0, d)) * smoothstep(3.0, 16.0, d);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vFade;
        void main() {
          if (vFade <= 0.001) discard;
          gl_FragColor = vec4(vec3(0.6), vFade * 0.6);
        }
      `,
    });
    this.env = new THREE.LineSegments(geo, mat);
    this.env.frustumCulled = false;
    this.env.visible = false;
    this.stage.scene.add(this.env);
  }

  // ----- SOL GRILLE TRON RÉACTIF ------------------------------------------
  // Grand quad au sol qui suit la voiture ; la grille est tracée en coords
  // MONDE (fract) → elle défile sous les roues. Un halo lumineux pulse autour
  // de la voiture et s'éteint au loin (fondu circulaire).
  _buildGrid() {
    const geo = new THREE.PlaneGeometry(520, 520, 1, 1);
    geo.rotateX(-Math.PI / 2); // dans le plan XZ
    this.uGrid = {
      uCar: this.uCar,                 // partagé : position voiture (xz monde)
      uTime: { value: 0 },
      uPulse: { value: 0 },            // intensité (monte avec la vitesse)
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uGrid,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec2 uCar;
        uniform float uTime;
        uniform float uPulse;
        varying vec3 vW;
        // lignes de grille anti-aliasées à un pas donné.
        float grid(vec2 p, float step, float w) {
          vec2 g = abs(fract(p / step - 0.5) - 0.5) / fwidth(p / step);
          float l = min(g.x, g.y);
          return 1.0 - smoothstep(0.0, w, l);
        }
        void main() {
          float d = distance(vW.xz, uCar);
          // fondu : la grille apparaît un peu à distance et s'éteint au loin.
          // (pas de zone trop proche → évite l'effet "tache" sous la voiture)
          float fade = (1.0 - smoothstep(40.0, 150.0, d)) * smoothstep(6.0, 26.0, d);
          if (fade <= 0.001) discard;
          float fine = grid(vW.xz, 5.0, 1.0) * 0.35;
          float coarse = grid(vW.xz, 25.0, 0.9) * 0.55;
          float g = fine + coarse;
          gl_FragColor = vec4(vec3(0.62, 0.68, 0.76), g * fade * 0.5);
        }
      `,
    });
    this.grid = new THREE.Mesh(geo, mat);
    this.grid.frustumCulled = false;
    this.grid.visible = false;
    this.grid.renderOrder = -2; // sous tout le reste
    this.stage.scene.add(this.grid);
  }

  _hash(n: number) {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  _updateEnvGeometry() {
    const arr = this._earr;
    const cap = arr.length / 3;
    let v = 0;
    const pV = (x: number, y: number, z: number) => {
      if (v >= cap) return;
      arr[v * 3] = x; arr[v * 3 + 1] = y; arr[v * 3 + 2] = z; v++;
    };
    const line = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => { pV(x1, y1, z1); pV(x2, y2, z2); };
    const hw = this.HALF_W;
    const start = Math.max(0, this.idx - 16);
    const end = this.nodes.length - 1;

    for (let i = start; i < end; i++) {
      const node = this.nodes[i];
      const px = -node.dir.y, pz = node.dir.x;   // normale gauche (unit)
      const dx = node.dir.x, dz = node.dir.y;     // direction route
      const s = node.s;
      const gy = node.h;                          // altitude du sol ici

      // --- lampadaires tous les 3 nœuds, des deux côtés ---
      if (i % 3 === 0) {
        for (const side of [1, -1]) {
          const off = (hw + 1.0) * side;
          const Px = node.p.x + px * off;
          const Pz = node.p.y + pz * off;
          const top = gy + 4.6;
          line(Px, gy, Pz, Px, top, Pz);              // mât
          const ax = -px * side * 1.7, az = -pz * side * 1.7; // bras vers la route
          const Hx = Px + ax, Hz = Pz + az;
          line(Px, top, Pz, Hx, top, Hz);             // bras
          // tête de lampe (croix lumineuse) + petite retombée
          line(Hx - 0.3, top, Hz, Hx + 0.3, top, Hz);
          line(Hx, top, Hz - 0.3, Hx, top, Hz + 0.3);
          line(Hx, top, Hz, Hx, top - 0.4, Hz);
        }
      }

      // --- immeubles tous les 5 nœuds, des deux côtés (avec trous) ---
      if (i % 5 === 0) {
        for (const side of [1, -1]) {
          const r = this._hash(s * 0.13 + side * 7.3);
          if (r < 0.32) continue; // gaps dans la skyline
          const off = (hw + 6 + this._hash(s + side) * 16) * side;
          const bw = 1.6 + this._hash(s * 1.7 + side) * 3.2;   // demi-largeur
          const bd = 1.6 + this._hash(s * 2.3 + side) * 3.2;   // demi-profondeur
          const tower = this._hash(s * 4.1 + side * 5.7) > 0.78 ? 1.7 : 1; // gratte-ciel
          const bh = (5 + this._hash(s * 0.7 + side * 3.1) * 24) * tower;
          const yb = gy, yt = gy + bh;
          const Cx = node.p.x + px * off;
          const Cz = node.p.y + pz * off;
          const corner = (a: number, b: number): [number, number] => [Cx + px * a + dx * b, Cz + pz * a + dz * b];
          const cs = [corner(bw, bd), corner(bw, -bd), corner(-bw, -bd), corner(-bw, bd)];

          // boucle horizontale à une hauteur donnée (base, étages, sommet).
          const loop = (y: number) => {
            for (let e = 0; e < 4; e++) {
              const a = cs[e], b = cs[(e + 1) % 4];
              line(a[0], y, a[1], b[0], y, b[1]);
            }
          };
          // arêtes verticales aux coins.
          for (let e = 0; e < 4; e++) {
            line(cs[e][0], yb, cs[e][1], cs[e][0], yt, cs[e][1]);
          }
          // montants de fenêtres : verticales intermédiaires sur chaque face.
          const cols = 2;
          for (let e = 0; e < 4; e++) {
            const a = cs[e], b = cs[(e + 1) % 4];
            for (let j = 1; j <= cols; j++) {
              const t = j / (cols + 1);
              const x = a[0] + (b[0] - a[0]) * t;
              const z = a[1] + (b[1] - a[1]) * t;
              line(x, yb, z, x, yt, z);
            }
          }
          // étages : boucles horizontales régulières (≈3 u) → grille de fenêtres.
          const nf = Math.max(2, Math.round(bh / 3.0));
          for (let f = 0; f <= nf; f++) loop(yb + (bh * f) / nf);

          // toiture : antenne ou édicule technique selon le hash.
          const rr = this._hash(s * 3.7 + side * 2.1);
          if (rr > 0.62) {
            line(Cx, yt, Cz, Cx, yt + 1.6 + rr * 3.0, Cz); // antenne
          } else if (rr > 0.32) {
            const rw = bw * 0.5, rd = bd * 0.5, rh = 1.2 + rr * 2.2;
            const rc = [corner(rw, rd), corner(rw, -rd), corner(-rw, -rd), corner(-rw, rd)];
            for (let e = 0; e < 4; e++) {
              const a = rc[e], b = rc[(e + 1) % 4];
              line(a[0], yt, a[1], b[0], yt, b[1]);
              line(a[0], yt + rh, a[1], b[0], yt + rh, b[1]);
              line(a[0], yt, a[1], a[0], yt + rh, a[1]);
            }
          }
        }
      }
    }
    this.env.geometry.setDrawRange(0, v);
    this.env.geometry.attributes.position.needsUpdate = true;
  }

  _curv(s: number) {
    // courbure (rad/unité) : somme de sinus → virages doux et variés.
    return (
      0.020 * Math.sin(s * 0.013) +
      0.014 * Math.sin(s * 0.029 + 1.7) +
      0.008 * Math.sin(s * 0.061 + 0.4)
    );
  }

  _elev(s: number) {
    // altitude du terrain (unités) : collines douces à grande longueur d'onde.
    return 2.4 * Math.sin(s * 0.012) + 1.3 * Math.sin(s * 0.027 + 1.1);
  }

  _extendNode() {
    const g = this._gen;
    g.h += this._curv(g.s) * this.SPACING;
    const dx = Math.sin(g.h);
    const dz = -Math.cos(g.h);
    g.p.x += dx * this.SPACING;
    g.p.y += dz * this.SPACING;
    this.nodes.push({
      p: g.p.clone(),
      dir: new THREE.Vector2(dx, dz),
      s: g.s,
      h: this._elev(g.s),
    });
    g.s += this.SPACING;
  }

  _resetRoad() {
    this.nodes.length = 0;
    this._gen.s = 0;
    this._gen.h = 0;
    this._gen.p.set(0, 0);
    this.idx = 0;
    // premier nœud à l'origine, cap 0.
    this.nodes.push({
      p: new THREE.Vector2(0, 0),
      dir: new THREE.Vector2(0, -1),
      s: -this.SPACING,
      h: this._elev(-this.SPACING),
    });
    for (let i = 0; i < 80; i++) this._extendNode();
  }

  // ----- ENTER / EXIT ------------------------------------------------------
  enter() {
    if (this.active || !this.car.ready) return;
    this.active = true;

    // sauvegarde de l'état caméra + voiture pour restaurer à la sortie.
    this._savedCam.pos.copy(this.stage.camera.position);
    this._savedCam.quat.copy(this.stage.camera.quaternion);
    this._savedCar.pos.copy(this.car.group.position);
    this._savedCar.rot.copy(this.car.group.rotation);
    this._savedCar.scale = this.car.group.scale.x;

    // réglages conduite.
    this.car.group.scale.setScalar(1.0);
    this.carBaseY = -this.car.bounds.min.y; // pose les roues à y≈0
    this.car.freezeForDrive();
    this.car.uniforms.uMouse.value.set(9999, 9999, 9999); // pas de glow souris

    this.pos.set(0, 0);
    this.heading = 0;
    this.prevHeading = 0;
    this.autopilot = true; // démarre en autopilote
    this.keys = {};
    this.carS = 0;
    this.speed = this.cruise * 0.6;
    this.pitch = 0;
    this.roll = 0;
    this._resetRoad();
    this.road.visible = true;
    this.env.visible = true;
    this.parts.visible = true;
    this.grid.visible = true;
    for (let i = 0; i < this.MAXP; i++) this.pLife[i] = 0; // purge particules
    this._snap = true;

    document.body.classList.add("driving");
    this.hud?.classList.remove("drive-hud--hidden");
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.road.visible = false;
    this.env.visible = false;
    this.parts.visible = false;
    this.grid.visible = false;
    this.car.group.scale.setScalar(this._savedCar.scale);
    this.car.group.position.copy(this._savedCar.pos);
    this.car.group.rotation.copy(this._savedCar.rot);
    this.stage.camera.position.copy(this._savedCam.pos);
    this.stage.camera.quaternion.copy(this._savedCam.quat);
    this.car.resumeAfterDrive();

    document.body.classList.remove("driving");
    this.hud?.classList.add("drive-hud--hidden");
  }

  // ----- INPUT -------------------------------------------------------------
  _bindKeys() {
    const map: Record<string, string> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right", // QWERTY
      KeyZ: "up", KeyQ: "left",                               // AZERTY
    };
    window.addEventListener("keydown", (e) => {
      const k = map[e.code];
      if (k && this.active) {
        this.keys[k] = true;
        this.autopilot = false; // toute touche → passe en manuel
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = map[e.code];
      if (k) this.keys[k] = false;
    });
  }

  // ----- BOUCLE ------------------------------------------------------------
  update(t: number, dt: number) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);

    const k = this.keys;
    this.prevHeading = this.heading;

    if (this.autopilot) {
      // --- AUTOPILOTE : vitesse de croisière + suit la route ---
      this.speed += (this.cruise - this.speed) * clamp(dt * 0.8, 0, 1);
      this.speed = clamp(this.speed, -6, this.maxSpeed);
      this._autopilot(dt);
    } else {
      // --- MANUEL : contrôle joueur + force douce de recentrage ---
      if (k.up) this.speed += this.accel * dt;
      else if (k.down) this.speed -= this.accel * dt;
      else this.speed += (this.cruise - this.speed) * clamp(dt * 0.8, 0, 1);
      this.speed = clamp(this.speed, -6, this.maxSpeed);

      const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0); // +1 = droite écran
      if (dir !== 0) {
        const f = clamp(Math.abs(this.speed) / 8, 0.25, 1); // moins réactif lent
        this.heading += this.STEER_SIGN * dir * this.steerRate * dt * f;
      }
    }

    // --- avance ---
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    this.pos.x += fx * this.speed * dt;
    this.pos.y += fz * this.speed * dt;
    this.carS += this.speed * dt;

    // --- progression sur la route + extension/purge ---
    this._advanceIndex();
    while (this.nodes.length - this.idx < 70) this._extendNode();
    if (this.idx > 30) { this.nodes.splice(0, 20); this.idx -= 20; }

    // --- collision avec les bords : mur infranchissable ---
    this._wallCollide();

    // --- altitude : interpolée depuis la route RÉELLE sous la voiture ---
    // (et non depuis carS, qui se désync de la route et "inverse" le relief)
    this.terrainY = this._groundY();

    // --- carrosserie : position + cap + inclinaisons douces ---
    // taux de rotation lissé → évite les pics parasites frame à frame.
    const rawTurn = wrap(this.heading - this.prevHeading) / dt;
    this._turn += (rawTurn - this._turn) * clamp(dt * 8, 0, 1);
    const turnRate = this._turn;
    this.roll += (-clamp(turnRate * 0.5, -1, 1) * 0.09 - this.roll) * clamp(dt * 4, 0, 1);

    // --- drift : SEULEMENT au-delà d'un vrai angle de braquage ---
    // (les courbes douces de l'autopilote restent sous le seuil → pas de
    // particules en "ligne droite").
    const TURN_MIN = 1.15; // rad/s : seuil de déclenchement du drift
    const excess = Math.abs(turnRate) - TURN_MIN;
    if (excess > 0 && this.speed > 10) {
      const fx0 = Math.sin(this.heading);
      const fz0 = -Math.cos(this.heading);
      const driftAmt = clamp(excess / 0.8, 0, 1) * clamp(this.speed / this.maxSpeed + 0.3, 0, 1);
      const lnx = -fz0, lnz = fx0; // normale gauche
      const rx = this.pos.x - fx0 * 1.9;
      const rz = this.pos.y - fz0 * 1.9;
      const track = 0.85;
      const n = 1 + Math.floor(driftAmt * 5);
      const bvx = -fx0 * this.speed * 0.14;
      const bvz = -fz0 * this.speed * 0.14;
      const py = this.terrainY + 0.15;
      this._emit(n, rx + lnx * track, py, rz + lnz * track, bvx, bvz);
      this._emit(n, rx - lnx * track, py, rz - lnz * track, bvx, bvz);
    }
    const accelSig = clamp((this.speed - this._lastSpeed) / Math.max(dt, 0.001) / 30, -1, 1);
    // tangage : accélération + pente de la route (montée/descente), mesurée
    // sur les nœuds réels → cohérente avec l'altitude de la voiture.
    const j1 = Math.max(this.idx - 1, 0);
    const j2 = Math.min(this.idx + 2, this.nodes.length - 1);
    const slope = (this.nodes[j2].h - this.nodes[j1].h) / (((j2 - j1) * this.SPACING) || 1);
    const pitchTarget = -accelSig * 0.02 + clamp(slope, -0.3, 0.3) * 0.7;
    this.pitch += (pitchTarget - this.pitch) * clamp(dt * 3, 0, 1);
    this._lastSpeed = this.speed;

    const yaw =
      this.car.longAxis === "x" ? Math.PI / 2 - this.heading : Math.PI - this.heading;
    this.car.group.position.set(this.pos.x, this.carBaseY + this.terrainY, this.pos.y);
    this.car.group.rotation.set(this.pitch, yaw, this.roll);

    // --- route + décor : remplir les buffers + maj uniform ---
    this._updateRoadGeometry();
    this._updateEnvGeometry();
    this.uCar.value.set(this.pos.x, this.pos.y);

    // --- sol grille TRON : suit la voiture, intensité ~ vitesse ---
    this.grid.position.set(this.pos.x, this.carBaseY + this.terrainY - 0.04, this.pos.y);
    this.uGrid.uTime.value = t;
    const pulse = clamp(this.speed / this.maxSpeed, 0, 1);
    this.uGrid.uPulse.value += (pulse - this.uGrid.uPulse.value) * clamp(dt * 3, 0, 1);

    // --- particules de drift ---
    this._updateParticles(dt);

    // --- radar / minimap ---
    this._updateRadar();

    // --- caméra 3e personne lissée ---
    this._updateCamera(dt);

    // --- HUD ---
    if (this.autoBtn) {
      this.autoBtn.textContent = this.autopilot ? "● AUTOPILOT" : "○ MANUAL";
      this.autoBtn.classList.toggle("drive-hud__auto--on", this.autopilot);
    }
    if (this.speedEl) this.speedEl.textContent = String(Math.max(0, Math.round(this.speed * 4)));
  }

  // distance latérale signée à la route (gauche positive).
  _lateral() {
    const a = this.nodes[this.idx];
    if (!a) return 0;
    const rx = this.pos.x - a.p.x;
    const rz = this.pos.y - a.p.y;
    return rx * -a.dir.y + rz * a.dir.x;
  }

  // collision avec les bords de la chaussée : la voiture est repoussée contre
  // le mur (clamp latéral) et perd de la vitesse selon l'angle d'impact.
  // Frontal → gros freinage (bloqué) ; rasant → on glisse le long du mur.
  _wallCollide() {
    const a = this.nodes[this.idx];
    if (!a) return;
    const nx = -a.dir.y, nz = a.dir.x; // normale gauche (unitaire)
    const lat = (this.pos.x - a.p.x) * nx + (this.pos.y - a.p.y) * nz;
    const maxLat = this.HALF_W - 0.9; // demi-largeur voiture en marge
    if (Math.abs(lat) <= maxLat) return;
    const sign = lat > 0 ? 1 : -1;
    const over = Math.abs(lat) - maxLat;
    // repousse la voiture exactement contre le mur.
    this.pos.x -= nx * sign * over;
    this.pos.y -= nz * sign * over;
    // composante de la vitesse dirigée vers le mur → freinage proportionnel.
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    const into = (fx * nx + fz * nz) * sign; // >0 si on fonce dans le mur
    if (into > 0) this.speed *= clamp(1 - 0.85 * into, 0, 1);
  }

  // point d'anticipation continu à `dist` mètres devant la voiture, mesuré
  // depuis sa projection exacte sur la route → pas de saut quand idx change.
  _lookAhead(dist: number) {
    const i = this.idx;
    const a = this.nodes[i], b = this.nodes[i + 1];
    if (!a || !b) return a ? a.p.clone() : new THREE.Vector2();
    const sx = b.p.x - a.p.x, sz = b.p.y - a.p.y;
    const len2 = sx * sx + sz * sz || 1;
    const t = clamp(((this.pos.x - a.p.x) * sx + (this.pos.y - a.p.y) * sz) / len2, 0, 1);
    let px = a.p.x + sx * t, pz = a.p.y + sz * t;
    let acc = 0;
    for (let j = i + 1; j < this.nodes.length; j++) {
      const c = this.nodes[j].p;
      const ex = c.x - px, ez = c.y - pz;
      const segLen = Math.hypot(ex, ez) || 1;
      if (acc + segLen >= dist) {
        const tt = (dist - acc) / segLen;
        return new THREE.Vector2(px + ex * tt, pz + ez * tt);
      }
      acc += segLen; px = c.x; pz = c.y;
    }
    return new THREE.Vector2(px, pz);
  }

  // altitude de la route exactement sous la voiture (interp. linéaire des
  // hauteurs de nœuds le long du segment courant).
  _groundY() {
    const a = this.nodes[this.idx], b = this.nodes[this.idx + 1];
    if (!a) return 0;
    if (!b) return a.h;
    const sx = b.p.x - a.p.x, sz = b.p.y - a.p.y;
    const len2 = sx * sx + sz * sz || 1;
    const t = clamp(((this.pos.x - a.p.x) * sx + (this.pos.y - a.p.y) * sz) / len2, 0, 1);
    return a.h + (b.h - a.h) * t;
  }

  _autopilot(dt: number) {
    const target = this._lookAhead(16);
    const dx = target.x - this.pos.x;
    const dz = target.y - this.pos.y;
    const desired = Math.atan2(dx, -dz); // cap visant la cible (forward = -Z)
    const diff = wrap(desired - this.heading);
    // braquage proportionnel lissé (approche exponentielle) plafonné par autoTurn.
    const eased = diff * clamp(dt * 2.5, 0, 1);
    const maxStep = this.autoTurn * dt;
    this.heading += clamp(eased, -maxStep, maxStep);
  }

  _advanceIndex() {
    // avance l'index tant que la voiture a dépassé le segment courant.
    while (this.idx < this.nodes.length - 2) {
      const a = this.nodes[this.idx].p;
      const b = this.nodes[this.idx + 1].p;
      const sx = b.x - a.x, sz = b.y - a.y;
      const len2 = sx * sx + sz * sz || 1;
      const tproj = ((this.pos.x - a.x) * sx + (this.pos.y - a.y) * sz) / len2;
      if (tproj > 1) this.idx++;
      else break;
    }
  }

  _updateRoadGeometry() {
    const arr = this._arr;
    const cap = arr.length / 3;
    let v = 0;
    const push = (x: number, y: number, z: number) => {
      if (v >= cap) return;
      arr[v * 3] = x; arr[v * 3 + 1] = y; arr[v * 3 + 2] = z; v++;
    };
    const hw = this.HALF_W;
    const laneW = hw / 2; // 2 voies par sens
    const start = Math.max(0, this.idx - 16);
    const end = this.nodes.length - 1;
    for (let i = start; i < end; i++) {
      const a = this.nodes[i], b = this.nodes[i + 1];
      const pax = -a.dir.y, paz = a.dir.x; // normale gauche (unitaire)
      const pbx = -b.dir.y, pbz = b.dir.x;
      const ya = a.h + 0.02, yb = b.h + 0.02;
      // trace une ligne longitudinale à l'offset latéral o (gauche+).
      const lineAt = (o: number, dashed: boolean) => {
        if (dashed && i % 2 !== 0) return;
        push(a.p.x + pax * o, ya, a.p.y + paz * o);
        push(b.p.x + pbx * o, yb, b.p.y + pbz * o);
      };
      lineAt(hw, false);        // rail extérieur gauche
      lineAt(-hw, false);       // rail extérieur droit
      lineAt(0.35, false);      // médiane centrale (double ligne)
      lineAt(-0.35, false);
      lineAt(laneW, true);      // séparateur de voies (gauche), pointillé
      lineAt(-laneW, true);     // séparateur de voies (droite), pointillé
      // barreau transversal occasionnel → sensation de vitesse
      if (i % 4 === 0) {
        push(a.p.x + pax * hw, ya, a.p.y + paz * hw);
        push(a.p.x - pax * hw, ya, a.p.y - paz * hw);
      }
    }
    this.road.geometry.setDrawRange(0, v);
    this.road.geometry.attributes.position.needsUpdate = true;
  }

  // radar : vue de dessus orientée (voiture en bas, cap vers le haut).
  _updateRadar() {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const W = this.mapCanvas!.width, H = this.mapCanvas!.height;
    const cx = W / 2, cy = H * 0.62;        // voiture un peu vers le bas
    const scale = 1.7;                       // px par unité monde
    ctx.clearRect(0, 0, W, H);

    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading); // forward
    const rx = -fz, rz = fx;                 // droite écran
    // projette un point monde dans le repère radar (forward = haut).
    const proj = (wx: number, wz: number): [number, number] => {
      const dx = wx - this.pos.x, dz = wz - this.pos.y;
      const fwd = dx * fx + dz * fz;         // distance devant
      const lat = dx * rx + dz * rz;         // décalage latéral (droite +)
      return [cx + lat * scale, cy - fwd * scale];
    };

    // bords de chaussée (deux rails).
    const hw = this.HALF_W;
    for (const o of [hw, -hw]) {
      ctx.beginPath();
      let first = true;
      for (let i = Math.max(0, this.idx - 6); i < this.nodes.length; i++) {
        const n = this.nodes[i];
        const nx = -n.dir.y, nz = n.dir.x;   // normale gauche
        const [px, py] = proj(n.p.x + nx * o, n.p.y + nz * o);
        if (first) { ctx.moveTo(px, py); first = false; }
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(150,165,180,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // axe central pointillé.
    ctx.beginPath();
    let firstC = true;
    for (let i = Math.max(0, this.idx - 6); i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const [px, py] = proj(n.p.x, n.p.y);
      if (firstC) { ctx.moveTo(px, py); firstC = false; }
      else ctx.lineTo(px, py);
    }
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(120,135,150,0.4)";
    ctx.stroke();
    ctx.setLineDash([]);

    // triangle voiture.
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.closePath();
    ctx.fillStyle = this.autopilot ? "rgba(235,240,245,0.95)" : "rgba(255,255,255,1)";
    ctx.fill();
  }

  _updateCamera(dt: number) {
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const cw = new THREE.Vector3(this.pos.x, this.carBaseY + this.terrainY, this.pos.y);

    const camPos = new THREE.Vector3(
      cw.x - fx * 12,
      cw.y + 4.6,
      cw.z - fz * 12
    );
    const lookTarget = new THREE.Vector3(
      cw.x + fx * 10,
      cw.y + 1.2,
      cw.z + fz * 10
    );

    if (this._snap) {
      this.stage.camera.position.copy(camPos);
      this._look.copy(lookTarget);
      this._snap = false;
    } else {
      const kp = clamp(dt * 3.0, 0, 1);
      this.stage.camera.position.lerp(camPos, kp);
      this._look.lerp(lookTarget, clamp(dt * 4.0, 0, 1));
    }
    this.stage.camera.lookAt(this._look);
  }
}
