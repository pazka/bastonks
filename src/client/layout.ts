// Where everything stands. Pure and deterministic (no three.js), so it is unit-tested and identical on
// every visit: the Path is a winding spiral from 2023 (centre) outwards to 2026, Trees alternate along it,
// the Greenhouse stands where the Path ends.

import type { Item, SeedPot, Tree, World } from "../shared/types.ts";
import { TUNING } from "./tuning.ts";

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface BranchLayout {
  item: Item;
  tree: number;
  base: V3;
  tip: V3;
  /** Where the pigeon sits on the limb. */
  perch: V3;
  leafR: number;
}

export interface TreeLayout {
  tree: Tree;
  index: number;
  pos: V3;
  height: number;
  trunkR: number;
  crownR: number;
  branches: BranchLayout[];
}

export interface PotLayout {
  item: SeedPot;
  pos: V3;
}

export interface Peanut {
  id: string;
  pos: V3;
}

export interface Layout {
  trees: TreeLayout[];
  pots: PotLayout[];
  /** Centre line of the Path, sampled every ~1.5 units. */
  path: V3[];
  greenhouse: { center: V3; w: number; d: number; h: number; yaw: number; door: V3 };
  peanuts: Peanut[];
  start: V3;
  startYaw: number;
  radius: number;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Gentle rolling ground. */
export function groundHeight(x: number, z: number): number {
  return 0.55 * Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 - 0.4) + 0.3 * Math.sin((x + z) * 0.06);
}

export const SPIRAL = { r0: 16, ringGap: 30, step: 9.5, side: 6.5 };

/** Points of the spiral Path, `count` trees long. Returns [centre points, tangents] at every tree slot. */
function spiral(count: number) {
  const b = SPIRAL.ringGap / (2 * Math.PI);
  let theta = 0;
  const slots: { c: V3; t: V3; n: V3 }[] = [];
  const path: V3[] = [];
  const total = (count + 3) * SPIRAL.step;
  let travelled = 0;
  let nextSlot = SPIRAL.step;
  let nextSample = 0;
  const at = (th: number) => {
    const r = SPIRAL.r0 + b * th;
    return { x: Math.cos(th) * r, z: Math.sin(th) * r };
  };
  while (travelled < total) {
    const r = SPIRAL.r0 + b * theta;
    const dth = 0.25 / Math.sqrt(r * r + b * b);
    const p0 = at(theta), p1 = at(theta + dth);
    travelled += Math.hypot(p1.x - p0.x, p1.z - p0.z);
    theta += dth;
    if (travelled >= nextSample) {
      path.push({ x: p1.x, y: groundHeight(p1.x, p1.z), z: p1.z });
      nextSample += 1.5;
    }
    if (travelled >= nextSlot && slots.length < count + 2) {
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const t = { x: (p1.x - p0.x) / len, y: 0, z: (p1.z - p0.z) / len };
      slots.push({ c: { x: p1.x, y: 0, z: p1.z }, t, n: { x: -t.z, y: 0, z: t.x } });
      nextSlot += SPIRAL.step;
    }
  }
  return { slots, path };
}

export function treeShape(n: number) {
  return {
    height: 2.4 + 0.2 * n + 0.6 * Math.sqrt(n),
    trunkR: 0.16 + 0.011 * n,
    crownR: 1.3 + 0.075 * n,
  };
}

function layoutTree(tree: Tree, index: number, pos: V3): TreeLayout {
  const n = tree.branches.length;
  const { height, trunkR, crownR } = treeShape(n);
  const r = rng(hashStr(tree.id));
  const phase = r() * Math.PI * 2;
  // Branches fill the upper crown; successive ones stay close enough to hop between without boosts.
  const top = height * 0.92;
  const span = Math.min(height * 0.6, (n - 1) * 1.05);
  const branches: BranchLayout[] = tree.branches.map((item, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const y = top - span + span * t;
    const ang = phase + i * 2.39996323 + (r() - 0.5) * 0.4;
    const len = (0.8 + 0.45 * r()) * (crownR * (1.05 - 0.55 * t)) + 0.35;
    const lift = 0.35 + 0.35 * r();
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const base = { x: pos.x + dx * trunkR * 0.8, y: pos.y + y, z: pos.z + dz * trunkR * 0.8 };
    const tip = { x: base.x + dx * len, y: base.y + lift * len, z: base.z + dz * len };
    const k = 0.55;
    const perch = {
      x: base.x + (tip.x - base.x) * k,
      y: base.y + (tip.y - base.y) * k + 0.08,
      z: base.z + (tip.z - base.z) * k,
    };
    return { item, tree: index, base, tip, perch, leafR: 0.42 + 0.18 * r() };
  });
  return { tree, index, pos, height, trunkR, crownR, branches };
}

/** Vertical gaps between successive perches of a tree (the climb must stay possible without boosts). */
export function maxPerchGap(t: TreeLayout): number {
  const ys = t.branches.map((b) => b.perch.y).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < ys.length; i++) gap = Math.max(gap, ys[i] - ys[i - 1]);
  return gap;
}

export function buildLayout(world: World): Layout {
  const { slots, path } = spiral(world.trees.length);
  const trees = world.trees.map((tree, i) => {
    const s = slots[i];
    const side = i % 2 === 0 ? 1 : -1;
    const r = rng(hashStr(tree.id) ^ 0x9e3779b9);
    const off = SPIRAL.side + treeShape(tree.branches.length).crownR * 0.5 + r() * 1.5;
    const x = s.c.x + s.n.x * off * side + s.t.x * (r() - 0.5) * 2;
    const z = s.c.z + s.n.z * off * side + s.t.z * (r() - 0.5) * 2;
    return layoutTree(tree, i, { x, y: groundHeight(x, z), z });
  });

  // Greenhouse: beyond the end of the Path, facing it.
  const end = slots[Math.min(slots.length - 1, world.trees.length + 1)] ?? slots.at(-1)!;
  const cols = Math.max(4, Math.ceil(Math.sqrt(world.pots.length * 1.6)));
  const rows = Math.max(2, Math.ceil(world.pots.length / cols));
  const gap = 1.7;
  const w = cols * gap + 2, d = rows * gap + 2.5;
  const center = { x: end.c.x + end.t.x * (d / 2 + 4), y: 0, z: end.c.z + end.t.z * (d / 2 + 4) };
  center.y = groundHeight(center.x, center.z);
  const yaw = Math.atan2(end.t.x, end.t.z); // local +z points along the path, away from the forest
  const toWorld = (lx: number, lz: number): V3 => {
    const x = center.x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
    const z = center.z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
    return { x, y: center.y, z };
  };
  // Pots grouped by list (sorted so « En cours » pots, with sprouts, stand near the door).
  const sorted = [...world.pots].sort((a, b) =>
    Number(b.sprout) - Number(a.sprout) || a.list.localeCompare(b.list)
  );
  const pots = sorted.map((item, i) => {
    const c = i % cols, rr = Math.floor(i / cols);
    return { item, pos: toWorld((c - (cols - 1) / 2) * gap, -d / 2 + 1.8 + rr * gap) };
  });
  const door = toWorld(0, -d / 2);

  // Golden Peanuts next to Exceptional Cards.
  const ex = new Set(world.exceptional);
  const peanuts: Peanut[] = [];
  for (const t of trees) {
    for (const b of t.branches) {
      if (!ex.has(b.item.id)) continue;
      const dx = b.tip.x - b.base.x, dz = b.tip.z - b.base.z;
      const l = Math.hypot(dx, dz) || 1;
      peanuts.push({
        id: b.item.id,
        pos: { x: b.tip.x + (dx / l) * 0.9, y: b.tip.y + 0.35, z: b.tip.z + (dz / l) * 0.9 },
      });
    }
  }
  for (const p of pots) {
    if (ex.has(p.item.id)) peanuts.push({ id: p.item.id, pos: { ...p.pos, y: p.pos.y + 1.4 } });
  }

  const s0 = slots[0];
  const start = { x: s0.c.x - s0.t.x * 6, y: 0, z: s0.c.z - s0.t.z * 6 };
  start.y = groundHeight(start.x, start.z);
  let radius = 0;
  for (const t of trees) radius = Math.max(radius, Math.hypot(t.pos.x, t.pos.z));
  radius = Math.max(radius, Math.hypot(center.x, center.z) + Math.max(w, d));
  return {
    trees,
    pots,
    path,
    greenhouse: { center, w, d, h: 3.4, yaw, door },
    peanuts,
    start,
    startYaw: Math.atan2(s0.t.x, s0.t.z),
    radius: radius + 12,
  };
}

/** Uniform grid over XZ for "what is near the pigeon" queries. */
export class Grid<T extends { p: V3 }> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  private key(x: number, z: number) {
    return (Math.floor(x / this.size) + 4096) * 8192 + (Math.floor(z / this.size) + 4096);
  }
  add(v: T) {
    const k = this.key(v.p.x, v.p.z);
    const a = this.cells.get(k);
    if (a) a.push(v);
    else this.cells.set(k, [v]);
  }
  near(p: V3, r: number, out: T[] = []): T[] {
    out.length = 0;
    const r2 = r * r;
    const x0 = Math.floor((p.x - r) / this.size), x1 = Math.floor((p.x + r) / this.size);
    const z0 = Math.floor((p.z - r) / this.size), z1 = Math.floor((p.z + r) / this.size);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const a = this.cells.get((x + 4096) * 8192 + (z + 4096));
        if (!a) continue;
        for (const v of a) {
          const dx = v.p.x - p.x, dy = v.p.y - p.y, dz = v.p.z - p.z;
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(v);
        }
      }
    }
    return out;
  }
}

export const LAYOUT_LIMITS = { climbReach: TUNING.climbReach };
