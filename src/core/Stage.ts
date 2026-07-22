import * as THREE from "three";

/**
 * Stage — boilerplate Three.js réutilisable :
 * scène + caméra perspective + renderer + resize + boucle d'animation.
 */
type TickFn = (t: number, dt: number) => void;
type ResizeFn = (w: number, h: number) => void;

export class Stage {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  clock: THREE.Clock;
  private _tickFn: TickFn | null;
  private _renderFn: TickFn | null;
  private _resizeCbs: ResizeFn[];
  private _raf: number;
  private _onResize: () => void;

  constructor(container: HTMLElement, { bg = 0xf4f5f7, fov = 42 } = {}) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(bg, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 7);

    this.clock = new THREE.Clock();
    this._tickFn = null;
    this._renderFn = null;
    this._resizeCbs = [];
    this._raf = 0;

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
  }

  get dpr() {
    return this.renderer.getPixelRatio();
  }

  add(...o: THREE.Object3D[]) {
    this.scene.add(...o);
  }
  setRender(fn: TickFn) {
    this._renderFn = fn;
  }
  onResize(fn: ResizeFn) {
    this._resizeCbs.push(fn);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._resizeCbs.forEach((fn) => fn(w, h));
  }

  start(tickFn: TickFn) {
    this._tickFn = tickFn;
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.getElapsedTime();
      this._tickFn?.(t, dt);
      if (this._renderFn) this._renderFn(t, dt);
      else this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
  }

  dispose() {
    this.stop();
    window.removeEventListener("resize", this._onResize);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) m.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
