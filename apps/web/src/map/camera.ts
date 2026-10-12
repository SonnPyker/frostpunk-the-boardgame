// Orbit-style camera restricted to the map: pan (right/middle drag, WASD/arrows), rotate (left drag),
// zoom (wheel), smooth fly-to (focus). Values are damped towards goals so every change is continuous.
import * as THREE from 'three';

export const CAM_LIMITS = {
  minDist: 4.5,
  maxDist: 24,
  minPitch: 0.42, // ~24 degrees
  maxPitch: 1.28, // ~73 degrees
  mapRadius: 8.5,
  fov: 34,
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private yaw = 0.0;
  private yawGoal = 0.0;
  private pitch = 0.98;
  private pitchGoal = 0.98;
  private dist = 18;
  private distGoal = 18;
  private viewportH = 1;
  private aspect = 1;

  constructor(aspect: number) {
    this.aspect = aspect;
    this.camera = new THREE.PerspectiveCamera(CAM_LIMITS.fov, aspect, 0.1, 220);
    this.apply();
  }

  setViewport(w: number, h: number): void {
    this.aspect = w / Math.max(1, h);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.viewportH = Math.max(1, h);
  }

  /** Damped update. Returns true while the camera is still moving. */
  update(dt: number, instant: boolean): boolean {
    const k = instant ? 1 : 1 - Math.exp(-dt * 9);
    const before = this.camera.position.clone();
    this.target.lerp(this.goal, k);
    this.yaw += (this.yawGoal - this.yaw) * k;
    this.pitch += (this.pitchGoal - this.pitch) * k;
    this.dist += (this.distGoal - this.dist) * k;
    this.apply();
    return before.distanceToSquared(this.camera.position) > 1e-6 || this.target.distanceToSquared(this.goal) > 1e-6;
  }

  /** Advance the goal by a pan in camera-relative ground coordinates (world units). */
  panGoal(dRight: number, dForward: number): void {
    const right = new THREE.Vector3(Math.cos(this.yawGoal), 0, -Math.sin(this.yawGoal));
    const fwd = new THREE.Vector3(-Math.sin(this.yawGoal), 0, -Math.cos(this.yawGoal));
    this.goal.addScaledVector(right, dRight).addScaledVector(fwd, dForward);
    this.clampGoal();
  }

  /** Mouse pan in screen pixels (grab feel: dragging moves the map with the cursor). */
  panPixels(dx: number, dy: number): void {
    const worldPerPx = (2 * this.distGoal * Math.tan((CAM_LIMITS.fov * Math.PI) / 360)) / this.viewportH;
    this.panGoal(-dx * worldPerPx, dy * worldPerPx / Math.max(0.3, Math.sin(this.pitchGoal)));
  }

  rotatePixels(dx: number, dy: number): void {
    this.yawGoal -= dx * 0.006;
    this.pitchGoal = clamp(this.pitchGoal + dy * 0.004, CAM_LIMITS.minPitch, CAM_LIMITS.maxPitch);
  }

  zoom(deltaY: number): void {
    this.distGoal = clamp(this.distGoal * Math.exp(deltaY * 0.0012), CAM_LIMITS.minDist, CAM_LIMITS.maxDist);
  }

  /** Smoothly centre on a world point, optionally zooming in to a comfortable distance. */
  flyTo(x: number, z: number, closeIn = true): void {
    this.goal.set(x, 0, z);
    this.clampGoal();
    if (closeIn) this.distGoal = clamp(Math.min(this.distGoal, 9.5), CAM_LIMITS.minDist, CAM_LIMITS.maxDist);
  }

  /**
   * Reset to the overview of the whole map. The board is about 7.5 world units from its centre to its rim, so the
   * camera pulls back until that half-width fits horizontally; on portrait screens that can exceed the normal zoom limit.
   */
  overview(): void {
    this.goal.set(0, 0, 0);
    const halfWidth = 7.5;
    const fitDist = halfWidth / (Math.tan((CAM_LIMITS.fov * Math.PI) / 360) * Math.max(0.2, this.aspect));
    this.distGoal = clamp(Math.max(18, fitDist), CAM_LIMITS.minDist, 46);
    this.pitchGoal = 0.98;
    this.yawGoal = 0;
  }

  /** Immediately jump to the goals (used on quality changes and the first frame). */
  snap(): void {
    this.target.copy(this.goal);
    this.yaw = this.yawGoal;
    this.pitch = this.pitchGoal;
    this.dist = this.distGoal;
    this.apply();
  }

  /** Screen ray direction helpers are handled by the scene; this exposes the ground pan vectors for keyboard input. */
  forwardOnGround(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yawGoal), 0, -Math.cos(this.yawGoal));
  }

  private clampGoal(): void {
    const len = Math.hypot(this.goal.x, this.goal.z);
    if (len > CAM_LIMITS.mapRadius) {
      const k = CAM_LIMITS.mapRadius / len;
      this.goal.x *= k;
      this.goal.z *= k;
    }
  }

  private apply(): void {
    const hor = this.dist * Math.cos(this.pitch);
    const up = this.dist * Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + hor * Math.sin(this.yaw),
      this.target.y + up,
      this.target.z + hor * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
