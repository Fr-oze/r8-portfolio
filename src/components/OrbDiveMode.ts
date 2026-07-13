import * as THREE from "three";
import type { Stage } from "../core/Stage";
import type { OrbScene } from "./OrbScene";

// =====================================================================
// ORB DIVE — dérive hypnotique + jeu : tunnel infini qui serpente, ondes
// de lumière, roulis lent. Des NOYAUX lumineux arrivent dans le tunnel :
// on dérive à la souris pour les traverser → score + combo (la vitesse
// monte avec le combo). Clic maintenu = boost. Échap / EXIT pour sortir.
// =====================================================================

const LEN = 60; // profondeur visible du tunnel (unités monde)
const RING_N = 110;
const RING_SEGS = 96;
const STREAK_N = 170;
const DUST_N = 4200;
const CORE_N = 5; // noyaux simultanés dans le tunnel

// Le tunnel est paramétré par A = uDist + s (coordonnée absolue le long du
// chemin, en "slots" : 1 slot = LEN unités). curve(A) donne la position
// latérale du chemin ; on soustrait curve(uDist) pour que la caméra reste à
// l'origine : le tunnel se courbe devant et se redresse en passant.
const TUNNEL_GLSL = /* glsl */ `
  uniform float uDist;
  uniform float uTime;
  uniform vec2  uSteer;
  uniform float uBoost;
  uniform float uFlash; // impulsion lumineuse quand un noyau est attrapé
  varying float vS;
  varying float vPulse;
  const float LEN = ${LEN.toFixed(1)};
  const float RADIUS = 2.4;

  vec2 curve(float A) {
    return vec2(
      sin(A * 2.2) * 1.8 + sin(A * 0.9) * 2.6,
      cos(A * 1.4) * 1.2 + sin(A * 0.6) * 0.9
    );
  }
`;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Core {
  A: number; // position absolue le long du chemin (slots)
  ox: number; // décalage latéral dans le tunnel
  oy: number;
  phase: number;
  obj: THREE.Group;
  mat: THREE.LineBasicMaterial;
}

// Miroir JS de curve() pour orienter la caméra vers le virage qui arrive.
function curveJS(A: number, out: THREE.Vector2) {
  out.set(
    Math.sin(A * 2.2) * 1.8 + Math.sin(A * 0.9) * 2.6,
    Math.cos(A * 1.4) * 1.2 + Math.sin(A * 0.6) * 0.9
  );
  return out;
}

export class OrbDiveMode {
  stage: Stage;
  orb: OrbScene;
  active = false;

  private group: THREE.Group;
  private uniforms = {
    uDist: { value: 0 },
    uTime: { value: 0 },
    uSteer: { value: new THREE.Vector2(0, 0) },
    uBoost: { value: 0 },
    uFlash: { value: 0 },
    uDpr: { value: 1 },
  };
  private steer = new THREE.Vector2(0, 0);
  private boosting = false;
  private speed = 0; // slots/s lissé
  private cores: Core[] = [];
  private score = 0;
  private combo = 0;
  private savedCam = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    fov: 42,
  };
  private hud: HTMLElement | null;
  private speedEl: HTMLElement | null;
  private distEl: HTMLElement | null;
  private scoreEl: HTMLElement | null;
  private comboEl: HTMLElement | null;
  private introEl: HTMLElement | null;
  private _c1 = new THREE.Vector2();
  private _c2 = new THREE.Vector2();
  private _c3 = new THREE.Vector2();
  private _c4 = new THREE.Vector2();

  constructor(stage: Stage, orb: OrbScene) {
    this.stage = stage;
    this.orb = orb;
    this.uniforms.uDpr.value = stage.dpr;

    this.group = new THREE.Group();
    this.group.visible = false;
    stage.add(this.group);
    this._buildRings();
    this._buildStreaks();
    this._buildDust();
    this._buildCores();

    this.hud = document.getElementById("dive-hud");
    this.speedEl = document.getElementById("dive-speed");
    this.distEl = document.getElementById("dive-dist");
    this.scoreEl = document.getElementById("dive-score");
    this.comboEl = document.getElementById("dive-combo");
    this.introEl = document.getElementById("dive-intro");

    // Boost : clic maintenu n'importe où (sauf sur un bouton du HUD).
    window.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      if ((e.target as HTMLElement).closest("button")) return;
      this.boosting = true;
    });
    window.addEventListener("pointerup", () => (this.boosting = false));
    window.addEventListener("pointercancel", () => (this.boosting = false));
  }

  // --- ANNEAUX : cercles froissés qui foncent vers la caméra ---------------
  private _buildRings() {
    const verts = RING_N * RING_SEGS * 2;
    const slots = new Float32Array(verts);
    const angles = new Float32Array(verts);
    const seeds = new Float32Array(verts);
    let w = 0;
    for (let i = 0; i < RING_N; i++) {
      const slot = i / RING_N;
      const seed = Math.random() * 10;
      for (let s = 0; s < RING_SEGS; s++) {
        for (let e = 0; e < 2; e++) {
          slots[w] = slot;
          angles[w] = (((s + e) % RING_SEGS) / RING_SEGS) * Math.PI * 2;
          seeds[w] = seed;
          w++;
        }
      }
    }
    this.group.add(
      new THREE.LineSegments(
        this._geo(verts, slots, angles, seeds, null),
        this._ringMaterial()
      )
    );
  }

  // --- TRAÎNÉES : segments longitudinaux sur la paroi (sensation de vitesse)
  private _buildStreaks() {
    const verts = STREAK_N * 2;
    const slots = new Float32Array(verts);
    const angles = new Float32Array(verts);
    const seeds = new Float32Array(verts);
    const ends = new Float32Array(verts);
    for (let i = 0; i < STREAK_N; i++) {
      const slot = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const seed = 0.96 + Math.random() * 0.1; // rayon relatif
      for (let e = 0; e < 2; e++) {
        const w = i * 2 + e;
        slots[w] = slot;
        angles[w] = angle;
        seeds[w] = seed;
        ends[w] = e;
      }
    }
    this.group.add(
      new THREE.LineSegments(
        this._geo(verts, slots, angles, seeds, ends),
        this._streakMaterial()
      )
    );
  }

  // --- POUSSIÈRE : particules dans le volume du tunnel ---------------------
  private _buildDust() {
    const slots = new Float32Array(DUST_N);
    const angles = new Float32Array(DUST_N);
    const seeds = new Float32Array(DUST_N); // rayon relatif intérieur
    for (let i = 0; i < DUST_N; i++) {
      slots[i] = Math.random();
      angles[i] = Math.random() * Math.PI * 2;
      seeds[i] = 0.15 + Math.random() * 0.75;
    }
    this.group.add(
      new THREE.Points(this._geo(DUST_N, slots, angles, seeds, null), this._dustMaterial())
    );
  }

  // --- NOYAUX : anneaux-portes à traverser (le but du jeu) -----------------
  private _buildCores() {
    // géométrie partagée : double cercle (porte) + croix centrale
    const pts: number[] = [];
    const SEG = 36;
    for (const rad of [0.5, 0.34]) {
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * Math.PI * 2;
        const a1 = ((i + 1) / SEG) * Math.PI * 2;
        pts.push(Math.cos(a0) * rad, Math.sin(a0) * rad, 0);
        pts.push(Math.cos(a1) * rad, Math.sin(a1) * rad, 0);
      }
    }
    pts.push(-0.1, 0, 0, 0.1, 0, 0, 0, -0.1, 0, 0, 0.1, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));

    for (let i = 0; i < CORE_N; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const obj = new THREE.Group();
      obj.add(new THREE.LineSegments(geo, mat));
      this.group.add(obj);
      const core: Core = { A: 0, ox: 0, oy: 0, phase: Math.random() * 10, obj, mat };
      this._spawnCore(core, 0.4 + (i / CORE_N) * 0.6);
      this.cores.push(core);
    }
  }

  private _spawnCore(core: Core, aheadMin = 0.55) {
    core.A = this.uniforms.uDist.value + aheadMin + Math.random() * 0.4;
    const ang = Math.random() * Math.PI * 2;
    const rad = 0.2 + Math.random() * 1.2; // reste dans le tunnel (RADIUS 2.4)
    core.ox = Math.cos(ang) * rad;
    core.oy = Math.sin(ang) * rad;
  }

  private _updateCores(t: number, dt: number) {
    const u = this.uniforms;
    // position du "vaisseau" dans le plan du tunnel (miroir de la caméra)
    const px = this.steer.x * 0.5;
    const py = this.steer.y * 0.35 + 0.05;

    for (const core of this.cores) {
      const s = core.A - u.uDist.value;

      if (s <= 0.015) {
        // le noyau franchit le plan caméra : touché ou raté ?
        const d = Math.hypot(core.ox - px, core.oy - py);
        if (d < 0.72) {
          this.score++;
          this.combo++;
          u.uFlash.value = 1; // impulsion lumineuse dans tout le tunnel
        } else {
          this.combo = 0;
        }
        this._updateHudScore();
        this._spawnCore(core);
        continue;
      }

      // même déformation que le tunnel pour rester cohérent visuellement
      const c = curveJS(core.A, this._c3).sub(curveJS(u.uDist.value, this._c4));
      core.obj.position.set(
        c.x + this.steer.x * s * s * 2.2 + core.ox,
        c.y + this.steer.y * s * s * 2.2 + core.oy,
        5 - s * LEN
      );
      const pulse = 1 + Math.sin(t * 5 + core.phase) * 0.08;
      core.obj.scale.setScalar(pulse);
      core.obj.rotation.z = t * 0.6 + core.phase;
      const near = 1 - s;
      core.mat.opacity = clamp((1 - s) * 1.6, 0, 1) * (0.35 + 0.6 * near * near);
    }
  }

  private _updateHudScore() {
    if (this.scoreEl) this.scoreEl.textContent = String(this.score);
    if (this.comboEl) this.comboEl.textContent = "x" + this.combo;
  }

  private _geo(
    count: number,
    slots: Float32Array,
    angles: Float32Array,
    seeds: Float32Array,
    ends: Float32Array | null
  ) {
    const geo = new THREE.BufferGeometry();
    // position requise par Three mais recalculée entièrement dans le shader.
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aSlot", new THREE.BufferAttribute(slots, 1));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    if (ends) geo.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -LEN / 2), LEN);
    return geo;
  }

  private _ringMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${TUNNEL_GLSL}
        attribute float aSlot;
        attribute float aAngle;
        attribute float aSeed;
        void main() {
          float s = fract(aSlot - uDist);
          float A = uDist + s;
          vS = s;
          // ondes de lumière qui remontent le tunnel vers la caméra
          vPulse = 0.5 + 0.5 * sin(A * 40.0 + uTime * 2.5);
          float r = RADIUS * (1.0
            + 0.05 * sin(aAngle * 5.0 + A * 30.0 + uTime * 0.4)
            + 0.04 * sin(aAngle * 9.0 - A * 47.0 + aSeed));
          vec2 c = curve(A) - curve(uDist) + uSteer * s * s * 2.2;
          vec3 p = vec3(cos(aAngle) * r + c.x, sin(aAngle) * r + c.y, 5.0 - s * LEN);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${TUNNEL_GLSL}
        void main() {
          float fadeNear = smoothstep(0.0, 0.03, vS);
          float fadeFar = smoothstep(1.0, 0.8, vS);
          float near = 1.0 - vS;
          float a = fadeNear * fadeFar
                  * (0.04 + 0.07 * vPulse + 0.22 * near * near)
                  * (1.0 + 0.5 * uBoost + 0.8 * uFlash);
          float b = 0.5 + 0.35 * vPulse + 0.3 * near + 0.5 * uFlash;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
  }

  private _streakMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${TUNNEL_GLSL}
        attribute float aSlot;
        attribute float aAngle;
        attribute float aSeed;
        attribute float aEnd;
        void main() {
          // la traînée s'étire avec le boost
          float stretch = 0.006 + uBoost * 0.022;
          float s = fract(aSlot - uDist) + aEnd * stretch;
          float A = uDist + s;
          vS = s;
          vPulse = 1.0;
          float r = RADIUS * aSeed;
          vec2 c = curve(A) - curve(uDist) + uSteer * s * s * 2.2;
          vec3 p = vec3(cos(aAngle) * r + c.x, sin(aAngle) * r + c.y, 5.0 - s * LEN);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${TUNNEL_GLSL}
        void main() {
          float fadeNear = smoothstep(0.0, 0.03, vS);
          float fadeFar = smoothstep(1.0, 0.8, vS);
          float near = 1.0 - vS;
          float a = fadeNear * fadeFar * (0.06 + 0.2 * near * near) * (0.7 + 0.8 * uBoost);
          gl_FragColor = vec4(vec3(0.75), a);
        }
      `,
    });
  }

  private _dustMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${TUNNEL_GLSL}
        uniform float uDpr;
        attribute float aSlot;
        attribute float aAngle;
        attribute float aSeed;
        void main() {
          float s = fract(aSlot - uDist);
          float A = uDist + s;
          vS = s;
          vPulse = 0.5 + 0.5 * sin(A * 40.0 + uTime * 2.5);
          float r = RADIUS * aSeed;
          vec2 c = curve(A) - curve(uDist) + uSteer * s * s * 2.2;
          vec3 p = vec3(cos(aAngle) * r + c.x, sin(aAngle) * r + c.y, 5.0 - s * LEN);
          float near = 1.0 - s;
          gl_PointSize = (0.7 + near * 2.4 + uBoost * 1.2) * uDpr;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${TUNNEL_GLSL}
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (length(uv) > 0.5) discard;
          float fadeNear = smoothstep(0.0, 0.02, vS);
          float fadeFar = smoothstep(1.0, 0.75, vS);
          float near = 1.0 - vS;
          float a = fadeNear * fadeFar * (0.1 + 0.3 * near * near + 0.08 * vPulse);
          gl_FragColor = vec4(vec3(0.85), a);
        }
      `,
    });
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.boosting = false;
    this.steer.set(0, 0);
    this.speed = 0;
    this.score = 0;
    this.combo = 0;
    this._updateHudScore();
    for (let i = 0; i < this.cores.length; i++) {
      this._spawnCore(this.cores[i], 0.4 + (i / CORE_N) * 0.6);
    }

    this.savedCam.pos.copy(this.stage.camera.position);
    this.savedCam.quat.copy(this.stage.camera.quaternion);
    this.savedCam.fov = this.stage.camera.fov;

    this.orb.group.visible = false;
    this.group.visible = true;
    document.body.classList.add("diving");
    this.hud?.classList.remove("dive-hud--hidden");
    this.orb.freezeForDive();

    this.introEl?.classList.add("dive-hud__intro--show");
    setTimeout(() => this.introEl?.classList.remove("dive-hud__intro--show"), 5000);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.boosting = false;

    this.group.visible = false;
    this.orb.group.visible = true;
    document.body.classList.remove("diving");
    this.hud?.classList.add("dive-hud--hidden");

    const cam = this.stage.camera;
    cam.position.copy(this.savedCam.pos);
    cam.quaternion.copy(this.savedCam.quat);
    cam.fov = this.savedCam.fov;
    cam.up.set(0, 1, 0);
    cam.updateProjectionMatrix();
    this.orb.resumeAfterDive();
  }

  update(t: number, dt: number, pointer: THREE.Vector2) {
    if (!this.active) return;

    const u = this.uniforms;
    u.uTime.value = t;
    u.uDpr.value = this.stage.dpr;

    // vitesse : croisière lente et régulière, boost au clic maintenu,
    // et bonus qui grimpe avec le combo (récompense = accélération).
    const boostTarget = this.boosting ? 1 : 0;
    u.uBoost.value += (boostTarget - u.uBoost.value) * Math.min(1, dt * 4);
    const comboBonus = Math.min(this.combo, 12) * 0.012;
    const targetSpeed = 0.16 + u.uBoost.value * 0.42 + comboBonus; // slots/s
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 2.5);
    u.uDist.value += this.speed * dt;

    // flash de capture : montée instantanée, retombée douce
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 2.2);

    // dérive : la souris tire doucement la trajectoire.
    this.steer.x += (pointer.x * 0.9 - this.steer.x) * Math.min(1, dt * 3);
    this.steer.y += (pointer.y * 0.7 - this.steer.y) * Math.min(1, dt * 3);
    u.uSteer.value.copy(this.steer);

    // caméra : respiration + roulis lent (le coeur de l'hypnose) + regard
    // vers le virage qui arrive.
    const cam = this.stage.camera;
    const roll = Math.sin(t * 0.12) * 0.09 + this.steer.x * 0.16;
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.position.set(
      this.steer.x * 0.5 + Math.sin(t * 0.4) * 0.04,
      this.steer.y * 0.35 + 0.05 + Math.cos(t * 0.31) * 0.03,
      6
    );
    const ahead = curveJS(u.uDist.value + 0.22, this._c1)
      .sub(curveJS(u.uDist.value, this._c2));
    cam.lookAt(
      ahead.x * 0.55 + this.steer.x * 1.3,
      ahead.y * 0.55 + this.steer.y * 0.9,
      -9
    );
    // boost : le champ de vision s'ouvre (effet warp).
    cam.fov += (this.savedCam.fov + u.uBoost.value * 16 - cam.fov) * Math.min(1, dt * 5);
    cam.updateProjectionMatrix();

    this._updateCores(t, dt);

    if (this.speedEl) this.speedEl.textContent = String(Math.round(this.speed * LEN));
    if (this.distEl) this.distEl.textContent = String(Math.round(u.uDist.value * LEN));
  }
}
