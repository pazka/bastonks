// The forest, the Path, the Greenhouse and the decor, built in code from the layout. Everything repeated is
// instanced (a few dozen draw calls for ~170 Trees and ~2 100 Branches).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Fruit, Item, World } from "../shared/types.ts";
import { groundHeight, hashStr, type Layout, rng, type V3 } from "./layout.ts";
import { COLORS, SEASON_LEAVES, trelloColor } from "./palette.ts";
import { outlineInstanced, outlineMesh, toon } from "./toon.ts";

export type ItemKind = "branch" | "pot";

/** One inspectable thing in the world. */
export interface WorldItem {
  item: Item;
  kind: ItemKind;
  /** Where the glint and the inspect focus are. */
  p: V3;
  /** Where the pigeon may sit next to it. */
  perch: V3;
  tree: number;
  week?: string;
  list?: string;
  sprout?: boolean;
  /** Instances to animate when this item grows in (New Growth). */
  parts: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[];
}

export interface Collider {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export interface Forest {
  group: THREE.Group;
  items: WorldItem[];
  colliders: Collider[];
  /** Spheres the pigeon cannot enter (crown tops). */
  spheres: { c: V3; r: number }[];
  /** Greenhouse walls as segments in XZ, with height. */
  walls: { ax: number; az: number; bx: number; bz: number; h: number; y: number }[];
  peanutMesh: THREE.InstancedMesh;
  update(time: number, dt: number): void;
  hidePeanut(index: number): void;
  grow(items: WorldItem[], t: number): void;
}

const tmp = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  m.count = count;
  m.name = name;
  m.frustumCulled = false; // one mesh spans the whole forest
  return m;
}

function setColor(m: THREE.InstancedMesh, i: number, hex: number, c = new THREE.Color()) {
  m.setColorAt(i, c.setHex(hex));
}

/** Matrix placing a unit cylinder (y ∈ [0,1]) from a to b with radius r. */
function limbMatrix(a: V3, b: V3, r: number, out: THREE.Matrix4) {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
  return out.compose(new THREE.Vector3(a.x, a.y, a.z), q, new THREE.Vector3(r, len, r));
}

/** Low-poly look: one normal per face. */
function faceted(g: THREE.BufferGeometry) {
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return f;
}

// ---- geometries -----------------------------------------------------------------------------------------

function fruitGeometry(f: Fruit): THREE.BufferGeometry {
  const sphere = (r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) =>
    new THREE.SphereGeometry(r, 8, 6).scale(sx, sy, sz).translate(x, y, z);
  const stem = (y: number, h = 0.08) =>
    new THREE.CylinderGeometry(0.012, 0.012, h, 4).translate(0, y + h / 2, 0);
  const lathe = (pts: [number, number][]) =>
    new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 8);
  let parts: THREE.BufferGeometry[];
  switch (f) {
    case "apple":
      parts = [sphere(0.15, 0, 0, 0, 1, 0.88, 1), stem(0.12)];
      break;
    case "cherry":
      parts = [sphere(0.085, -0.07, -0.05), sphere(0.085, 0.07, -0.03), stem(0.02, 0.12)];
      break;
    case "plum":
      parts = [sphere(0.13, 0, 0, 0, 0.95, 1.12, 0.95), stem(0.13, 0.05)];
      break;
    case "pear":
      parts = [
        lathe([[0, -0.16], [0.12, -0.12], [0.13, -0.04], [0.07, 0.06], [0.05, 0.12], [0, 0.15]]),
        stem(0.14),
      ];
      break;
    case "lemon":
      parts = [sphere(0.12, 0, 0, 0, 1.35, 0.92, 0.92)];
      break;
    case "fig":
      parts = [
        lathe([[0, -0.13], [0.11, -0.09], [0.12, -0.01], [0.07, 0.08], [0.02, 0.13], [0, 0.14]]),
        stem(0.13, 0.04),
      ];
      break;
    default:
      parts = [
        sphere(0.06, 0, 0, 0),
        sphere(0.06, 0.08, 0.02, 0),
        sphere(0.06, -0.07, 0.03, 0.03),
        sphere(0.06, 0.02, -0.08, 0.02),
        sphere(0.06, -0.02, 0.02, 0.08),
        stem(0.05, 0.08),
      ];
  }
  const merged = mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p));
  merged.computeVertexNormals();
  return merged;
}

const FRUIT_BASE: Record<Fruit, number> = {
  apple: 0xe0503a,
  cherry: 0xc9283e,
  plum: 0x7a4fa0,
  pear: 0xc8d45a,
  lemon: 0xf7dc4a,
  fig: 0x8a5a8c,
  berries: 0x4b5fc2,
};

function potGeometry() {
  const pts = [[0.0, 0], [0.32, 0], [0.42, 0.5], [0.47, 0.52], [0.47, 0.62], [0.4, 0.62], [0.36, 0.55], [
    0,
    0.55,
  ]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 10);
  g.computeVertexNormals();
  return g;
}

function peanutGeometry() {
  const a = new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.1, 1).translate(0, 0.17, 0);
  const b = new THREE.SphereGeometry(0.22, 10, 8).scale(1, 1.1, 1).translate(0, -0.17, 0);
  const g = mergeGeometries([a.toNonIndexed(), b.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}

function blobTexture() {
  const s = 64;
  const d = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const r = Math.hypot(x - s / 2 + 0.5, y - s / 2 + 0.5) / (s / 2);
      const a = Math.max(0, 1 - r) ** 1.6;
      d.set([40, 50, 40, Math.round(a * 140)], (y * s + x) * 4);
    }
  }
  const t = new THREE.DataTexture(d, s, s);
  t.needsUpdate = true;
  return t;
}

/** A warm, hand-painted-looking grass tile: short blade strokes, clover dapples and tiny flecks of colour. */
function grassTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  const r = rng(1234);
  g.fillStyle = "#f6f0dc";
  g.fillRect(0, 0, S, S);
  // soft dapples (light through leaves)
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const warm = r() < 0.5;
    grd.addColorStop(0, warm ? "rgba(255, 236, 170, 0.35)" : "rgba(170, 200, 120, 0.22)");
    grd.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = grd;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) g.fillRect(x - rad + dx, y - rad + dy, rad * 2, rad * 2);
    }
  }
  // blades (wrapped so the tile repeats seamlessly)
  const blades = [
    "rgba(110, 150, 70, 0.45)",
    "rgba(150, 180, 80, 0.4)",
    "rgba(200, 200, 110, 0.35)",
    "rgba(90, 130, 60, 0.35)",
  ];
  g.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, len = 5 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
    g.strokeStyle = blades[Math.floor(r() * blades.length)];
    g.lineWidth = 1.2 + r() * 1.4;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
        g.stroke();
      }
    }
  }
  // clover and tiny warm flecks
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S;
    const fleck = r();
    g.fillStyle = fleck < 0.55
      ? "rgba(105, 150, 75, 0.45)"
      : fleck < 0.8
      ? "rgba(255, 214, 102, 0.8)"
      : fleck < 0.92
      ? "rgba(255, 255, 245, 0.85)"
      : "rgba(240, 150, 120, 0.75)";
    const rad = fleck < 0.55 ? 2.5 + r() * 2.5 : 1.4 + r() * 1.4;
    for (let k = 0; k < (fleck < 0.55 ? 3 : 1); k++) {
      g.beginPath();
      g.arc(
        x + (k ? Math.cos(k * 2.1) * rad : 0),
        y + (k ? Math.sin(k * 2.1) * rad : 0),
        rad,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A little five-petal flower: white petals (tinted per instance), golden heart. */
function flowerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    parts.push(
      new THREE.SphereGeometry(0.055, 6, 4).scale(1.5, 0.35, 0.8).rotateY(-a).translate(
        Math.cos(a) * 0.07,
        0.16,
        Math.sin(a) * 0.07,
      ),
    );
  }
  const heart = new THREE.SphereGeometry(0.04, 6, 4).scale(1, 0.6, 1).translate(0, 0.17, 0);
  const stem = new THREE.CylinderGeometry(0.008, 0.01, 0.16, 4).translate(0, 0.08, 0);
  const all = [...parts, heart, stem].map((p) => p.toNonIndexed());
  const colors = [...parts.map(() => [1, 1, 1]), [1, 0.78, 0.25], [0.45, 0.65, 0.3]];
  all.forEach((p, i) => {
    const n = p.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) col.set(colors[i], v * 3);
    p.setAttribute("color", new THREE.BufferAttribute(col, 3));
  });
  const g = mergeGeometries(all);
  g.computeVertexNormals();
  return g;
}

/** A small round mushroom: cream stem, cap tinted per instance. */
function mushroomGeometry() {
  const stem = new THREE.CylinderGeometry(0.05, 0.065, 0.18, 6).translate(0, 0.09, 0).toNonIndexed();
  const cap = new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1)
    .translate(0, 0.17, 0)
    .toNonIndexed();
  const paint = (p: THREE.BufferGeometry, c: number[]) => {
    const n = p.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) col.set(c, v * 3);
    p.setAttribute("color", new THREE.BufferAttribute(col, 3));
  };
  paint(stem, [1.0, 0.97, 0.9]);
  paint(cap, [1, 1, 1]);
  stem.deleteAttribute("uv");
  cap.deleteAttribute("uv");
  const g = mergeGeometries([stem, cap]);
  g.computeVertexNormals();
  return g;
}

// ---- build ----------------------------------------------------------------------------------------------

export function buildForest(
  world: World,
  layout: Layout,
  quality: { outlines: boolean; decor: number },
): Forest {
  const group = new THREE.Group();
  const items: WorldItem[] = [];
  const colliders: Collider[] = [];
  const spheres: { c: V3; r: number }[] = [];
  const c = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const addOutline = (m: THREE.InstancedMesh, t: number) => {
    if (quality.outlines) group.add(outlineInstanced(m, t));
  };

  // Ground: a square grid (no radial seams), far larger than the forest so its edge stays in the fog.
  const R = layout.radius * 3 + 200;
  const seg = 180;
  const rings = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg).rotateX(-Math.PI / 2);
  const gp = rings.getAttribute("position") as THREE.BufferAttribute;
  const gcol = new Float32Array(gp.count * 3);
  const gr = rng(7);
  const light = new THREE.Color(COLORS.grass), dark = new THREE.Color(COLORS.grassDark);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, groundHeight(x, z) - 0.02);
    c.copy(light).lerp(dark, 0.25 + 0.5 * gr() * gr());
    gcol.set([c.r, c.g, c.b], i * 3);
  }
  rings.setAttribute("color", new THREE.BufferAttribute(gcol, 3));
  rings.computeVertexNormals();
  const groundTex = grassTexture();
  groundTex.repeat.set((R * 2) / 7, (R * 2) / 7);
  const groundMesh = new THREE.Mesh(rings, toon(0xffffff, { vertexColors: true, map: groundTex }));
  groundMesh.name = "ground";
  group.add(groundMesh);

  // Path ribbon
  {
    const pts = layout.path;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l, nz = tx / l;
      const w = 1.6 + 0.25 * Math.sin(i * 0.37);
      for (const s of [-1, 1]) {
        const x = pts[i].x + nx * w * s, z = pts[i].z + nz * w * s;
        pos.push(x, groundHeight(x, z) + 0.04, z);
      }
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, toon(COLORS.path, { polygonOffset: true, polygonOffsetFactor: -2 }));
    m.name = "path";
    group.add(m);
  }

  // Counts
  const nTrees = layout.trees.length;
  const nBranches = layout.trees.reduce((n, t) => n + t.branches.length, 0);

  // Trunks
  const trunkGeo = faceted(new THREE.CylinderGeometry(0.62, 1, 1, 7, 1).translate(0, 0.5, 0));
  const trunks = instanced(trunkGeo, toon(0xffffff), nTrees, "trunks");
  // Limbs
  const limbGeo = faceted(new THREE.CylinderGeometry(0.55, 1, 1, 5, 1).translate(0, 0.5, 0));
  const limbs = instanced(limbGeo, toon(0xffffff), nBranches, "limbs");
  // Leaves: per branch 2 clusters + per tree 2 crown clusters
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const leaves = instanced(leafGeo, toon(0xffffff), nBranches * 2 + nTrees * 2, "leaves");
  // Fruits by species
  const species = world.species;
  const fruitCounts = new Map<Fruit, number>();
  for (const t of layout.trees) {
    for (const b of t.branches) {
      for (const l of b.item.labels) {
        fruitCounts.set(species[l].fruit, (fruitCounts.get(species[l].fruit) ?? 0) + 1);
      }
    }
  }
  for (const p of layout.pots) {
    for (const l of p.item.labels) {
      fruitCounts.set(species[l].fruit, (fruitCounts.get(species[l].fruit) ?? 0) + 1);
    }
  }
  const fruitMeshes = new Map<Fruit, THREE.InstancedMesh>();
  const fruitUsed = new Map<Fruit, number>();
  for (const [f, n] of fruitCounts) {
    const m = instanced(fruitGeometry(f), toon(0xffffff), n, `fruit-${f}`);
    fruitMeshes.set(f, m);
    fruitUsed.set(f, 0);
  }
  const fruitTint = new Map<number, number>();
  species.forEach((s, i) => {
    const base = new THREE.Color(FRUIT_BASE[s.fruit]);
    const lab = new THREE.Color(trelloColor(s.color, FRUIT_BASE[s.fruit]));
    fruitTint.set(i, base.lerp(lab, 0.6).getHex());
  });
  const addFruit = (label: number, at: V3, k: number, parts: WorldItem["parts"], scale = 1) => {
    const f = species[label].fruit;
    const m = fruitMeshes.get(f)!;
    const i = fruitUsed.get(f)!;
    fruitUsed.set(f, i + 1);
    const a = k * 2.2;
    tmp.position.set(
      at.x + Math.cos(a) * 0.22 * (k > 0 ? 1 : 0),
      at.y - 0.05 * k,
      at.z + Math.sin(a) * 0.22 * (k > 0 ? 1 : 0),
    );
    tmp.rotation.set(0, a, 0);
    tmp.scale.setScalar(scale);
    tmp.updateMatrix();
    m.setMatrixAt(i, tmp.matrix);
    setColor(m, i, fruitTint.get(label)!, c);
    parts.push({ mesh: m, index: i, matrix: tmp.matrix.clone() });
  };

  let li = 0, bi = 0;
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = instanced(
    shadowGeo,
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    nTrees,
    "tree-shadows",
  );
  layout.trees.forEach((t, ti) => {
    const r = rng(hashStr(t.tree.id) ^ 0x51ed27);
    const palette = SEASON_LEAVES[t.tree.season];
    // trunk
    tmp.position.set(t.pos.x, t.pos.y - 0.2, t.pos.z);
    tmp.rotation.set(0, r() * 6, 0);
    tmp.scale.set(t.trunkR, t.height + 0.2, t.trunkR);
    tmp.updateMatrix();
    trunks.setMatrixAt(ti, tmp.matrix);
    setColor(trunks, ti, r() < 0.5 ? COLORS.trunk : COLORS.trunkDark, c);
    colliders.push({ x: t.pos.x, z: t.pos.z, r: t.trunkR + 0.12, y0: t.pos.y - 1, y1: t.pos.y + t.height });
    // shadow
    tmp.position.set(t.pos.x, t.pos.y + 0.03, t.pos.z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(t.crownR * 2.6, 1, t.crownR * 2.6);
    tmp.updateMatrix();
    shadows.setMatrixAt(ti, tmp.matrix);
    // crown top
    const crownColor = palette[Math.floor(r() * palette.length)];
    for (let k = 0; k < 2; k++) {
      const cr = (0.7 + 0.25 * k) * Math.max(0.9, t.crownR * 0.55);
      tmp.position.set(
        t.pos.x + (r() - 0.5) * 0.4,
        t.pos.y + t.height + cr * (0.5 - k * 0.6),
        t.pos.z + (r() - 0.5) * 0.4,
      );
      tmp.rotation.set(r() * 3, r() * 3, r() * 3);
      tmp.scale.setScalar(cr);
      tmp.updateMatrix();
      leaves.setMatrixAt(li, tmp.matrix);
      setColor(leaves, li++, k === 0 ? crownColor : palette[Math.floor(r() * palette.length)], c);
      if (k === 0) {
        // solid crown top, but never over a perch (every Branch must stay reachable)
        const cp = { x: tmp.position.x, y: tmp.position.y, z: tmp.position.z };
        let rr = cr * 0.85;
        for (const b of t.branches) {
          for (const q of [b.perch, b.tip]) {
            rr = Math.min(rr, Math.hypot(q.x - cp.x, q.y - cp.y, q.z - cp.z) - 0.6);
          }
        }
        if (rr > 0.3) spheres.push({ c: cp, r: rr });
      }
    }
    // branches
    for (const b of t.branches) {
      const parts: WorldItem["parts"] = [];
      limbMatrix(b.base, b.tip, 0.05 + t.trunkR * 0.28, m4);
      limbs.setMatrixAt(bi, m4);
      setColor(limbs, bi, COLORS.trunk, c);
      parts.push({ mesh: limbs, index: bi, matrix: m4.clone() });
      bi++;
      const leafColor = b.item.cover ? trelloColor(b.item.cover) : palette[Math.floor(r() * palette.length)];
      for (let k = 0; k < 2; k++) {
        const s = b.leafR * (k === 0 ? 1 : 0.7);
        tmp.position.set(
          b.tip.x + (k ? (r() - 0.5) * 0.5 : 0),
          b.tip.y + (k ? 0.25 : 0),
          b.tip.z + (k ? (r() - 0.5) * 0.5 : 0),
        );
        tmp.rotation.set(r() * 3, r() * 3, r() * 3);
        tmp.scale.set(s, s * 0.85, s);
        tmp.updateMatrix();
        leaves.setMatrixAt(li, tmp.matrix);
        const col = k === 0 || b.item.cover ? leafColor : palette[Math.floor(r() * palette.length)];
        setColor(leaves, li, col, c);
        parts.push({ mesh: leaves, index: li, matrix: tmp.matrix.clone() });
        li++;
      }
      const hang = { x: b.tip.x, y: b.tip.y - b.leafR * 0.95, z: b.tip.z };
      b.item.labels.forEach((l, k) => addFruit(l, hang, k, parts));
      items.push({
        item: b.item,
        kind: "branch",
        p: b.tip,
        perch: b.perch,
        tree: ti,
        week: t.tree.week,
        parts,
      });
    }
  });
  leaves.count = li;
  for (const m of [trunks, limbs, leaves, shadows, ...fruitMeshes.values()]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  group.add(shadows, trunks, limbs, leaves, ...fruitMeshes.values());
  addOutline(trunks, 0.035);
  addOutline(limbs, 0.03);
  addOutline(leaves, 0.03);
  for (const m of fruitMeshes.values()) addOutline(m, 0.012);

  // Greenhouse
  const walls: Forest["walls"] = [];
  {
    const g = layout.greenhouse;
    const gh = new THREE.Group();
    gh.position.set(g.center.x, g.center.y, g.center.z);
    gh.rotation.y = g.yaw;
    const frameMat = toon(COLORS.frame);
    const bars: THREE.BufferGeometry[] = [];
    const bar = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      bars.push(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
    const hw = g.w / 2, hd = g.d / 2, h = g.h;
    const t = 0.09;
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) bar(x, h / 2, z, t, h, t);
    for (let x = -hw; x <= hw + 0.01; x += g.w / Math.ceil(g.w / 2)) {
      bar(x, h / 2, -hd, t * 0.6, h, t * 0.6);
      bar(x, h / 2, hd, t * 0.6, h, t * 0.6);
    }
    for (let z = -hd; z <= hd + 0.01; z += g.d / Math.ceil(g.d / 2)) {
      bar(-hw, h / 2, z, t * 0.6, h, t * 0.6);
      bar(hw, h / 2, z, t * 0.6, h, t * 0.6);
    }
    for (const y of [0.05, h]) {
      bar(0, y, -hd, g.w, t, t);
      bar(0, y, hd, g.w, t, t);
      bar(-hw, y, 0, t, t, g.d);
      bar(hw, y, 0, t, t, g.d);
    }
    // roof ridge
    const ridge = 1.3;
    bar(0, h + ridge, 0, t, t, g.d);
    for (let z = -hd; z <= hd + 0.01; z += g.d / Math.ceil(g.d / 2)) {
      const len = Math.hypot(hw, ridge);
      const ang = Math.atan2(ridge, hw);
      for (const s of [-1, 1]) {
        const b = new THREE.BoxGeometry(len, t * 0.7, t * 0.7);
        b.rotateZ(-s * ang); // from the eave (s·hw, h) up to the ridge (0, h + ridge)
        b.translate((s * hw) / 2, h + ridge / 2, z);
        bars.push(b);
      }
    }
    const frame = new THREE.Mesh(mergeGeometries(bars.map((b) => b.toNonIndexed())), frameMat);
    frame.name = "greenhouse-frame";
    if (quality.outlines) outlineMesh(frame, 0.02);
    gh.add(frame);
    // glass (door gap on the -z side, facing the path)
    const glassMat = new THREE.MeshBasicMaterial({
      color: COLORS.glass,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const panes: THREE.BufferGeometry[] = [];
    const door = 1.8;
    panes.push(new THREE.PlaneGeometry(g.w, h).translate(0, h / 2, hd));
    panes.push(new THREE.PlaneGeometry(hw - door / 2, h).translate(-(hw + door / 2) / 2, h / 2, -hd));
    panes.push(new THREE.PlaneGeometry(hw - door / 2, h).translate((hw + door / 2) / 2, h / 2, -hd));
    panes.push(new THREE.PlaneGeometry(g.w, h - 2.3).translate(0, 2.3 + (h - 2.3) / 2, -hd));
    for (const s of [-1, 1]) {
      panes.push(new THREE.PlaneGeometry(g.d, h).rotateY(Math.PI / 2).translate(s * hw, h / 2, 0));
    }
    const len = Math.hypot(hw, ridge), ang = Math.atan2(ridge, hw);
    for (const s of [-1, 1]) {
      panes.push(
        new THREE.PlaneGeometry(len, g.d).rotateX(-Math.PI / 2).rotateZ(-s * ang).translate(
          (s * hw) / 2,
          h + ridge / 2,
          0,
        ),
      );
    }
    for (const s of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([-hw, h, s * hd, hw, h, s * hd, 0, h + ridge, s * hd], 3),
      );
      tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, s, 0, 0, s, 0, 0, s], 3));
      tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      panes.push(tri);
    }
    const glass = new THREE.Mesh(mergeGeometries(panes.map((p) => p.index ? p.toNonIndexed() : p)), glassMat);
    glass.renderOrder = 2;
    glass.name = "greenhouse-glass";
    gh.add(glass);
    // floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(g.w, 0.1, g.d).translate(0, 0.02, 0), toon(0xd8c7a6));
    gh.add(floor);
    group.add(gh);
    // walls for collision (world space), door gap on the front wall
    const cos = Math.cos(g.yaw), sin = Math.sin(g.yaw);
    const w = (lx: number, lz: number) => ({
      x: g.center.x + lx * cos + lz * sin,
      z: g.center.z - lx * sin + lz * cos,
    });
    const seg = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      walls.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, h: h + ridge, y: g.center.y });
    seg(w(-hw, hd), w(hw, hd));
    seg(w(-hw, -hd), w(-hw, hd));
    seg(w(hw, -hd), w(hw, hd));
    seg(w(-hw, -hd), w(-door / 2, -hd));
    seg(w(door / 2, -hd), w(hw, -hd));
  }

  // Pots, soil, sprouts
  {
    const n = layout.pots.length;
    const pots = instanced(potGeometry(), toon(0xffffff), n, "pots");
    const soil = instanced(new THREE.CylinderGeometry(0.37, 0.37, 0.04, 10), toon(COLORS.soil), n, "soil");
    const sproutGeo = (() => {
      const stem = new THREE.CylinderGeometry(0.02, 0.025, 0.35, 4).translate(0, 0.175, 0);
      const l1 = new THREE.SphereGeometry(0.11, 6, 4).scale(1.6, 0.35, 0.8).translate(0.13, 0.33, 0);
      const l2 = new THREE.SphereGeometry(0.11, 6, 4).scale(1.6, 0.35, 0.8).translate(-0.13, 0.3, 0);
      const g = mergeGeometries([stem.toNonIndexed(), l1.toNonIndexed(), l2.toNonIndexed()]);
      g.computeVertexNormals();
      return g;
    })();
    const sprouts = instanced(
      sproutGeo,
      toon(COLORS.sprout),
      layout.pots.filter((p) => p.item.sprout).length,
      "sprouts",
    );
    let si = 0;
    layout.pots.forEach((p, i) => {
      const parts: WorldItem["parts"] = [];
      tmp.position.set(p.pos.x, p.pos.y + 0.07, p.pos.z);
      tmp.rotation.set(0, i, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      pots.setMatrixAt(i, tmp.matrix);
      setColor(pots, i, p.item.cover ? trelloColor(p.item.cover) : (i % 3 ? COLORS.pot : COLORS.potRim), c);
      parts.push({ mesh: pots, index: i, matrix: tmp.matrix.clone() });
      tmp.position.y += 0.56;
      tmp.updateMatrix();
      soil.setMatrixAt(i, tmp.matrix);
      parts.push({ mesh: soil, index: i, matrix: tmp.matrix.clone() });
      if (p.item.sprout) {
        sprouts.setMatrixAt(si, tmp.matrix);
        parts.push({ mesh: sprouts, index: si, matrix: tmp.matrix.clone() });
        si++;
      }
      p.item.labels.forEach((l, k) =>
        addFruit(l, { x: p.pos.x + 0.55, y: p.pos.y + 0.2 + k * 0.05, z: p.pos.z }, k, parts, 0.8)
      );
      const top = { x: p.pos.x, y: p.pos.y + 0.75, z: p.pos.z };
      items.push({
        item: p.item,
        kind: "pot",
        p: top,
        perch: { x: p.pos.x, y: p.pos.y + 0.7, z: p.pos.z },
        tree: -1,
        list: p.item.list,
        sprout: p.item.sprout,
        parts,
      });
      colliders.push({ x: p.pos.x, z: p.pos.z, r: 0.45, y0: p.pos.y - 1, y1: p.pos.y + 0.66 });
    });
    for (const m of [pots, soil, sprouts, ...fruitMeshes.values()]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    group.add(pots, soil, sprouts);
    addOutline(pots, 0.02);
    addOutline(sprouts, 0.015);
  }

  // Decor: grass tufts, flowers, clover patches, mushrooms, fallen leaves, rocks, bushes — off the Path,
  // the trunks and the Greenhouse. Warm and dense near the forest, sparser far away.
  {
    const r = rng(42);
    const n = Math.round(3600 * quality.decor);
    const tuftGeo = mergeGeometries(
      [0, 1, 2, 3].map((k) =>
        new THREE.ConeGeometry(0.05, 0.42, 3).translate(0, 0.21, 0).rotateZ((k - 1.5) * 0.3).rotateY(k * 1.7)
          .toNonIndexed()
      ),
    );
    tuftGeo.computeVertexNormals();
    const tufts = instanced(tuftGeo, toon(0xffffff), n, "tufts");
    const flowers = instanced(
      flowerGeometry(),
      toon(0xffffff, { vertexColors: true }),
      Math.round(n / 2.2),
      "flowers",
    );
    const clover = instanced(
      new THREE.CircleGeometry(0.5, 7).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
      toon(0xffffff),
      Math.round(n / 5),
      "clover",
    );
    const rocks = instanced(
      new THREE.DodecahedronGeometry(0.5, 0),
      toon(COLORS.rock),
      Math.round(n / 30),
      "rocks",
    );
    const bushes = instanced(
      new THREE.IcosahedronGeometry(0.8, 0),
      toon(0xffffff),
      Math.round(n / 22),
      "bushes",
    );
    const pathPts = layout.path;
    const g = layout.greenhouse;
    const clear = (x: number, z: number, margin: number) => {
      if (Math.hypot(x - g.center.x, z - g.center.z) < Math.max(g.w, g.d) / 2 + 1.5) return false;
      for (const t of layout.trees) {
        if (Math.abs(t.pos.x - x) < t.trunkR + margin && Math.abs(t.pos.z - z) < t.trunkR + margin) {
          if (Math.hypot(t.pos.x - x, t.pos.z - z) < t.trunkR + margin) return false;
        }
      }
      for (let i = 0; i < pathPts.length; i += 2) {
        const p = pathPts[i];
        if (Math.abs(p.x - x) < 2.1 && Math.abs(p.z - z) < 2.1) return false;
      }
      return true;
    };
    const set = (
      m: THREE.InstancedMesh,
      k: number,
      x: number,
      z: number,
      s: number,
      flat = false,
      lift = 0,
    ) => {
      tmp.position.set(x, groundHeight(x, z) + lift, z);
      tmp.rotation.set(0, r() * 6.3, 0);
      tmp.scale.set(s, flat ? 1 : s * (0.75 + r() * 0.5), s);
      tmp.updateMatrix();
      m.setMatrixAt(k, tmp.matrix);
    };
    const place = (
      m: THREE.InstancedMesh,
      count: number,
      scale: () => number,
      margin: number,
      color?: () => number,
      flat = false,
    ) => {
      let k = 0;
      for (let tries = 0; k < count && tries < count * 6; tries++) {
        // denser in the forest (inside the spiral), thinning out beyond it
        const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * (layout.radius + 30);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!clear(x, z, margin)) continue;
        set(m, k, x, z, scale(), flat);
        if (color) setColor(m, k, color(), c);
        k++;
      }
      m.count = k;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    const tuftColors = [0x6fb556, 0x86c25a, 0x9cc95a, 0x7db04f, 0xa9c766];
    const flowerColors = [0xffffff, 0xfff4d6, 0xffe08a, 0xffc9a8, 0xffc4d6, 0xd9c8ff];
    place(tufts, n, () => 0.7 + r() * 0.9, 0.35, () => tuftColors[Math.floor(r() * tuftColors.length)]);
    place(
      flowers,
      Math.round(n / 2.2),
      () => 0.8 + r() * 0.7,
      0.35,
      () => flowerColors[Math.floor(r() * flowerColors.length)],
    );
    place(
      clover,
      Math.round(n / 5),
      () => 0.6 + r() * 1.4,
      0.4,
      () => (r() < 0.6 ? 0x7fb956 : 0xa5c766),
      true,
    );
    place(rocks, Math.round(n / 30), () => 0.4 + r() * 1.2, 1.2);
    place(bushes, Math.round(n / 22), () => 0.6 + r() * 0.9, 1.5, () => (r() < 0.5 ? 0x5fa856 : 0x79bd5f));

    // around each trunk: a few mushrooms and fallen leaves in the tree's season
    const nt = layout.trees.length;
    const mush = instanced(
      mushroomGeometry(),
      toon(0xffffff, { vertexColors: true }),
      Math.round(nt * 1.5 * quality.decor) + 1,
      "mushrooms",
    );
    const fallen = instanced(
      new THREE.CircleGeometry(0.11, 5).scale(1.6, 1, 1).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
      toon(0xffffff),
      Math.round(nt * 10 * quality.decor) + 1,
      "fallen-leaves",
    );
    const capColors = [0xd9573b, 0xe8a04a, 0xf3e3c4, 0xc8784a];
    let mi = 0, fi = 0;
    for (const t of layout.trees) {
      const palette = SEASON_LEAVES[t.tree.season];
      const tr = rng(hashStr(t.tree.id) ^ 0xabc);
      const nm = Math.floor(tr() * 3.2 * quality.decor);
      for (let k = 0; k < nm && mi < mush.count; k++) {
        const a = tr() * 6.3, d = t.trunkR + 0.4 + tr() * 1.6;
        set(mush, mi, t.pos.x + Math.cos(a) * d, t.pos.z + Math.sin(a) * d, 0.7 + tr() * 0.8);
        setColor(mush, mi++, capColors[Math.floor(tr() * capColors.length)], c);
      }
      const nf = Math.floor((t.tree.season === "autumn" ? 16 : 6) * quality.decor);
      for (let k = 0; k < nf && fi < fallen.count; k++) {
        const a = tr() * 6.3, d = t.trunkR + 0.3 + tr() * t.crownR * 1.2;
        set(fallen, fi, t.pos.x + Math.cos(a) * d, t.pos.z + Math.sin(a) * d, 0.8 + tr() * 0.6, true);
        setColor(fallen, fi++, palette[Math.floor(tr() * palette.length)], c);
      }
    }
    mush.count = mi;
    fallen.count = fi;
    for (const m of [mush, fallen]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    group.add(tufts, flowers, clover, rocks, bushes, mush, fallen);
    addOutline(rocks, 0.03);
    addOutline(bushes, 0.03);
    addOutline(mush, 0.012);
  }

  // Golden Peanuts
  const peanutMesh = instanced(
    peanutGeometry(),
    toon(COLORS.peanut, { emissive: 0x6b4a00 }),
    layout.peanuts.length,
    "peanuts",
  );
  group.add(peanutMesh);
  addOutline(peanutMesh, 0.02);
  const hidden = new Set<number>();
  const growing = new Map<WorldItem, number>();

  return {
    group,
    items,
    colliders,
    spheres,
    walls,
    peanutMesh,
    update(time: number) {
      layout.peanuts.forEach((p, i) => {
        tmp.position.set(p.pos.x, p.pos.y + Math.sin(time * 2 + i) * 0.12, p.pos.z);
        tmp.rotation.set(0.3, time * 1.6 + i, 0.2);
        tmp.scale.setScalar(hidden.has(i) ? 0 : 1);
        tmp.updateMatrix();
        peanutMesh.setMatrixAt(i, tmp.matrix);
      });
      peanutMesh.instanceMatrix.needsUpdate = layout.peanuts.length > 0;
      if (growing.size) {
        const touched = new Set<THREE.InstancedMesh>();
        for (const [it, s] of growing) {
          for (const part of it.parts) {
            // scale each instance about its own origin
            const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
            part.matrix.decompose(pos, q, sc);
            if (part.mesh.name === "limbs") sc.set(sc.x * s, sc.y * s, sc.z * s);
            else sc.multiplyScalar(s);
            m4.compose(pos, q, sc);
            part.mesh.setMatrixAt(part.index, m4);
            touched.add(part.mesh);
          }
          if (s >= 1) growing.delete(it);
        }
        for (const m of touched) m.instanceMatrix.needsUpdate = true;
      }
    },
    hidePeanut(i: number) {
      hidden.add(i);
    },
    grow(list: WorldItem[], t: number) {
      const s = t <= 0 ? 0.001 : t >= 1 ? 1 : 1 - (1 - t) ** 3;
      for (const it of list) growing.set(it, s);
    },
  };
}
