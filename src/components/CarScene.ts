import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// CAR SCENE — chargement glTF + arêtes wireframe + particules surface
// + effet SCAN (révélation par balayage vertical) + glow proximité souris
// =====================================================================
// MODEL_URL : remplace par le tien si besoin. Fallback = géométrie de démo.
const MODEL_URL = "/model/scene.gltf";

// Shaders partagés : un uniform uScan (hauteur du front de balayage) décide
// ce qui est révélé. Au-dessus du front → discard. Près du front → ligne vive.
const REVEAL_GLSL = /* glsl */ `
  uniform float uScan;     // hauteur courante du balayage d'intro (Y monde)
  uniform float uScanOn;   // 1 = scan d'intro en cours, 0 = tout révélé
  uniform float uBand;     // épaisseur de la ligne lumineuse du front
  uniform vec3  uMouse;    // position souris dans la scène
  uniform float uSweep;    // hauteur du balayage de TRANSITION entre modes
  uniform float uSweepOn;  // 1 = transition de mode en cours
  varying float vReveal;   // 0..1 : 1 = révélé net
  varying float vFront;    // 1 près du front de scan d'intro
  varying float vMouse;    // proximité souris 0..1
  varying float vY;        // hauteur du fragment (pour le balayage de mode)
`;

import type { Stage } from "../core/Stage";

type Uniform = { value: any };
type Layer = { points: Uniform; edges: Uniform; tris: Uniform; shell: Uniform };

export class CarScene {
  stage: Stage;
  manager: THREE.LoadingManager;
  group: THREE.Group;
  uniforms: Record<string, Uniform>;
  minPoints: number;
  maxPoints: number;
  layerOpacity: Layer;
  layerPrev: Layer;
  SWEEP_TIME: number;
  modes: { label: string; op: number[] }[];
  MODE_INTERVAL: number;
  modeIndex: number;
  private _modeTimer: number;
  private _cycling: boolean;
  onModeChange: ((label: string, idx: number) => void) | null;
  bounds: THREE.Box3;
  sampler: MeshSurfaceSampler | null;
  mergedGeo: THREE.BufferGeometry | null;
  points: THREE.Points | null;
  edges: THREE.LineSegments | null;
  tris: THREE.LineSegments | null;
  shell: THREE.Mesh | null;
  scanLine: THREE.Object3D | null;
  ready: boolean;
  onReady: (() => void) | null;
  onScanComplete: (() => void) | null;
  private _scanComplete: boolean;
  size!: THREE.Vector3;
  longAxis!: "x" | "z";
  detail01 = 0;
  particleCount = 0;

  constructor(stage: Stage, manager: THREE.LoadingManager) {
    this.stage = stage;
    this.manager = manager;
    this.group = new THREE.Group();
    stage.add(this.group);

    this.uniforms = {
      uScan: { value: -999 },
      uScanOn: { value: 1 },
      uBand: { value: 0.06 },
      uMouse: { value: new THREE.Vector3(999, 999, 999) },
      uTime: { value: 0 },
      uPointSize: { value: 1.5 },
      uDpr: { value: stage.dpr },
      uGlow: { value: 1.0 },
      uAlphaScale: { value: 1.0 }, // compense la densité pour éviter la saturation
      uEdgeFraction: { value: 1.0 }, // fraction d'arêtes vives affichées
      uTriFraction: { value: 1.0 },  // fraction du maillage triangulé affiché
      uSweep: { value: -999 },       // front du balayage de transition de mode
      uSweepOn: { value: 0 },        // 1 pendant une transition de mode
    };

    this.minPoints = 4000;
    this.maxPoints = 60000;

    // Opacité par couche : .value = mode courant (sous le front de balayage),
    // layerPrev = mode précédent (au-dessus du front). Le balayage révèle le
    // nouveau mode de bas en haut, comme l'effet d'intro.
    this.layerOpacity = {
      points: { value: 1 },
      edges: { value: 1 },
      tris: { value: 0 },
      shell: { value: 0 }, // coque pleine qui remplit les faces
    };
    this.layerPrev = {
      points: { value: 1 },
      edges: { value: 1 },
      tris: { value: 0 },
      shell: { value: 0 },
    };
    this.SWEEP_TIME = 1.4; // durée du balayage de transition (s)

    // Modes de rendu cyclés toutes les MODE_INTERVAL secondes.
    // Cibles d'opacité [points, edges, tris, shell].
    this.modes = [
      { label: "SURFACE · FILLED", op: [0.9, 0.0, 0.0, 1.0] },
      { label: "SHARP EDGES", op: [0.0, 1.0, 0.0, 0.0] },
      { label: "TRIANGULATION", op: [0.0, 0.0, 0.9, 0.0] },
      { label: "POINTS + EDGES", op: [0.9, 0.85, 0.0, 0.0] },
      { label: "POINTS + MESH", op: [0.7, 0.0, 0.7, 0.0] },
      { label: "FULL DATA", op: [0.85, 0.6, 0.4, 0.7] },
    ];
    this.MODE_INTERVAL = 10; // secondes
    this.modeIndex = 0;
    this._modeTimer = 0;
    this._cycling = false; // démarre après le scan
    this.onModeChange = null;

    this.bounds = new THREE.Box3();
    this.sampler = null;
    this.mergedGeo = null;
    this.points = null;
    this.edges = null;
    this.tris = null;
    this.shell = null;
    this.scanLine = null;
    this.ready = false;
    this.onReady = null;
    this.onScanComplete = null;
    this._scanComplete = false;
  }

  // Fusionne toutes les géométries du modèle en positions-monde (pour edges +
  // sampler), en ne gardant que l'attribut position non-indexé.
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
    const loader = new GLTFLoader(this.manager);
    loader.load(
      MODEL_URL,
      (gltf) => this._build(gltf.scene),
      undefined,
      () => {
        // Fallback : la démo doit tourner sans fichier.
        const demo = new THREE.Group();
        const m = new THREE.Mesh(new THREE.TorusKnotGeometry(1.2, 0.4, 200, 32));
        demo.add(m);
        this._build(demo);
      }
    );
  }

  _build(root: THREE.Object3D) {
    let merged = this._collect(root);
    if (!merged) return;

    // Centre + normalise à ~4 unités de large.
    merged.computeBoundingBox();
    const bb = merged.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    const size = new THREE.Vector3();
    bb.getSize(size);

    // ANCRAGE = centre de masse (centroïde) sur le plan horizontal X/Z. C'est le
    // pivot de l'auto-rotation : caler sur le centre de la bbox faisait paraître
    // la voiture décalée à droite et donnait une rotation qui « orbite ». Le
    // centroïde met le pivot sur la masse réelle du modèle. Y reste sur la bbox
    // (placement vertical + balayage de scan inchangés).
    const posAttr = merged.getAttribute("position");
    let cx = 0, cz = 0;
    for (let i = 0; i < posAttr.count; i++) {
      cx += posAttr.getX(i);
      cz += posAttr.getZ(i);
    }
    cx /= posAttr.count;
    cz /= posAttr.count;

    const scale = 4.2 / Math.max(size.x, size.y, size.z);
    merged.translate(-cx, -center.y, -cz);
    merged.scale(scale, scale, scale);
    merged.computeBoundingBox();
    this.bounds.copy(merged.boundingBox);
    this.mergedGeo = merged;
    // Proportions (invariantes par scale uniforme) → axe long = sens de la
    // voiture, utilisé par le mode conduite pour l'orienter.
    this.size = size.clone();
    this.longAxis = size.x >= size.z ? "x" : "z";

    this._buildShell(merged);
    this._buildEdges(merged);
    this._buildWireframe(merged);
    this._buildPoints(5000);

    // Lance le scan depuis le bas.
    this.uniforms.uScan.value = this.bounds.min.y;
    this.ready = true;
    this.onReady?.();
  }

  // --- COQUE PLEINE (mesh) -------------------------------------------------
  // Remplit les faces : un mesh sombre à liseré fresnel qui ÉCRIT la
  // profondeur. Résultat : les points/arêtes derrière sont occultés → on ne
  // voit que la face avant et le volume paraît solide (plus un nuage flottant).
  _buildShell(merged: THREE.BufferGeometry) {
    const geo = merged.clone();
    geo.computeVertexNormals(); // nécessaire pour le fresnel

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uLayerOpacity: this.layerOpacity.shell,
        uLayerOpacityPrev: this.layerPrev.shell,
      },
      transparent: true,
      depthWrite: true, // ← occulte ce qui est derrière (effet "solide")
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${REVEAL_GLSL}
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = mat3(modelMatrix) * normal;
          vV = cameraPosition - wp.xyz;
          // hauteur LOCALE (comme aY des autres couches) → cohérent avec
          // uScan/uSweep qui sont en coordonnées du modèle (bounds locaux).
          // Sinon l'échelle/offset du groupe coupe la révélation à mi-hauteur.
          float y = position.y;
          vY = y;
          vReveal = step(y, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(y - uScan));
          vMouse = 1.0 - smoothstep(0.0, 1.8, distance(wp.xyz, uMouse));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${REVEAL_GLSL}
        uniform float uLayerOpacity;
        uniform float uLayerOpacityPrev;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float opMax = max(uLayerOpacity, uLayerOpacityPrev);
          if (opMax < 0.001) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          // balayage de mode : sous le front → nouveau mode, au-dessus → ancien.
          float op = uLayerOpacity;
          float sweepFront = 0.0;
          if (uSweepOn > 0.5) {
            float below = step(vY, uSweep);
            op = mix(uLayerOpacityPrev, uLayerOpacity, below);
            sweepFront = 1.0 - smoothstep(0.0, uBand * 1.6, abs(vY - uSweep));
          }
          // abs(dot) → insensible aux normales retournées du merge (sinon le
          // fresnel sature à 1 partout = solide blanc plat, le bug constaté).
          float ndv = abs(dot(normalize(vN), normalize(vV)));
          float fres = pow(1.0 - ndv, 3.0);
          // base très sombre + liseré fresnel lumineux + glow souris + fronts.
          float b = 0.02 + 0.7 * fres + 0.4 * vMouse + 0.7 * vFront + 0.6 * sweepFront;
          float a = reveal * (0.32 + 0.6 * fres) * op;
          // pas d'écriture de profondeur fantôme là où la coque est éteinte.
          if (a < 0.003 && sweepFront < 0.02) discard;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    this.shell = new THREE.Mesh(geo, mat);
    this.shell.renderOrder = -1; // dessiné avant points/arêtes
    this.shell.visible = false;
    this.group.add(this.shell);
  }

  // --- ARÊTES (EdgesGeometry) ----------------------------------------------
  // EdgesGeometry ne garde que les arêtes "vives" (angle > seuil). On le
  // calcule sur la géométrie fusionnée → wireframe structurel de la voiture.
  _buildEdges(merged: THREE.BufferGeometry) {
    const eg = new THREE.EdgesGeometry(merged, 24);
    // attribut aY = hauteur (révélation scan) + aRand = clé par segment
    // (même valeur pour les 2 sommets d'une arête) pour le contrôle de densité.
    const pos = eg.getAttribute("position");
    const ys = new Float32Array(pos.count);
    const rnd = new Float32Array(pos.count);
    const segRand: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      ys[i] = pos.getY(i);
      const seg = i >> 1; // 2 sommets par segment
      if (segRand[seg] === undefined) segRand[seg] = Math.random();
      rnd[i] = segRand[seg];
    }
    eg.setAttribute("aY", new THREE.BufferAttribute(ys, 1));
    eg.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uLayerOpacity: this.layerOpacity.edges,
        uLayerOpacityPrev: this.layerPrev.edges,
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${REVEAL_GLSL}
        attribute float aY;
        attribute float aRand;
        uniform float uEdgeFraction;
        void main() {
          // densité : on cache les segments dont la clé dépasse la fraction.
          if (aRand > uEdgeFraction) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vY = aY;
          vReveal = step(aY, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(aY - uScan));
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vMouse = 1.0 - smoothstep(0.0, 1.8, distance(wp.xyz, uMouse));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${REVEAL_GLSL}
        uniform float uLayerOpacity;
        uniform float uLayerOpacityPrev;
        void main() {
          float opMax = max(uLayerOpacity, uLayerOpacityPrev);
          if (opMax < 0.001) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          float op = uLayerOpacity;
          float sweepFront = 0.0;
          if (uSweepOn > 0.5) {
            float below = step(vY, uSweep);
            op = mix(uLayerOpacityPrev, uLayerOpacity, below);
            sweepFront = 1.0 - smoothstep(0.0, uBand * 1.6, abs(vY - uSweep));
          }
          float b = 0.32 + 0.5 * vMouse + 0.7 * vFront + 0.8 * sweepFront;
          float a = reveal * (0.35 + 0.4 * vMouse + 0.5 * vFront) * op
                  + reveal * sweepFront * 0.5 * opMax;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    this.edges = new THREE.LineSegments(eg, mat);
    this.group.add(this.edges);
  }

  // --- WIREFRAME / TRIANGULATION (WireframeGeometry) ------------------------
  // WireframeGeometry trace TOUTES les arêtes de tous les triangles (vs
  // EdgesGeometry qui ne garde que les arêtes vives). → maillage complet.
  _buildWireframe(merged: THREE.BufferGeometry) {
    const wg = new THREE.WireframeGeometry(merged);
    const pos = wg.getAttribute("position");
    const ys = new Float32Array(pos.count);
    const rnd = new Float32Array(pos.count);
    const segRand: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      ys[i] = pos.getY(i);
      const seg = i >> 1;
      if (segRand[seg] === undefined) segRand[seg] = Math.random();
      rnd[i] = segRand[seg];
    }
    wg.setAttribute("aY", new THREE.BufferAttribute(ys, 1));
    wg.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uLayerOpacity: this.layerOpacity.tris,
        uLayerOpacityPrev: this.layerPrev.tris,
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${REVEAL_GLSL}
        attribute float aY;
        attribute float aRand;
        uniform float uTriFraction;
        void main() {
          if (aRand > uTriFraction) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vY = aY;
          vReveal = step(aY, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(aY - uScan));
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vMouse = 1.0 - smoothstep(0.0, 1.8, distance(wp.xyz, uMouse));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${REVEAL_GLSL}
        uniform float uLayerOpacity;
        uniform float uLayerOpacityPrev;
        void main() {
          float opMax = max(uLayerOpacity, uLayerOpacityPrev);
          if (opMax < 0.001) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          float op = uLayerOpacity;
          float sweepFront = 0.0;
          if (uSweepOn > 0.5) {
            float below = step(vY, uSweep);
            op = mix(uLayerOpacityPrev, uLayerOpacity, below);
            sweepFront = 1.0 - smoothstep(0.0, uBand * 1.6, abs(vY - uSweep));
          }
          // maillage dense → opacité fine pour ne pas saturer.
          float b = 0.22 + 0.4 * vMouse + 0.6 * vFront + 0.7 * sweepFront;
          float a = reveal * (0.14 + 0.3 * vMouse + 0.4 * vFront) * op
                  + reveal * sweepFront * 0.35 * opMax;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    this.tris = new THREE.LineSegments(wg, mat);
    this.group.add(this.tris);
  }

  // --- PARTICULES SURFACE (MeshSurfaceSampler) ------------------------------
  // MeshSurfaceSampler répartit des points uniformément sur la surface
  // (pondérés par l'aire des triangles). On échantillonne N points sur la
  // carrosserie fusionnée → nuage blanc qui épouse le volume.
  _buildPoints(count: number) {
    if (!this.sampler) {
      const mesh = new THREE.Mesh(this.mergedGeo, new THREE.MeshBasicMaterial());
      this.sampler = new MeshSurfaceSampler(mesh).build();
    }
    if (this.points) {
      this.points.geometry.dispose();
      this.group.remove(this.points);
    }
    const pos = new Float32Array(count * 3);
    const ys = new Float32Array(count);
    const seeds = new Float32Array(count);
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      this.sampler.sample(s);
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
      ys[i] = s.y;
      seeds[i] = Math.random() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aY", new THREE.BufferAttribute(ys, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uLayerOpacity: this.layerOpacity.points,
        uLayerOpacityPrev: this.layerPrev.points,
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${REVEAL_GLSL}
        uniform float uTime;
        uniform float uPointSize;
        uniform float uDpr;
        attribute float aY;
        attribute float aSeed;
        void main() {
          vY = aY;
          vReveal = step(aY, uScan);
          vFront = 1.0 - smoothstep(0.0, uBand, abs(aY - uScan));
          vec3 p = position;
          // micro-flottement (ne casse pas la structure).
          p.x += sin(uTime * 0.8 + aSeed * 6.0) * 0.004;
          p.y += cos(uTime * 0.7 + aSeed * 5.0) * 0.004;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vMouse = 1.0 - smoothstep(0.0, 1.8, distance(wp.xyz, uMouse));
          vec4 mv = viewMatrix * wp;
          // Taille FIXE + petit boost au front de scan et près du curseur.
          gl_PointSize = (uPointSize + vFront * 0.8 + vMouse * 1.4) * uDpr;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${REVEAL_GLSL}
        uniform float uAlphaScale;
        uniform float uLayerOpacity;
        uniform float uLayerOpacityPrev;
        void main() {
          float opMax = max(uLayerOpacity, uLayerOpacityPrev);
          if (opMax < 0.001) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          if (r > 0.5) discard;
          float reveal = max(vReveal, vFront);
          if (reveal < 0.02) discard;
          // coeur net (bord dur) plutôt que disque flou.
          float core = smoothstep(0.5, 0.34, r);
          float op = uLayerOpacity;
          float sweepFront = 0.0;
          if (uSweepOn > 0.5) {
            float below = step(vY, uSweep);
            op = mix(uLayerOpacityPrev, uLayerOpacity, below);
            sweepFront = 1.0 - smoothstep(0.0, uBand * 1.6, abs(vY - uSweep));
          }
          float b = 0.55 + 0.4 * vMouse + 0.4 * vFront + 0.6 * sweepFront;
          // alpha modéré + compensation densité → pas de saturation blanche.
          float a = reveal * core * (0.4 + 0.4 * vMouse) * uAlphaScale * op
                  + reveal * core * sweepFront * 0.5 * opMax * uAlphaScale;
          gl_FragColor = vec4(vec3(b), a);
        }
      `,
    });
    this.points = new THREE.Points(g, mat);
    this.particleCount = count;
    // Compensation DOUCE de la densité : on baisse à peine l'alpha quand il y a
    // beaucoup de points (sinon, l'ancienne formule 5000/count les rendait
    // quasi invisibles à haute densité → effet paradoxal). sqrt = atténuation
    // légère, donc plus de points = visiblement plus dense.
    this.uniforms.uAlphaScale.value = Math.min(1, Math.sqrt(12000 / count));
    this.group.add(this.points);
  }

  // Slider unique de DENSITÉ (0..1) : agit sur les 3 couches à la fois, donc
  // quel que soit le mode de rendu courant le slider fait toujours qqch de
  // visible (plus/moins de points, d'arêtes vives ou de maillage triangulé).
  setDetail(v: number) {
    this.detail01 = v;
    // Arêtes & triangles : fraction affichée (instantané, via uniform).
    this.uniforms.uEdgeFraction.value = 0.25 + 0.75 * v;
    this.uniforms.uTriFraction.value = 0.2 + 0.8 * v;
    // Points : nombre réel. On arrondit à un pas pour éviter de reconstruire
    // la géométrie à chaque pixel de drag.
    const target = Math.round((this.minPoints + v * (this.maxPoints - this.minPoints)) / 1000) * 1000;
    if (this.ready && target !== this.particleCount) this._buildPoints(target);
  }
  setMouseWorld(v: THREE.Vector3) {
    this.uniforms.uMouse.value.copy(v);
  }

  // Passe au mode i en déclenchant un BALAYAGE : l'ancien mode reste au-dessus
  // du front, le nouveau est peint en dessous, de bas en haut (comme l'intro).
  _applyMode(i: number) {
    const o = this.layerOpacity;
    const prev = this.layerPrev;
    // l'état courant devient l'ancien (au-dessus du front pendant le balayage).
    prev.points.value = o.points.value;
    prev.edges.value = o.edges.value;
    prev.tris.value = o.tris.value;
    prev.shell.value = o.shell.value;

    this.modeIndex = (i + this.modes.length) % this.modes.length;
    const m = this.modes[this.modeIndex];
    o.points.value = m.op[0];
    o.edges.value = m.op[1];
    o.tris.value = m.op[2];
    o.shell.value = m.op[3] ?? 0;

    // lance le balayage depuis le bas.
    const span = this.bounds.max.y - this.bounds.min.y;
    this.uniforms.uSweep.value = this.bounds.min.y - span * 0.05;
    this.uniforms.uSweepOn.value = 1;

    this.onModeChange?.(m.label, this.modeIndex);
  }

  // Fige le rendu sur un mode lisible pour la conduite (pas de cyclage/balayage).
  freezeForDrive() {
    this._cycling = false;
    this.uniforms.uSweepOn.value = 0;
    const set = (o: Layer, a: number, b: number, c: number, d: number) => {
      o.points.value = a; o.edges.value = b; o.tris.value = c; o.shell.value = d;
    };
    set(this.layerOpacity, 0.9, 0.65, 0.0, 0.85);
    set(this.layerPrev, 0.9, 0.65, 0.0, 0.85);
    this.onModeChange?.("DRIVE MODE", -1);
  }

  // Reprend le cyclage des modes après la conduite.
  resumeAfterDrive() {
    this._cycling = true;
    this._modeTimer = 0;
    this._applyMode(this.modeIndex);
  }

  update(t: number, dt: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uDpr.value = this.stage.dpr;
    if (!this.ready) return;

    // Avancée du scan (bas → haut) sur ~2.4s. La révélation se fait via la
    // ligne nette (vFront) sur les arêtes/points, sans plan visible.
    if (this.uniforms.uScanOn.value > 0.5) {
      const span = this.bounds.max.y - this.bounds.min.y;
      this.uniforms.uScan.value += (span / 2.4) * dt;
      if (this.uniforms.uScan.value >= this.bounds.max.y + span * 0.05) {
        this.uniforms.uScanOn.value = 0;
        if (!this._scanComplete) {
          this._scanComplete = true;
          this.onScanComplete?.();
          // Démarre le cycle des modes sur le 1er mode (points seuls).
          this._cycling = true;
          this._applyMode(0);
        }
      }
    }

    // Cycle des modes toutes les MODE_INTERVAL secondes.
    if (this._cycling) {
      this._modeTimer += dt;
      if (this._modeTimer >= this.MODE_INTERVAL && this.uniforms.uSweepOn.value < 0.5) {
        this._modeTimer = 0;
        this._applyMode(this.modeIndex + 1);
      }
    }

    // Avancée du balayage de transition (bas → haut).
    if (this.uniforms.uSweepOn.value > 0.5) {
      const span = this.bounds.max.y - this.bounds.min.y;
      this.uniforms.uSweep.value += (span / this.SWEEP_TIME) * dt;
      if (this.uniforms.uSweep.value >= this.bounds.max.y + span * 0.05) {
        this.uniforms.uSweepOn.value = 0; // transition finie : tout = mode courant
      }
    }

    // Coque : visible/écrit la profondeur si présente dans le mode courant OU
    // l'ancien (pendant le balayage), pour ne pas occulter à tort les points.
    if (this.shell) {
      const sweeping = this.uniforms.uSweepOn.value > 0.5;
      const sv = sweeping
        ? Math.max(this.layerOpacity.shell.value, this.layerPrev.shell.value)
        : this.layerOpacity.shell.value;
      this.shell.visible = sv > 0.01;
      (this.shell.material as THREE.Material).depthWrite = sv > 0.5;
    }
  }
}
