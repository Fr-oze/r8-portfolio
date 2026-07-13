import * as THREE from "three";
import type { Stage } from "../core/Stage";
import type { OrbScene } from "./OrbScene";

// =====================================================================
// ORB DIVE — mini-jeu : plonger dans le noyau de l'orbe. On pilote
// l'alignement (souris / flèches) pour rester centré dans le tunnel ;
// autopilote optionnel. Profondeur + stabilité affichées dans le HUD.
// =====================================================================

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class OrbDiveMode {
  stage: Stage;
  orb: OrbScene;
  active = false;
  autopilot = true;
  depth = 0;       // 0..1
  stability = 1;   // 0..1
  speed = 0;
  private offset = new THREE.Vector2(0, 0);
  private target = new THREE.Vector2(0, 0);
  private keys: Record<string, boolean> = {};
  private savedCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private savedGroup = { rot: new THREE.Euler(), pos: new THREE.Vector3() };
  private enterT = 0;
  private hud: HTMLElement | null;
  private autoBtn: HTMLElement | null;
  private depthEl: HTMLElement | null;
  private stabEl: HTMLElement | null;
  private speedEl: HTMLElement | null;
  private radarCanvas: HTMLCanvasElement | null;
  private radarCtx: CanvasRenderingContext2D | null;

  constructor(stage: Stage, orb: OrbScene) {
    this.stage = stage;
    this.orb = orb;
    this._bindKeys();
    this._bindTouch();

    this.hud = document.getElementById("dive-hud");
    this.autoBtn = document.getElementById("dive-auto");
    this.depthEl = document.getElementById("dive-depth");
    this.stabEl = document.getElementById("dive-stability");
    this.speedEl = document.getElementById("dive-speed");
    this.radarCanvas = document.getElementById("dive-radar") as HTMLCanvasElement | null;
    this.radarCtx = this.radarCanvas?.getContext("2d") ?? null;

    this.autoBtn?.addEventListener("click", () => {
      this.autopilot = true;
      this.autoBtn?.classList.add("dive-hud__auto--on");
    });
  }

  private _bindKeys() {
    const map: Record<string, string> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right",
    };
    window.addEventListener("keydown", (e) => {
      const k = map[e.key];
      if (!k || !this.active) return;
      this.keys[k] = true;
      this.autopilot = false;
      this.autoBtn?.classList.remove("dive-hud__auto--on");
    });
    window.addEventListener("keyup", (e) => {
      const k = map[e.key];
      if (k) this.keys[k] = false;
    });
  }

  private _bindTouch() {
    document.querySelectorAll(".dive-touch__btn").forEach((btn) => {
      const k = btn.getAttribute("data-k") || "";
      const down = (e: Event) => {
        e.preventDefault();
        if (!this.active) return;
        this.keys[k] = true;
        this.autopilot = false;
        this.autoBtn?.classList.remove("dive-hud__auto--on");
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

  enter() {
    if (this.active) return;
    this.active = true;
    this.enterT = 0;
    this.depth = 0;
    this.stability = 1;
    this.speed = 0;
    this.offset.set(0, 0);
    this.target.set(0, 0);
    this.autopilot = true;

    this.savedCam.pos.copy(this.stage.camera.position);
    this.savedCam.quat.copy(this.stage.camera.quaternion);
    this.savedGroup.rot.copy(this.orb.group.rotation);
    this.savedGroup.pos.copy(this.orb.group.position);

    document.body.classList.add("diving");
    this.hud?.classList.remove("dive-hud--hidden");
    this.autoBtn?.classList.add("dive-hud__auto--on");
    this.orb.freezeForDive();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove("diving");
    this.hud?.classList.add("dive-hud--hidden");

    this.stage.camera.position.copy(this.savedCam.pos);
    this.stage.camera.quaternion.copy(this.savedCam.quat);
    this.orb.group.rotation.copy(this.savedGroup.rot);
    this.orb.group.position.copy(this.savedGroup.pos);
    this.orb.setDive(false, 0);
    this.orb.resumeAfterDive();
  }

  update(t: number, dt: number, pointer: THREE.Vector2) {
    if (!this.active) return;

    this.enterT += dt;
    const intro = clamp(this.enterT / 1.2, 0, 1);

    // cible : autopilote recentre, sinon souris ou clavier
    if (this.autopilot) {
      this.target.lerp(new THREE.Vector2(0, 0), 0.08);
    } else if (this.keys.left || this.keys.right || this.keys.up || this.keys.down) {
      this.target.x += (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      this.target.y += (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);
      this.target.x = clamp(this.target.x, -1.2, 1.2);
      this.target.y = clamp(this.target.y, -1.2, 1.2);
    } else {
      this.target.set(pointer.x * 1.1, pointer.y * 0.9);
    }
    this.offset.lerp(this.target, this.autopilot ? 0.12 : 0.18);

    const misalign = this.offset.length();
    this.stability += (clamp(1 - misalign * 1.35, 0, 1) - this.stability) * 0.12;

    const baseRate = 0.045 + this.stability * 0.09;
    this.speed += (baseRate * 60 - this.speed) * 0.08;
    this.depth = clamp(this.depth + this.speed * dt * 0.018, 0, 1);

    // caméra : zoom + léger décalage selon l'offset (on « rate » le tunnel)
    const camZ = THREE.MathUtils.lerp(this.savedCam.pos.z, 2.1, intro * 0.72 - this.depth * 0.35);
    this.stage.camera.position.set(
      this.offset.x * 0.55,
      this.offset.y * 0.4 + 0.1,
      camZ
    );
    this.stage.camera.lookAt(this.offset.x * 0.3, this.offset.y * 0.25, 0);

    // l'orbe grossit et pulse avec la profondeur
    const scale = 1 + this.depth * 0.85 + Math.sin(t * 3) * 0.02 * this.depth;
    this.orb.group.scale.setScalar(scale);
    this.orb.group.rotation.z = this.offset.x * 0.08;
    this.orb.group.rotation.y = this.savedGroup.rot.y + this.offset.x * 0.15;
    this.orb.setDive(true, this.depth);

    this._updateHud();
    if (this.depth >= 0.995) this.exit();
  }

  private _updateHud() {
    if (this.depthEl) this.depthEl.textContent = String(Math.round(this.depth * 100)).padStart(3, "0");
    if (this.stabEl) this.stabEl.textContent = `${Math.round(this.stability * 100)}%`;
    if (this.speedEl) this.speedEl.textContent = this.speed.toFixed(1);
    if (!this.radarCtx || !this.radarCanvas) return;
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(180,200,220,0.25)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (i / 4) * Math.min(cx, cy) * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(242,244,246,0.9)";
    ctx.beginPath();
    ctx.arc(cx + this.offset.x * cx * 0.55, cy - this.offset.y * cy * 0.55, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
