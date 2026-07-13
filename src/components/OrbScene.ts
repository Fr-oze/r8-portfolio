import * as THREE from "three";
import type { Stage } from "../core/Stage";

// =====================================================================
// ORB SCENE — disque organique (réf. image) : trou central + anneaux
// concentriques en perspective + voiles de flux. Plat mais pas 2D :
// léger relief Z, parallaxe souris, tilt discret.
// =====================================================================

export const R_VOID = 0.14;
export const R_MAX = 2.45;
export const PEAK_N = 22; // pics de terrain (mode vaisseau)
const CONCENTRIC = 58;
const RING_SEGS = 128;
const FLOW_LINES = 72;
const FLOW_SEGS = 96;
const POINT_COUNT = 22000;

const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

const SHARED_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uScan;
  uniform float uBand;
  uniform vec3  uMouse;
  uniform float uGlow;
  uniform float uMaster;           // fondu global de l'orbe
  uniform float uTerrain;          // 0 = disque plat, 1 = montagnes levées
  uniform vec4  uPeaks[PEAK_N];    // xy = centre local, z = hauteur, w = largeur
  varying float vReveal;
  varying float vFront;
  varying float vMouse;
  varying float vR;
  varying float vPeak;             // 0..1 : altitude terrain (éclaire les sommets)
`;

const DISPLACE_GLSL = /* glsl */ `
  // Relief "montagnes" : somme de bosses gaussiennes. La même formule est
  // recalculée en JS (OrbFlightMode) pour les collisions du vaisseau.
  float terrainH(vec2 q) {
    float h = 0.0;
    for (int i = 0; i < PEAK_N; i++) {
      vec2 d = q - uPeaks[i].xy;
      float w = uPeaks[i].w;
      h += uPeaks[i].z * exp(-dot(d, d) / (w * w + 0.0001));
    }
    // les pics qui se chevauchent s'additionnent : plafond pour éviter
    // les murs infranchissables (même clamp côté JS pour les collisions)
    return min(h, 1.15);
  }

  vec3 displace(vec3 p, float seed, float kind) {
    float r = length(p.xy);
    float a = atan(p.y, p.x);
    float t = uTime * 0.11;
    float outer = smoothstep(R_VOID, R_MAX * 0.55, r);
    float wobK = 1.0 - 0.8 * uTerrain; // terrain levé => disque plus stable
    float wob = snoise(vec3(a * 2.4 + seed, r * 1.8, t)) * 0.09 * outer * wobK;
    wob += snoise(vec3(a * 5.0 - seed * 2.0, r * 3.2, t * 1.3)) * 0.04 * outer * wobK;
    float nr = r * (1.0 + wob);
    float nz = p.z;
    nz += snoise(vec3(a * 1.6, r * 2.0 + seed, t * 0.9)) * 0.06 * outer * wobK;
    vPeak = 0.0;
    if (uTerrain > 0.001) {
      float h = terrainH(vec2(cos(a), sin(a)) * nr);
      nz += h * uTerrain;
      vPeak = clamp(h * 1.4, 0.0, 1.0) * uTerrain;
    }
    return vec3(cos(a) * nr, sin(a) * nr, nz);
  }
`;

// injecté dans le shader (constantes GLSL)
const CONST_GLSL = /* glsl */ `
  #define PEAK_N ${PEAK_N}
  const float R_VOID = ${R_VOID.toFixed(3)};
  const float R_MAX = ${R_MAX.toFixed(3)};
`;

type Uniform = { value: number };

export class OrbScene {
  stage: Stage;
  group: THREE.Group;
  radius = R_MAX;
  ready = false;
  onReady: (() => void) | null = null;
  onScanComplete: (() => void) | null = null;
  onModeChange: ((label: string, idx: number) => void) | null = null;
  particleCount = 0;

  uniforms: Record<string, { value: any }>;
  private lineOpacity: Uniform = { value: 1 };
  private flowOpacity: Uniform = { value: 1 };
  private pointOpacity: Uniform = { value: 0.45 };
  private flight = false; // mode vol : voiles de flux atténués (terrain lisible)
  private modes = [
    { label: "CONCENTRIC CORE", lines: 1.0, points: 0.35 },
    { label: "FLOW FIELD", lines: 0.85, points: 0.9 },
    { label: "PARTICLE MESH", lines: 0.25, points: 1.0 },
    { label: "THIN RINGS", lines: 0.7, points: 0.15 },
  ];
  private modeIndex = 0;
  private modeTimer = 0;
  private cycling = false;
  private scanComplete = false;
  private MODE_INTERVAL = 12;

  constructor(stage: Stage) {
    this.stage = stage;
    this.group = new THREE.Group();
    // léger tilt : pas totalement face caméra
    this.group.rotation.x = -0.06;
    stage.add(this.group);

    this.uniforms = {
      uTime: { value: 0 },
      uScan: { value: -R_MAX * 1.2 },
      uScanOn: { value: 1 },
      uBand: { value: 0.08 },
      uMouse: { value: new THREE.Vector3(999, 999, 999) },
      uGlow: { value: 0.75 },
      uDpr: { value: stage.dpr },
      uPointSize: { value: 1.2 },
      uLineFraction: { value: 0.55 },
      uPointFraction: { value: 0.5 },
      uTerrain: { value: 0 },
      uMaster: { value: 1 }, // fondu global (transition mode vol)
      uPeaks: {
        value: Array.from({ length: PEAK_N }, () => new THREE.Vector4(0, 0, 0, 0.3)),
      },
    };
  }

  load() {
    this._buildConcentric();
    this._buildFlow();
    this._buildPoints();
    this.setDetail(0.35);
    this.ready = true;
    this.onReady?.();
  }

  // Anneaux concentriques : tunnel vers le trou central (z plus profond au centre).
  private _buildConcentric() {
    const rings = CONCENTRIC;
    const verts = rings * RING_SEGS * 2;
    const pos = new Float32Array(verts * 3);
    const seeds = new Float32Array(verts);
    const kinds = new Float32Array(verts);
    const rands = new Float32Array(verts);
    let w = 0;

    for (let i = 0; i < rings; i++) {
      const t = (i + 1) / rings;
      // pow > 1 : resserre les anneaux vers le centre (sinon tout se
      // concentre sur le bord extérieur de la forme).
      const r = R_VOID + (R_MAX - R_VOID) * Math.pow(t, 1.65);
      const z = -0.55 * Math.pow(1 - t, 1.6); // perspective tunnel
      const seed = i * 0.37;
      const rand = Math.random(); // culling de densité réparti, pas par zone

      for (let s = 0; s < RING_SEGS; s++) {
        for (let e = 0; e < 2; e++) {
          const a = ((s + e) / RING_SEGS) * Math.PI * 2;
          pos[w * 3] = Math.cos(a) * r;
          pos[w * 3 + 1] = Math.sin(a) * r;
          pos[w * 3 + 2] = z;
          seeds[w] = seed;
          kinds[w] = 0;
          rands[w] = rand;
          w++;
        }
      }
    }

    this.group.add(this._makeLines(pos, seeds, kinds, rands, this.lineOpacity));
  }

  // Voiles de flux : courbes radiales + arcs tangents (drapé organique).
  private _buildFlow() {
    const verts = FLOW_LINES * FLOW_SEGS * 2;
    const pos = new Float32Array(verts * 3);
    const seeds = new Float32Array(verts);
    const kinds = new Float32Array(verts);
    const rands = new Float32Array(verts);
    let w = 0;

    for (let l = 0; l < FLOW_LINES; l++) {
      const seed = l * 1.73;
      const rand = Math.random();
      const radial = l < FLOW_LINES * 0.45;
      const baseA = (l / FLOW_LINES) * Math.PI * 2;

      for (let s = 0; s < FLOW_SEGS; s++) {
        for (let e = 0; e < 2; e++) {
          const k = (s + e) / (FLOW_SEGS - 1);
          let r: number, a: number, z: number;
          if (radial) {
            r = R_VOID + (R_MAX - R_VOID) * k;
            a = baseA + Math.sin(k * 8 + seed) * 0.22;
            z = -0.12 * k + Math.sin(k * 6 + seed) * 0.08;
          } else {
            r = R_VOID + (R_MAX - R_VOID) * (0.12 + k * 0.88);
            a = baseA + k * 1.8 + Math.sin(k * 5 + seed) * 0.35;
            z = Math.sin(k * 4 + seed * 0.5) * 0.14 - 0.08;
          }
          pos[w * 3] = Math.cos(a) * r;
          pos[w * 3 + 1] = Math.sin(a) * r;
          pos[w * 3 + 2] = z;
          seeds[w] = seed;
          kinds[w] = 1;
          rands[w] = rand;
          w++;
        }
      }
    }

    this.group.add(this._makeLines(pos, seeds, kinds, rands, this.flowOpacity));
  }

  private _makeLines(
    pos: Float32Array,
    seeds: Float32Array,
    kinds: Float32Array,
    rands: Float32Array,
    opacity: Uniform
  ) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uLayerOpacity: opacity },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${NOISE_GLSL}
        ${CONST_GLSL}
        ${SHARED_GLSL}
        ${DISPLACE_GLSL}
        attribute float aSeed;
        attribute float aKind;
        attribute float aRand;
        uniform float uLineFraction;
        void main() {
          if (aRand > uLineFraction) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = displace(position, aSeed, aKind);
          vR = length(p.xy);
          vReveal = step(p.y, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(p.y - uScan));
          vec4 wp = modelMatrix * vec4(p, 1.0);
          float md = distance(wp.xy, uMouse.xy);
          float push = 1.0 - smoothstep(0.0, 2.4, md);
          vMouse = push;
          wp.xy += normalize(wp.xy - uMouse.xy + vec2(0.0001)) * push * push * 0.35;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${CONST_GLSL}
        ${SHARED_GLSL}
        uniform float uLayerOpacity;
        void main() {
          if (uLayerOpacity < 0.005) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          float core = 1.0 - smoothstep(R_VOID * 0.9, R_VOID * 2.2, vR);
          float b = (0.5 + 0.45 * vMouse + 0.7 * vFront + core * 0.15) * (0.7 + 0.6 * uGlow);
          float a = reveal * uLayerOpacity * (0.13 + 0.16 * vMouse + 0.34 * vFront) * (0.75 + 0.5 * uGlow);
          if (vR < R_VOID * 0.85) a *= 0.15;
          // sommets des montagnes éclairés (mode vaisseau)
          b += vPeak * 0.6;
          a += vPeak * 0.14 * uLayerOpacity;
          a *= uMaster;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    return new THREE.LineSegments(geo, mat);
  }

  private _buildPoints() {
    const pos = new Float32Array(POINT_COUNT * 3);
    const seeds = new Float32Array(POINT_COUNT);
    const kinds = new Float32Array(POINT_COUNT);
    const rands = new Float32Array(POINT_COUNT);

    for (let i = 0; i < POINT_COUNT; i++) {
      const t = Math.random();
      // pow > 1 : particules plus denses vers le coeur, clairsemées au bord.
      const r = R_VOID + (R_MAX - R_VOID) * Math.pow(t, 1.5);
      const a = Math.random() * Math.PI * 2;
      const z = -0.2 * (1 - t) + (Math.random() - 0.5) * 0.12;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = z;
      seeds[i] = Math.random() * 10;
      kinds[i] = 1;
      rands[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uLayerOpacity: this.pointOpacity },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${NOISE_GLSL}
        ${CONST_GLSL}
        ${SHARED_GLSL}
        ${DISPLACE_GLSL}
        attribute float aSeed;
        attribute float aKind;
        attribute float aRand;
        uniform float uPointFraction;
        uniform float uPointSize;
        uniform float uDpr;
        void main() {
          if (aRand > uPointFraction) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = displace(position, aSeed, aKind);
          p.x += sin(uTime * 0.4 + aSeed * 5.0) * 0.012;
          p.y += cos(uTime * 0.35 + aSeed * 4.0) * 0.012;
          vR = length(p.xy);
          vReveal = step(p.y, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(p.y - uScan));
          vec4 wp = modelMatrix * vec4(p, 1.0);
          float md = distance(wp.xy, uMouse.xy);
          float push = 1.0 - smoothstep(0.0, 2.2, md);
          vMouse = push;
          wp.xy += normalize(wp.xy - uMouse.xy + vec2(0.0001)) * push * push * 0.4;
          gl_PointSize = (uPointSize + vFront * 0.8 + push * 1.2) * uDpr;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${CONST_GLSL}
        ${SHARED_GLSL}
        uniform float uLayerOpacity;
        void main() {
          if (uLayerOpacity < 0.005) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          if (r > 0.5) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          float core = smoothstep(0.5, 0.32, r);
          float b = (0.6 + 0.4 * vMouse + vPeak * 0.5) * (0.7 + 0.55 * uGlow);
          float a = reveal * core * uLayerOpacity * (0.34 + 0.35 * vMouse + vPeak * 0.2) * (0.75 + 0.5 * uGlow);
          if (vR < R_VOID) a *= 0.2;
          a *= uMaster;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    this.group.add(new THREE.Points(geo, mat));
  }

  setDetail(v: number) {
    this.uniforms.uLineFraction.value = 0.4 + 0.6 * v;
    this.uniforms.uPointFraction.value = 0.18 + 0.82 * v;
    this.particleCount = Math.round(POINT_COUNT * this.uniforms.uPointFraction.value);
  }

  setMouseWorld(v: THREE.Vector3) {
    this.uniforms.uMouse.value.copy(v);
  }

  // 0 = disque plat, 1 = montagnes complètement levées (mode vaisseau).
  setTerrain(k: number) {
    this.uniforms.uTerrain.value = k;
  }

  // Fondu global (0 = invisible) — utilisé pendant la bascule vers le vol.
  setFade(v: number) {
    this.uniforms.uMaster.value = v;
    this.group.visible = v > 0.01;
  }

  // Nouvelle carte de montagnes : pics gaussiens répartis sur le disque en
  // laissant un couloir libre autour du trou central. Renvoie la liste pour
  // que le mode vol calcule les collisions côté JS.
  regeneratePeaks(): THREE.Vector4[] {
    const peaks: THREE.Vector4[] = this.uniforms.uPeaks.value;
    const talls: { a: number; r: number }[] = [];
    for (const p of peaks) {
      const a = Math.random() * Math.PI * 2;
      const r = R_MAX * (0.3 + Math.random() * 0.62);
      // certains pics dépassent l'altitude max du vaisseau : impossible de
      // tout survoler, il faut aussi esquiver latéralement.
      let height = 0.35 + Math.random() * 0.75;
      const width = 0.18 + Math.random() * 0.3;
      if (height > 0.7) {
        // deux pics infranchissables trop proches en angle bloqueraient toute
        // la bande de vol : on écrase le second en colline passable.
        const crowded = talls.some(
          (q) => Math.abs(Math.atan2(Math.sin(a - q.a), Math.cos(a - q.a))) < 0.55
        );
        if (crowded) height = 0.45 + Math.random() * 0.2;
        else talls.push({ a, r });
      }
      p.set(Math.cos(a) * r, Math.sin(a) * r, height, width);
    }
    return peaks;
  }

  freezeForFlight() {
    this.cycling = false;
    this.flight = true;
    // CONCENTRIC CORE : le mode le plus lisible pour jouer.
    this.modeIndex = 0;
    this.onModeChange?.("FLIGHT MODE", -1);
  }

  resumeAfterFlight() {
    this.cycling = true;
    this.flight = false;
    this.modeTimer = 0;
    this._applyMode(this.modeIndex);
  }

  private _applyMode(i: number) {
    this.modeIndex = (i + this.modes.length) % this.modes.length;
    this.onModeChange?.(this.modes[this.modeIndex].label, this.modeIndex);
  }

  // Contrôle manuel (bouton MODE) : passe au mode suivant et coupe le cyclage
  // auto — l'utilisateur a pris la main.
  cycleMode(): string {
    this.cycling = false;
    this._applyMode(this.modeIndex + 1);
    return this.modes[this.modeIndex].label;
  }

  update(t: number, dt: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uDpr.value = this.stage.dpr;
    if (!this.ready) return;

    if (this.uniforms.uScanOn.value > 0.5) {
      const span = R_MAX * 2.8;
      this.uniforms.uScan.value += (span / 2.4) * dt;
      if (this.uniforms.uScan.value >= R_MAX * 1.3) {
        this.uniforms.uScanOn.value = 0;
        if (!this.scanComplete) {
          this.scanComplete = true;
          this.onScanComplete?.();
          this.cycling = true;
          this._applyMode(0);
        }
      }
    }

    if (this.cycling) {
      this.modeTimer += dt;
      if (this.modeTimer >= this.MODE_INTERVAL) {
        this.modeTimer = 0;
        this._applyMode(this.modeIndex + 1);
      }
    }
    const m = this.modes[this.modeIndex];
    const k = Math.min(1, dt * 1.6);
    const flowTarget = this.flight ? 0.12 : m.lines;
    this.lineOpacity.value += (m.lines - this.lineOpacity.value) * k;
    this.flowOpacity.value += (flowTarget - this.flowOpacity.value) * k;
    this.pointOpacity.value += (m.points - this.pointOpacity.value) * k;
  }
}
