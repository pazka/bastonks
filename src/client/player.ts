// The Pigeon's movement (flies, lands, walks, hops, perches, climbs) and the third-person chase camera.
// Collision is hand-written: ground height, trunk cylinders, crown spheres, Greenhouse walls. No physics engine.

import * as THREE from "three";
import type { Collider, Forest, WorldItem } from "./forest.ts";
import { Grid, groundHeight, type V3 } from "./layout.ts";
import type { Intent } from "./input.ts";
import type { PigeonMode } from "./pigeon.ts";
import { boosted, TUNING } from "./tuning.ts";

export interface PerchPoint {
  p: V3;
  item: WorldItem;
  /** The tree's Branches sorted from the lowest to the highest perch (empty for Seed Pots). */
  ladder: PerchPoint[];
  rank: number;
}

/** Where a hop lands: a perch, or the ground below the lowest branch. */
type HopTarget = { perch: PerchPoint; ground?: undefined } | { perch?: undefined; ground: V3 };

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  mode: PigeonMode = "ground";
  flap = 0;
  perch: PerchPoint | null = null;
  private hop: { from: THREE.Vector3; to: HopTarget; t: number } | null = null;
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
    const byTree = new Map<number, PerchPoint[]>();
    for (const item of forest.items) {
      const pp: PerchPoint = { p: item.perch, item, ladder: [], rank: 0 };
      this.perches.add(pp);
      if (item.tree >= 0) {
        const l = byTree.get(item.tree) ?? [];
        l.push(pp);
        byTree.set(item.tree, l);
      }
    }
    for (const ladder of byTree.values()) {
      ladder.sort((a, b) => a.p.y - b.p.y);
      ladder.forEach((pp, i) => {
        pp.ladder = ladder;
        pp.rank = i;
      });
    }
    for (const c of forest.colliders) this.colliderGrid.add({ p: { x: c.x, y: 0, z: c.z }, c });
  }

  /** True while hopping between branches (or down to the ground). */
  get hopping() {
    return this.hop !== null;
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
      // Boost "easier climbing": quicker hops.
      this.hop.t += dt / (0.42 / boosted(1, TUNING.boost.climbReach, this.boost));
      const t = Math.min(1, this.hop.t);
      const to = this.hop.to.perch?.p ?? this.hop.to.ground!;
      this.pos.lerpVectors(this.hop.from, new THREE.Vector3(to.x, to.y, to.z), t);
      this.pos.y += Math.sin(t * Math.PI) * 0.5;
      if (t >= 1) {
        if (this.hop.to.perch) {
          this.perch = this.hop.to.perch;
          this.mode = "perch";
        } else {
          this.perch = null;
          this.mode = "ground";
        }
        this.hop = null;
        this.onLand?.();
      }
      this.vel.set(0, 0, 0);
      return;
    }

    if (this.mode === "perch" && this.perch) {
      const pp = this.perch;
      this.pos.set(pp.p.x, pp.p.y, pp.p.z);
      this.vel.set(0, 0, 0);
      if (wish > 0.1) this.faceToward(wx, wz, dt, 4);
      if (it.upPressed) {
        // next Branch up; from the highest one, take off
        const next = pp.ladder[pp.rank + 1];
        if (next) this.startHop({ perch: next });
        else this.takeOff(wx, wz, 4.5);
      } else if (it.downPressed) {
        // next Branch down; from the lowest one (or a Seed Pot), hop down to the ground and walk
        const prev = pp.ladder.length ? pp.ladder[pp.rank - 1] : undefined;
        if (prev) this.startHop({ perch: prev });
        else this.startHop({ ground: this.groundBelow(pp) });
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
        // at the foot of a tree: hop onto its lowest Branch; elsewhere: take off
        const near = this.nearestLowestPerch(climb + 0.6);
        if (near) this.startHop({ perch: near });
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
        this.onFlap?.();
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
      // perch on a branch when coming down close to one (not while flapping up)
      if (this.vel.y <= 0.5 && !it.up) {
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

  private startHop(to: HopTarget) {
    this.hop = { from: this.pos.clone(), to, t: 0 };
    this.mode = "fly";
    this.flap = 0.6;
    this.onHop?.();
  }

  /** A spot on the ground just outside the trunk, below a perch. */
  private groundBelow(pp: PerchPoint): V3 {
    const t = this.forest.colliders.find((c) =>
      c.r > 0 && pp.item.tree >= 0 && Math.hypot(c.x - pp.p.x, c.z - pp.p.z) < 4
    );
    let x = pp.p.x, z = pp.p.z;
    if (t) {
      const dx = pp.p.x - t.x, dz = pp.p.z - t.z, d = Math.hypot(dx, dz) || 1;
      const r = Math.max(d, t.r + 0.6);
      x = t.x + (dx / d) * r;
      z = t.z + (dz / d) * r;
    }
    return { x, y: groundHeight(x, z), z };
  }

  /** The lowest Branch of the nearest tree, if the pigeon stands at its foot. */
  private nearestLowestPerch(reach: number): PerchPoint | null {
    let best: PerchPoint | null = null, bd = Infinity;
    for (const c of this.perches.near(this.pos, 5, this.near)) {
      const low = c.ladder[0];
      if (!low || low !== c) continue;
      const h = Math.hypot(low.p.x - this.pos.x, low.p.z - this.pos.z);
      if (h > 3 || low.p.y - this.pos.y > reach + 4.5) continue;
      if (h < bd) {
        bd = h;
        best = low;
      }
    }
    return best;
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

  /** Perched among the leaves, the camera comes closer so foliage does not fill the view. */
  perched = false;

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
    const d = this.perched ? Math.min(this.dist, 2.6) : this.dist;
    this.effDist += (d - this.effDist) * Math.min(1, dt * 3);
    this.place(target, Math.min(1, dt * 8));
  }

  private effDist = 4.2;
  private place(target: THREE.Vector3, k: number) {
    this.look.lerp(target, k);
    const d = this.effDist;
    const cx = this.look.x - Math.sin(this.yaw) * Math.cos(this.pitch) * d;
    const cz = this.look.z - Math.cos(this.yaw) * Math.cos(this.pitch) * d;
    let cy = this.look.y + 0.4 + Math.sin(this.pitch) * d;
    cy = Math.max(cy, groundHeight(cx, cz) + 0.35);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.look.x, this.look.y + 0.35, this.look.z);
  }
}
