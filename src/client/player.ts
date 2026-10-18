// The Pigeon's movement (flies, lands, walks, hops, perches, climbs) and the third-person chase camera.
// Collision is hand-written: ground height, trunk cylinders, crown spheres, Greenhouse walls. No physics engine.

import * as THREE from "three";
import type { Collider, Forest, WorldItem } from "./forest.ts";
import { Grid, groundHeight, type V3 } from "./layout.ts";
import type { Intent } from "./input.ts";
import type { PigeonMode } from "./pigeon.ts";
import { boosted, TUNING } from "./tuning.ts";

interface PerchPoint {
  p: V3;
  item: WorldItem;
}

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  mode: PigeonMode = "ground";
  flap = 0;
  perch: PerchPoint | null = null;
  private hop: { from: THREE.Vector3; to: PerchPoint; t: number } | null = null;
  private perches = new Grid<PerchPoint>(4);
  private colliderGrid = new Grid<{ p: V3; c: Collider }>(6);
  private near: PerchPoint[] = [];
  private nearC: { p: V3; c: Collider }[] = [];
  boost = 0;
  /** Events for audio/UI. */
  onFlap: (() => void) | null = null;
  onLand: (() => void) | null = null;
  onHop: (() => void) | null = null;

  constructor(private forest: Forest, start: V3, yaw: number) {
    this.pos.set(start.x, start.y, start.z);
    this.yaw = yaw;
    for (const item of forest.items) this.perches.add({ p: item.perch, item });
    for (const c of forest.colliders) this.colliderGrid.add({ p: { x: c.x, y: 0, z: c.z }, c });
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  update(dt: number, it: Intent, camYaw: number) {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    // camera-relative wish direction: forward = away from the camera
    const wx = fx * it.my - fz * it.mx;
    const wz = fz * it.my + fx * it.mx;
    const wish = Math.min(1, Math.hypot(wx, wz));
    const ground = groundHeight(this.pos.x, this.pos.z);
    const climb = boosted(TUNING.climbReach, TUNING.boost.climbReach, this.boost);

    if (this.hop) {
      this.hop.t += dt / 0.38;
      const t = Math.min(1, this.hop.t);
      const to = this.hop.to.p;
      this.pos.lerpVectors(this.hop.from, new THREE.Vector3(to.x, to.y, to.z), t);
      this.pos.y += Math.sin(t * Math.PI) * 0.5;
      if (t >= 1) {
        this.perch = this.hop.to;
        this.hop = null;
        this.mode = "perch";
        this.onLand?.();
      }
      this.vel.set(0, 0, 0);
      return;
    }

    if (this.mode === "perch" && this.perch) {
      const p = this.perch.p;
      this.pos.set(p.x, p.y, p.z);
      this.vel.set(0, 0, 0);
      if (wish > 0.1) this.faceToward(wx, wz, dt, 4);
      if (it.upPressed) {
        const next = this.findPerch(p, climb, +1, wx, wz);
        if (next) this.startHop(next);
        else this.takeOff(wx, wz, 4.5);
      } else if (it.down && wish < 0.1) {
        const next = this.findPerch(p, climb, -1, wx, wz);
        if (next) this.startHop(next);
        else this.takeOff(wx, wz, -1);
      } else if (wish > 0.6) {
        this.takeOff(wx, wz, 1.5);
      }
      return;
    }

    if (this.mode === "ground") {
      const target = TUNING.walkSpeed;
      this.vel.x = damp(this.vel.x, wx * target, 10, dt);
      this.vel.z = damp(this.vel.z, wz * target, 10, dt);
      this.vel.y = 0;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = groundHeight(this.pos.x, this.pos.z);
      if (wish > 0.05) this.faceToward(wx, wz, dt, 10);
      if (it.upPressed) {
        const near = this.findPerch(this.pos, climb + 0.4, +1, wx, wz);
        if (near && near.p.y - this.pos.y < climb + 0.4) this.startHop(near);
        else this.takeOff(wx, wz, 5.5);
      }
      this.flap = 0;
    } else {
      // flying
      const speed = boosted(TUNING.flySpeed, TUNING.boost.flySpeed, this.boost);
      const k = wish > 0.05 ? 2.2 : 0.8;
      this.vel.x = damp(this.vel.x, wx * speed, k, dt);
      this.vel.z = damp(this.vel.z, wz * speed, k, dt);
      if (it.up) {
        this.vel.y = Math.min(6, this.vel.y + TUNING.flapLift * dt);
        this.flap = damp(this.flap, 1, 6, dt);
        if (Math.random() < dt * 3) this.onFlap?.();
      } else if (it.down) {
        this.vel.y = Math.max(-8, this.vel.y - TUNING.gravity * 1.2 * dt);
        this.flap = damp(this.flap, 0, 4, dt);
      } else {
        this.vel.y = damp(this.vel.y, -TUNING.glideSink, 1.5, dt);
        this.flap = damp(this.flap, wish > 0.05 ? 0.35 : 0.15, 3, dt);
      }
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y > TUNING.maxAltitude) {
        this.pos.y = TUNING.maxAltitude;
        this.vel.y = Math.min(0, this.vel.y);
      }
      if (this.speed > 0.3) this.faceToward(this.vel.x, this.vel.z, dt, 5);
      // perch on a branch when coming down close to one
      if (this.vel.y <= 0.5) {
        const p = this.nearestPerch(this.pos, TUNING.perchSnap);
        if (p && this.pos.y >= p.p.y - 0.3) {
          this.perch = p;
          this.mode = "perch";
          this.vel.set(0, 0, 0);
          this.onLand?.();
          return;
        }
      }
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.mode = "ground";
        this.vel.y = 0;
        this.onLand?.();
      }
    }
    this.collide();
  }

  private takeOff(wx: number, wz: number, vy: number) {
    this.mode = "fly";
    this.perch = null;
    this.vel.set(wx * 3, vy, wz * 3);
    this.flap = 1;
    this.onFlap?.();
  }

  private startHop(to: PerchPoint) {
    this.hop = { from: this.pos.clone(), to, t: 0 };
    this.mode = "fly";
    this.flap = 0.6;
    this.onHop?.();
  }

  private faceToward(x: number, z: number, dt: number, rate: number) {
    const target = Math.atan2(x, z);
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, rate * dt);
  }

  private nearestPerch(p: V3, r: number): PerchPoint | null {
    let best: PerchPoint | null = null, bd = Infinity;
    for (const c of this.perches.near(p, r, this.near)) {
      const d = (c.p.x - p.x) ** 2 + (c.p.y - p.y) ** 2 + (c.p.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** The next perch up (dir +1) or down (dir -1) within reach, preferring the wished direction. */
  findPerch(p: V3, reach: number, dir: 1 | -1, wx: number, wz: number): PerchPoint | null {
    let best: PerchPoint | null = null, bs = -Infinity;
    for (const c of this.perches.near(p, reach + 1.2, this.near)) {
      const dy = (c.p.y - p.y) * dir;
      if (dy < 0.12 || dy > reach) continue;
      if (this.perch && c === this.perch) continue;
      const dx = c.p.x - p.x, dz = c.p.z - p.z;
      const h = Math.hypot(dx, dz);
      if (h > 2.6) continue;
      const align = h > 0.01 && (wx || wz) ? (dx * wx + dz * wz) / h : 0;
      const score = -Math.abs(dy - reach * 0.5) - h * 0.4 + align * 0.8;
      if (score > bs) {
        bs = score;
        best = c;
      }
    }
    return best;
  }

  private collide() {
    const p = this.pos;
    for (const { c } of this.colliderGrid.near(p, 8, this.nearC)) {
      if (p.y > c.y1 || p.y < c.y0) {
        // standing on top of a short collider (a pot)
        continue;
      }
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const r = c.r + 0.18;
      if (d < r) {
        if (c.y1 - p.y < 0.35 && this.mode !== "ground") {
          p.y = c.y1;
          continue;
        }
        const k = (r - d) / (d || 1);
        p.x += dx * k;
        p.z += dz * k;
      }
    }
    for (const s of this.forest.spheres) {
      const dx = p.x - s.c.x, dy = p.y - s.c.y, dz = p.z - s.c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = s.r + 0.2;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1;
        const k = (r - d) / d;
        p.x += dx * k;
        p.y += dy * k;
        p.z += dz * k;
        if (dy > 0 && this.vel.y < 0) this.vel.y = 0;
      }
    }
    for (const w of this.forest.walls) {
      if (p.y > w.y + w.h) continue;
      const ex = w.bx - w.ax, ez = w.bz - w.az;
      const l2 = ex * ex + ez * ez;
      const t = Math.max(0, Math.min(1, ((p.x - w.ax) * ex + (p.z - w.az) * ez) / l2));
      const cx = w.ax + ex * t, cz = w.az + ez * t;
      const dx = p.x - cx, dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        const k = (0.25 - d) / (d || 1);
        p.x += dx * k || 0.25;
        p.z += dz * k;
      }
    }
    const R = 400;
    const r = Math.hypot(p.x, p.z);
    if (r > R) {
      p.x *= R / r;
      p.z *= R / r;
    }
  }
}

export function damp(a: number, b: number, k: number, dt: number) {
  return b + (a - b) * Math.exp(-k * dt);
}

/** Third-person chase camera with manual orbit, auto-recentre behind the pigeon, and ground clearance. */
export class ChaseCamera {
  yaw = 0;
  pitch = 0.32;
  dist = 4.2;
  private idle = 10;
  private look = new THREE.Vector3();
  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snapBehind(target: THREE.Vector3, yaw: number) {
    this.yaw = yaw;
    this.look.copy(target);
    this.place(target, 1);
  }

  update(dt: number, target: THREE.Vector3, pigeonYaw: number, moving: boolean, flying: boolean, it: Intent) {
    if (it.yaw || it.pitch) this.idle = 0;
    else this.idle += dt;
    this.yaw += it.yaw;
    this.pitch = Math.max(-0.35, Math.min(1.2, this.pitch + it.pitch));
    this.dist = Math.max(2.2, Math.min(14, this.dist * (1 + it.zoom)));
    if (moving && this.idle > 1.2) {
      let d = pigeonYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * (flying ? 1.6 : 1.0));
    }
    this.place(target, Math.min(1, dt * 8));
  }

  private place(target: THREE.Vector3, k: number) {
    this.look.lerp(target, k);
    const d = this.dist;
    const cx = this.look.x - Math.sin(this.yaw) * Math.cos(this.pitch) * d;
    const cz = this.look.z - Math.cos(this.yaw) * Math.cos(this.pitch) * d;
    let cy = this.look.y + 0.4 + Math.sin(this.pitch) * d;
    cy = Math.max(cy, groundHeight(cx, cz) + 0.35);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.look.x, this.look.y + 0.35, this.look.z);
  }
}
