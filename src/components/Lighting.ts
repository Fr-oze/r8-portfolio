import * as THREE from "three";

// =====================================================================
// LIGHTING — la souris devient source de lumière
// =====================================================================
// Projette le curseur sur un plan traversant la scène pour obtenir un point
// 3D ; y place une PointLight (reflets qui se déplacent) ; ce même point sert
// d'uMouse aux shaders (glow de proximité). Oriente aussi légèrement le
// sujet vers le curseur (rotation douce, faible amplitude).

import type { Stage } from "../core/Stage";

export class Lighting {
  stage: Stage;
  carGroup: THREE.Object3D;
  ambient: THREE.AmbientLight;
  mouseLight: THREE.PointLight;
  plane: THREE.Plane;
  raycaster: THREE.Raycaster;
  worldMouse: THREE.Vector3;
  private _target: THREE.Vector3;
  rotAmp: number;
  tiltX: number;
  tiltY: number;

  constructor(stage: Stage, carGroup: THREE.Object3D) {
    this.stage = stage;
    this.carGroup = carGroup;

    // Ambiance froide minimale + lumière clé pilotée par la souris.
    this.ambient = new THREE.AmbientLight(0x404856, 0.6);
    stage.add(this.ambient);

    this.mouseLight = new THREE.PointLight(0xffffff, 12, 14, 2);
    stage.add(this.mouseLight);

    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // plan z=0
    this.raycaster = new THREE.Raycaster();
    this.worldMouse = new THREE.Vector3(0, 0, 2);
    this._target = new THREE.Vector3();
    this.rotAmp = 0.08; // amplitude d'orientation du sujet (subtile, le drag prime)
    // Tilt lissé exposé à main (qui compose avec l'auto-rotation).
    this.tiltX = 0;
    this.tiltY = 0;
  }

  // pointer = NDC (-1..1). Renvoie le point monde lissé.
  update(pointer: THREE.Vector2, dt: number) {
    this.raycaster.setFromCamera(pointer, this.stage.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this._target)) {
      // Reste près du plan du sujet (z~0) pour que la proximité particules
      // se déclenche vraiment. Léger avant pour des reflets visibles.
      this._target.z = 0.5;
      this.worldMouse.lerp(this._target, 0.15);
    }
    this.mouseLight.position.copy(this.worldMouse);

    // Tilt cible vers le curseur (faible amplitude), lissé. main l'ajoute au spin.
    this.tiltY += (pointer.x * this.rotAmp - this.tiltY) * 0.05;
    this.tiltX += (-pointer.y * this.rotAmp * 0.5 - this.tiltX) * 0.05;
    return this.worldMouse;
  }

  setIntensity(v: number) {
    this.mouseLight.intensity = v * 12;
  }
}
