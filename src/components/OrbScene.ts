import * as THREE from "three";
import type { Stage } from "../core/Stage";

// =====================================================================
// ORB SCENE — sphère organique : voiles de lignes de flux + particules,
// déformés par un bruit simplex animé (mouvement de tissu), répulsion
// souris, révélation par scan vertical (même langage que l'ancien hero).
// =====================================================================

const RADIUS = 2.1;
const RING_COUNT = 150;
const RING_SEGMENTS = 200;
const POINT_COUNT = 26000;

// Bruit simplex 3D (Ashima / Ian McEwan, domaine public).
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

// Uniforms + varyings partagés lignes/points (vertex ET fragment).
const SHARED_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uScan;    // hauteur du front de révélation (Y local)
  uniform float uBand;    // épaisseur de la ligne du front
  uniform vec3  uMouse;   // souris en coordonnées monde
  uniform float uGlow;
  varying float vReveal;
  varying float vFront;
  varying float vMouse;
`;

// Déformation "voile" (vertex uniquement, dépend de snoise) : deux octaves de
// bruit déplacent le rayon + un léger glissement tangentiel. C'est ce qui donne
// le froissé organique de la sphère.
const DISPLACE_GLSL = /* glsl */ `
  vec3 displace(vec3 p, float seed) {
    vec3 n = normalize(p);
    float t = uTime * 0.13;
    float d1 = snoise(n * 1.1 + vec3(t, t * 0.7, seed * 3.1));
    float d2 = snoise(n * 2.6 - vec3(t * 1.4, seed, t * 0.9));
    float r = length(p) + d1 * 0.40 + d2 * 0.13;
    vec3 q = n * r;
    q += vec3(-n.z, 0.0, n.x) * d2 * 0.18;
    return q;
  }
`;

type Uniform = { value: number };

export class OrbScene {
  stage: Stage;
  group: THREE.Group;
  radius = RADIUS;
  ready = false;
  onReady: (() => void) | null = null;
  onScanComplete: (() => void) | null = null;
  onModeChange: ((label: string, idx: number) => void) | null = null;
  particleCount = 0;

  uniforms: Record<string, { value: any }>;
  private lineOpacity: Uniform = { value: 1 };
  private pointOpacity: Uniform = { value: 0.3 };

  // Modes cyclés (cibles d'opacité lignes/points) pour garder le HUD vivant.
  private modes = [
    { label: "FLOW WEAVE", lines: 1.0, points: 0.3 },
    { label: "FULL FIELD", lines: 0.8, points: 1.0 },
    { label: "PARTICLE CLOUD", lines: 0.1, points: 1.0 },
    { label: "THIN LINES", lines: 0.55, points: 0.12 },
  ];
  private modeIndex = 0;
  private modeTimer = 0;
  private cycling = false;
  private scanComplete = false;
  private MODE_INTERVAL = 12;

  constructor(stage: Stage) {
    this.stage = stage;
    this.group = new THREE.Group();
    stage.add(this.group);

    this.uniforms = {
      uTime: { value: 0 },
      uScan: { value: -RADIUS * 1.6 },
      uScanOn: { value: 1 },
      uBand: { value: 0.09 },
      uMouse: { value: new THREE.Vector3(999, 999, 999) },
      uGlow: { value: 0.3 },
      uDpr: { value: stage.dpr },
      uPointSize: { value: 1.4 },
      uLineFraction: { value: 0.5 },
      uPointFraction: { value: 0.5 },
    };
  }

  load() {
    this._buildLines();
    this._buildPoints();
    this.setDetail(0.35);
    this.ready = true;
    this.onReady?.();
  }

  // --- VOILES DE LIGNES ------------------------------------------------------
  // Grands cercles orientés aléatoirement sur la sphère, concaténés en un seul
  // LineSegments (un draw call). Le vertex shader les froisse avec le bruit.
  private _buildLines() {
    const verts = RING_COUNT * RING_SEGMENTS * 2;
    const pos = new Float32Array(verts * 3);
    const seeds = new Float32Array(verts);
    const rands = new Float32Array(verts);

    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const axis = new THREE.Vector3();
    let w = 0;

    for (let r = 0; r < RING_COUNT; r++) {
      const seed = Math.random() * 10;
      const rand = Math.random();
      const rr = RADIUS * (0.86 + Math.random() * 0.22);
      // orientation uniforme du plan de l'anneau
      axis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      q.setFromAxisAngle(axis, Math.random() * Math.PI * 2);

      for (let s = 0; s < RING_SEGMENTS; s++) {
        for (let e = 0; e < 2; e++) {
          const a = ((s + e) / RING_SEGMENTS) * Math.PI * 2;
          v.set(Math.cos(a) * rr, Math.sin(a) * rr, 0).applyQuaternion(q);
          pos[w * 3] = v.x;
          pos[w * 3 + 1] = v.y;
          pos[w * 3 + 2] = v.z;
          seeds[w] = seed;
          rands[w] = rand;
          w++;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uLayerOpacity: this.lineOpacity },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${NOISE_GLSL}
        ${SHARED_GLSL}
        ${DISPLACE_GLSL}
        attribute float aSeed;
        attribute float aRand;
        uniform float uLineFraction;
        void main() {
          if (aRand > uLineFraction) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = displace(position, aSeed);
          vReveal = step(p.y, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(p.y - uScan));
          vec4 wp = modelMatrix * vec4(p, 1.0);
          float md = distance(wp.xyz, uMouse);
          float push = 1.0 - smoothstep(0.0, 2.1, md);
          vMouse = push;
          wp.xyz += normalize(wp.xyz - uMouse + vec3(0.0001)) * push * push * 0.5;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${SHARED_GLSL}
        uniform float uLayerOpacity;
        void main() {
          if (uLayerOpacity < 0.005) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          float b = (0.55 + 0.5 * vMouse + 0.8 * vFront) * (0.75 + 0.5 * uGlow);
          float a = reveal * uLayerOpacity * (0.11 + 0.16 * vMouse + 0.4 * vFront);
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });

    this.group.add(new THREE.LineSegments(geo, mat));
  }

  // --- PARTICULES --------------------------------------------------------------
  private _buildPoints() {
    const pos = new Float32Array(POINT_COUNT * 3);
    const seeds = new Float32Array(POINT_COUNT);
    const rands = new Float32Array(POINT_COUNT);
    const v = new THREE.Vector3();

    for (let i = 0; i < POINT_COUNT; i++) {
      // point uniforme sur la sphère, rayon légèrement dispersé
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (v.lengthSq() < 0.0001) v.set(0, 1, 0);
      v.normalize().multiplyScalar(RADIUS * (0.88 + Math.random() * 0.2));
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      seeds[i] = Math.random() * 10;
      rands[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uLayerOpacity: this.pointOpacity },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${NOISE_GLSL}
        ${SHARED_GLSL}
        ${DISPLACE_GLSL}
        attribute float aSeed;
        attribute float aRand;
        uniform float uPointFraction;
        uniform float uPointSize;
        uniform float uDpr;
        void main() {
          if (aRand > uPointFraction) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = displace(position, aSeed);
          // dérive lente propre à chaque particule (vie dans le nuage)
          p.x += sin(uTime * 0.5 + aSeed * 6.0) * 0.02;
          p.y += cos(uTime * 0.45 + aSeed * 4.0) * 0.02;
          vReveal = step(p.y, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(p.y - uScan));
          vec4 wp = modelMatrix * vec4(p, 1.0);
          float md = distance(wp.xyz, uMouse);
          float push = 1.0 - smoothstep(0.0, 2.1, md);
          vMouse = push;
          wp.xyz += normalize(wp.xyz - uMouse + vec3(0.0001)) * push * push * 0.6;
          gl_PointSize = (uPointSize + vFront * 1.0 + push * 1.6) * uDpr;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${SHARED_GLSL}
        uniform float uLayerOpacity;
        void main() {
          if (uLayerOpacity < 0.005) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          if (r > 0.5) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          float core = smoothstep(0.5, 0.3, r);
          float b = (0.55 + 0.45 * vMouse + 0.5 * vFront) * (0.75 + 0.5 * uGlow);
          float a = reveal * core * uLayerOpacity * (0.35 + 0.4 * vMouse);
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });

    this.group.add(new THREE.Points(geo, mat));
  }

  // Slider densité (0..1) : fraction de lignes et de particules affichées.
  setDetail(v: number) {
    this.uniforms.uLineFraction.value = 0.35 + 0.65 * v;
    this.uniforms.uPointFraction.value = 0.15 + 0.85 * v;
    this.particleCount = Math.round(POINT_COUNT * this.uniforms.uPointFraction.value);
  }

  setMouseWorld(v: THREE.Vector3) {
    this.uniforms.uMouse.value.copy(v);
  }

  private _applyMode(i: number) {
    this.modeIndex = (i + this.modes.length) % this.modes.length;
    this.onModeChange?.(this.modes[this.modeIndex].label, this.modeIndex);
  }

  update(t: number, dt: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uDpr.value = this.stage.dpr;
    if (!this.ready) return;

    // Révélation par scan (bas → haut) sur ~2.4 s.
    if (this.uniforms.uScanOn.value > 0.5) {
      const span = RADIUS * 3.2;
      this.uniforms.uScan.value += (span / 2.4) * dt;
      if (this.uniforms.uScan.value >= RADIUS * 1.6) {
        this.uniforms.uScanOn.value = 0;
        if (!this.scanComplete) {
          this.scanComplete = true;
          this.onScanComplete?.();
          this.cycling = true;
          this._applyMode(0);
        }
      }
    }

    // Cycle des modes + fondu doux vers les cibles d'opacité.
    if (this.cycling) {
      this.modeTimer += dt;
      if (this.modeTimer >= this.MODE_INTERVAL) {
        this.modeTimer = 0;
        this._applyMode(this.modeIndex + 1);
      }
    }
    const m = this.modes[this.modeIndex];
    const k = Math.min(1, dt * 1.6);
    this.lineOpacity.value += (m.lines - this.lineOpacity.value) * k;
    this.pointOpacity.value += (m.points - this.pointOpacity.value) * k;
  }
}
