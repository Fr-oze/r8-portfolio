import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// =====================================================================
// PORTRAIT SCENE — modèle 3D (toi) en DATA/WIREFRAME, façon R8 :
//   · COQUE pleine (volume, occlusion → pas de zones noires vides)
//   · ARÊTES + TRIANGULATION dont la densité VARIE selon les zones
//     (certaines zones n'ont que des triangles, d'autres surtout des arêtes…)
//   · POINTS répartis en patches animés par le bruit
// Orientation pilotée par un groupe dédié (sliers de réglage), la souris ne
// gère qu'un léger mouvement de parallaxe.
// =====================================================================
const MODEL_URL = "/model/portrait.glb";

// Bruit/zones partagés. `field(pos, seed)` = bruit lisse 0..1 grande échelle qui
// découpe l'espace en régions ; on s'en sert pour faire varier la densité de
// chaque couche d'un endroit à l'autre.
const DIV_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3  uHalf;     // demi-dimensions du modèle (~ -1..1)
  uniform float uReveal;   // 0..1 fondu d'apparition
  uniform vec3  uMouse;    // souris projetée dans la scène
  uniform float uMouseR;   // rayon d'influence souris
  uniform float uPresLo;   // seuil bas trous noirs
  uniform float uPresHi;   // seuil haut trous noirs
  uniform float uDensFloor;// densité mini (zones quasi vides)
  uniform float uDensLo;   // seuil bas bascule dense/vide
  uniform float uDensHi;   // seuil haut bascule dense/vide
  varying float vMouse;    // proximité souris 0..1
  varying float vAmt;      // intensité de la couche pour ce sommet
  varying float vDepth;    // profondeur écran (pour l'atténuation lointaine)
  varying float vPres;     // présence (0 = trou noir, 1 = zone remplie)

  float field(vec3 pos, float seed) {
    vec3 n = pos / max(uHalf, vec3(0.001));
    float v = sin(n.x * 2.3 + seed * 1.7 + uTime * 0.16)
            + sin(n.y * 2.0 - seed * 1.1 - uTime * 0.13)
            + sin(n.z * 2.6 + seed * 2.3 + uTime * 0.11)
            + sin((n.x + n.y + n.z) * 1.5 + seed);
    return clamp(v * 0.25 * 0.5 + 0.5, 0.0, 1.0);
  }

  // Macro-zones TRANCHÉES : un même champ découpe le modèle en 3 territoires
  // qui se déplacent → ARÊTES / TRIANGLES / POINTS. Frontières NETTES + des
  // creux entre les bandes : par endroits il n'y a presque rien (la coque
  // garde la silhouette). C'est le mélange prononcé voulu.
  float macro(vec3 pos) { return field(pos, 2.0); }

  float edgeRegion(vec3 pos) {
    return 1.0 - smoothstep(0.34, 0.40, macro(pos));
  }
  float triRegion(vec3 pos) {
    float m = macro(pos);
    return smoothstep(0.46, 0.52, m) * (1.0 - smoothstep(0.66, 0.72, m));
  }
  float pointRegion(vec3 pos) {
    return smoothstep(0.76, 0.82, macro(pos));
  }

  // PRÉSENCE : grandes zones soit pleines (1) soit COMPLÈTEMENT vides (0, trou
  // noir). C'est ça le gros contraste : ~45% du modèle est effacé, coque
  // comprise. Transition franche pour des bords de trous bien marqués.
  float presence(vec3 pos) {
    float f = field(pos, 5.0) * 0.65 + field(pos, 12.0) * 0.35;
    // trous noirs PETITS et rares : seulement là où le bruit plonge vraiment bas.
    return smoothstep(uPresLo, uPresHi, f);
  }

  // DENSITÉ par zone, à fort contraste : un territoire est soit ULTRA DENSE
  // (≈1.0 → on garde tous les segments, des milliers), soit QUASI VIDE
  // (≈0.03 → on n'en garde qu'une poignée, ~100). Transition nette entre les
  // deux. Chaque couche utilise un seed différent → la zone dense d'arêtes
  // n'est pas la même que la zone dense de triangles.
  float densBand(vec3 pos, float seed) {
    float m = field(pos, seed);
    return mix(uDensFloor, 1.0, smoothstep(uDensLo, uDensHi, m));
  }

  // Sous-texture fine pour pailleter les points dans leur zone.
  float pointPatch(vec3 pos) {
    vec3 n = pos / max(uHalf, vec3(0.001));
    float a = sin(n.x * 4.2 + uTime * 0.45);
    float b = sin(n.y * 3.7 - uTime * 0.38);
    float c = sin(n.z * 4.6 + uTime * 0.30);
    float f = (a * b + b * c + c * a) / 3.0;
    return f * 0.5 + 0.5;
  }

  // Atténuation profondeur : 1 près de la caméra (z≈4) → ~0.35 au fond (z≈6.8).
  float depthFade(float d) { return mix(0.35, 1.0, clamp((6.8 - d) / 2.6, 0.0, 1.0)); }
`;

export class PortraitScene {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  dpr: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  orient: THREE.Group;
  uniforms: Record<string, { value: any }>;
  pointer: THREE.Vector2;
  ndc: THREE.Vector2;
  hasPointer: boolean;
  raycaster: THREE.Raycaster;
  plane: THREE.Plane;
  private _mouseWorld: THREE.Vector3;
  ready: boolean;
  raf: number;
  private _running: boolean;
  private _clock: THREE.Clock;
  composer: any;
  bloom: any;
  mergedGeo!: THREE.BufferGeometry;
  denseGeo!: THREE.BufferGeometry;
  shell!: THREE.Mesh;
  edges!: THREE.LineSegments;
  tris!: THREE.LineSegments;
  points!: THREE.Points;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 0, 5.4);

    // group = parallaxe souris · orient = orientation réglable du modèle.
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.orient = new THREE.Group();
    this.group.add(this.orient);

    this.uniforms = {
      uTime: { value: 0 },
      uHalf: { value: new THREE.Vector3(1, 1, 1) },
      uReveal: { value: 0 },
      uDpr: { value: this.dpr },
      uPointSize: { value: 2.4 },
      uMouse: { value: new THREE.Vector3(999, 999, 999) },
      uMouseR: { value: 0.75 },
      uPresLo: { value: 0.17 },
      uPresHi: { value: 0.37 },
      uDensFloor: { value: 0.165 },
      uDensLo: { value: 0.57 },
      uDensHi: { value: 0.64 },
    };

    this.pointer = new THREE.Vector2(0, 0);
    this.ndc = new THREE.Vector2(0, 0);
    this.hasPointer = false;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._mouseWorld = new THREE.Vector3(999, 999, 999);

    this.ready = false;
    this.raf = 0;
    this._running = false;
    this._clock = new THREE.Clock();

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.dpr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.54, 0.4, 0.7);
    this.composer.addPass(this.bloom);

    this.resize();
  }

  _collect(root: THREE.Object3D) {
    const geos: THREE.BufferGeometry[] = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      let g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      const ng = g.index ? g.toNonIndexed() : g;
      const only = new THREE.BufferGeometry();
      only.setAttribute("position", (ng.getAttribute("position") as THREE.BufferAttribute).clone());
      geos.push(only);
      g.dispose();
    });
    return geos.length ? BufferGeometryUtils.mergeGeometries(geos, false) : null;
  }

  load() {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => this._build(gltf.scene),
      undefined,
      () => {
        const demo = new THREE.Group();
        demo.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 4)));
        this._build(demo);
      }
    );
  }

  _build(root: THREE.Object3D) {
    const merged = this._collect(root);
    if (!merged) return;

    merged.computeBoundingBox();
    const bb = merged.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const scale = 2.6 / Math.max(size.x, size.y, size.z);
    merged.translate(-center.x, -center.y, -center.z);
    merged.scale(scale, scale, scale);
    merged.computeBoundingBox();
    const half = new THREE.Vector3();
    merged.boundingBox.getSize(half).multiplyScalar(0.5);
    this.uniforms.uHalf.value.copy(half);
    this.mergedGeo = merged;

    // Tessellation : subdivise les GRANDS triangles plats (t-shirt, joues…) en
    // plein de petits → beaucoup plus d'arêtes/triangles dans les zones lisses.
    // Les zones déjà denses ont des arêtes courtes → laissées telles quelles.
    let dense = merged;
    try {
      const tess = new TessellateModifier(0.06, 8);
      dense = tess.modify(merged.clone());
    } catch (e) {
      dense = merged;
    }
    this.denseGeo = dense;

    this._buildShell(merged);
    this._buildTris(dense);          // triangulation sur le maillage subdivisé
    this._buildEdges(merged, 12);    // arêtes vives structurelles (visage, plis)
    this._buildPoints(dense, 13000); // points = accent, pas la couche dominante

    this.ready = true;
  }

  // Attribut aRand : une valeur 0..1 par SEGMENT (mêmes 2 sommets) → permet de
  // garder/jeter des segments selon une densité locale (variation par zone).
  // aAnchor : la position du 1er sommet du segment, recopiée sur les DEUX
  // sommets. La décision garder/jeter doit se faire sur ce point commun, sinon
  // une extrémité peut être gardée et l'autre jetée → trait fantôme qui file
  // hors écran.
  _withRand(geo: THREE.BufferGeometry) {
    const pos = geo.getAttribute("position");
    const rnd = new Float32Array(pos.count);
    const anchor = new Float32Array(pos.count * 3);
    const seg: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const s = i >> 1;
      if (seg[s] === undefined) seg[s] = Math.random();
      rnd[i] = seg[s];
    }
    for (let a = 0; a < pos.count; a += 2) {
      const ax = pos.getX(a);
      const ay = pos.getY(a);
      const az = pos.getZ(a);
      for (let k = 0; k < 2 && a + k < pos.count; k++) {
        const vi = a + k;
        anchor[vi * 3] = ax;
        anchor[vi * 3 + 1] = ay;
        anchor[vi * 3 + 2] = az;
      }
    }
    geo.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    geo.setAttribute("aAnchor", new THREE.BufferAttribute(anchor, 3));
    return geo;
  }

  _lineMaterial(vertex: string, fragment: string) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: vertex,
      fragmentShader: fragment,
    });
  }

  // --- COQUE PLEINE --------------------------------------------------------
  _buildShell(merged: THREE.BufferGeometry) {
    const geo = merged.clone();
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms },
      transparent: true,
      depthWrite: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${DIV_GLSL}
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = mat3(modelMatrix) * normal;
          vV = cameraPosition - wp.xyz;
          vec4 mv = viewMatrix * wp;
          vDepth = -mv.z;
          vPres = presence(position);
          vec4 mM = viewMatrix * vec4(uMouse, 1.0);
          vMouse = 1.0 - smoothstep(0.0, uMouseR, length(mv.xy - mM.xy));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${DIV_GLSL}
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          // trou noir : la coque disparaît là où la présence est faible.
          if (vPres < 0.04) discard;
          float ndv = abs(dot(normalize(vN), normalize(vV)));
          float fres = pow(1.0 - ndv, 3.0);
          float df = depthFade(vDepth);
          float b = (0.04 + 0.6 * fres + 0.3 * vMouse) * df;
          float a = (0.42 + 0.5 * fres) * uReveal * df * vPres;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    this.shell = new THREE.Mesh(geo, mat);
    this.shell.renderOrder = -1;
    this.orient.add(this.shell);
  }

  // --- ARÊTES VIVES (toutes les arêtes structurelles, densité variable) ------
  _buildEdges(merged: THREE.BufferGeometry, threshold = 12) {
    const eg = this._withRand(new THREE.EdgesGeometry(merged, threshold));
    const mat = this._lineMaterial(
      /* glsl */ `
        ${DIV_GLSL}
        attribute float aRand;
        attribute vec3 aAnchor;
        void main() {
          vec3 p = position;
          // densité d'arêtes très variable selon la zone (dense vs quasi vide).
          // décision prise sur l'ancrage commun → les 2 extrémités sont d'accord.
          float keep = presence(aAnchor) * densBand(aAnchor, 1.5);
          vAmt = keep;
          vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
          vDepth = -mv.z;
          vec4 mM = viewMatrix * vec4(uMouse, 1.0);
          vMouse = 1.0 - smoothstep(0.0, uMouseR, length(mv.xy - mM.xy));
          if (aRand > keep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          gl_Position = projectionMatrix * mv;
        }
      `,
      /* glsl */ `
        precision highp float;
        ${DIV_GLSL}
        void main() {
          float df = depthFade(vDepth);
          float b = (0.78 + 0.5 * vMouse) * df;
          float a = (0.55 + 0.3 * vMouse) * uReveal * df;
          gl_FragColor = vec4(vec3(b), clamp(a, 0.0, 1.0));
        }
      `
    );
    this.edges = new THREE.LineSegments(eg, mat);
    this.orient.add(this.edges);
  }

  // --- TRIANGULATION (dense dans les zones "triangles", éparse ailleurs) -----
  _buildTris(merged: THREE.BufferGeometry) {
    const wg = this._withRand(new THREE.WireframeGeometry(merged));
    const mat = this._lineMaterial(
      /* glsl */ `
        ${DIV_GLSL}
        attribute float aRand;
        attribute vec3 aAnchor;
        void main() {
          vec3 p = position;
          // densité de triangles très variable : ~5k ici, ~100 là (seed propre).
          // décision prise sur l'ancrage commun → les 2 extrémités sont d'accord.
          float keep = presence(aAnchor) * densBand(aAnchor, 6.0);
          vAmt = keep;
          vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
          vDepth = -mv.z;
          vec4 mM = viewMatrix * vec4(uMouse, 1.0);
          vMouse = 1.0 - smoothstep(0.0, uMouseR, length(mv.xy - mM.xy));
          if (aRand > keep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          gl_Position = projectionMatrix * mv;
        }
      `,
      /* glsl */ `
        precision highp float;
        ${DIV_GLSL}
        void main() {
          float df = depthFade(vDepth);
          float b = (0.66 + 0.4 * vMouse) * df;
          float a = (0.3 + 0.22 * vMouse) * uReveal * df;
          gl_FragColor = vec4(vec3(b), clamp(a, 0.0, 1.0));
        }
      `
    );
    this.tris = new THREE.LineSegments(wg, mat);
    this.orient.add(this.tris);
  }

  // --- POINTS (patches animés par le bruit) --------------------------------
  _buildPoints(merged: THREE.BufferGeometry, count: number) {
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
    const sampler = new MeshSurfaceSampler(mesh).build();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      sampler.sample(s);
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
      seeds[i] = Math.random() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        ${DIV_GLSL}
        uniform float uPointSize;
        uniform float uDpr;
        attribute float aSeed;
        void main() {
          // points = accent : clusterisés dans leurs propres zones denses.
          vAmt = presence(position) * densBand(position, 9.0) * (0.4 + 0.6 * pointPatch(position));
          vec3 p = position;
          p.x += sin(uTime * 0.8 + aSeed * 6.0) * 0.005;
          p.y += cos(uTime * 0.7 + aSeed * 5.0) * 0.005;
          vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
          vDepth = -mv.z;
          vec4 mM = viewMatrix * vec4(uMouse, 1.0);
          vMouse = 1.0 - smoothstep(0.0, uMouseR, length(mv.xy - mM.xy));
          gl_PointSize = (uPointSize * (0.7 + vAmt) + vMouse * 1.0) * uDpr;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${DIV_GLSL}
        void main() {
          if (vAmt < 0.14) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          if (r > 0.5) discard;
          float core = smoothstep(0.5, 0.18, r);
          float df = depthFade(vDepth);
          float b = (0.85 + 0.25 * vMouse) * df;
          float a = core * (0.6 + 0.2 * vMouse) * uReveal * df;
          gl_FragColor = vec4(vec3(b), clamp(a, 0.0, 1.0));
        }
      `,
    });
    this.points = new THREE.Points(g, mat);
    this.orient.add(this.points);
  }

  // Orientation réglable du modèle (degrés).
  setOrient(xDeg: number, yDeg: number, zDeg: number) {
    const d = Math.PI / 180;
    this.orient.rotation.set(xDeg * d, yDeg * d, zDeg * d);
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y);
    this.ndc.set(x, -y);
    this.hasPointer = true;
  }

  clearPointer() {
    this.hasPointer = false;
    this._mouseWorld.set(999, 999, 999);
    this.uniforms.uMouse.value.copy(this._mouseWorld);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const s = Math.max(1, Math.min(r.width, r.height) || 1);
    this.renderer.setSize(s, s, false);
    this.composer.setSize(s, s);
    this.bloom.resolution.set(s, s);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.start();
    const loop = () => {
      if (!this._running) return;
      const dt = Math.min(this._clock.getDelta(), 0.05);
      this._tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this.raf);
  }

  _tick(dt: number) {
    this.uniforms.uTime.value += dt;
    if (this.uniforms.uReveal.value < 1) {
      this.uniforms.uReveal.value = Math.min(1, this.uniforms.uReveal.value + dt / 1.2);
    }
    // De face, léger mouvement piloté par la souris (pas d'auto-rotation).
    const targetY = this.pointer.x * 0.32;
    const targetX = -this.pointer.y * 0.18;
    this.group.rotation.y += (targetY - this.group.rotation.y) * 0.08;
    this.group.rotation.x += (targetX - this.group.rotation.x) * 0.08;

    if (this.hasPointer) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hit = this.raycaster.ray.intersectPlane(this.plane, this._mouseWorld);
      if (hit) this.uniforms.uMouse.value.copy(this._mouseWorld);
    }

    this.composer.render();
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
  }
}
