// Words painted on the Path: each Tree's Week, which appears when the pigeon comes moderately close, and
// the epigraph at the beginning of the Path, which fades in once the Flyover ends and then stays.

import * as THREE from "three";
import { groundHeight, type Layout, type V3 } from "./layout.ts";

const INK = "#6f4b2e";

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, canvas: c, g };
}

/** A flat, transparent plane lying on the ground, text "up" pointing along `dir` (read while walking forward). */
function groundPlane(tex: THREE.Texture, w: number, h: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      fog: true,
    }),
  );
  m.renderOrder = 1;
  return m;
}

function place(m: THREE.Mesh, at: V3, dir: { x: number; z: number }) {
  m.position.set(at.x, groundHeight(at.x, at.z) + 0.08, at.z);
  m.rotation.y = Math.atan2(-dir.x, -dir.z);
}

/** Nearest Path sample to a point, with the Path's direction there. */
function onPath(layout: Layout, p: V3) {
  let best = 0, bd = Infinity;
  layout.path.forEach((q, i) => {
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  const a = layout.path[Math.max(0, best - 1)], b = layout.path[Math.min(layout.path.length - 1, best + 1)];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { at: layout.path[best], dir: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
}

export class PathWords {
  readonly group = new THREE.Group();
  private slots: { at: V3; dir: { x: number; z: number }; week: string }[];
  private pool: {
    mesh: THREE.Mesh;
    canvas: HTMLCanvasElement;
    g: CanvasRenderingContext2D;
    tex: THREE.CanvasTexture;
    tree: number;
    text: string;
  }[] = [];
  private epigraph: THREE.Mesh;
  private epigraphT = -1;
  private epigraphBase = 0;

  constructor(layout: Layout, epigraph: string[]) {
    this.slots = layout.trees.map((t) => ({ ...onPath(layout, t.pos), week: t.tree.week }));
    for (let i = 0; i < 6; i++) {
      const { tex, canvas, g } = canvasTexture(1024, 192, () => {});
      // stretched along the Path like a road marking, so it reads normally from the pigeon's low viewpoint
      const mesh = groundPlane(tex, 3.6, 2.4);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, canvas, g, tex, tree: -1, text: "" });
    }
    // the epigraph floats upright above the beginning of the Path, a few steps ahead of the pigeon
    const s = layout.start, yaw = layout.startYaw;
    const dir = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const { tex } = canvasTexture(1024, 720, (g) => {
      // a soft paper-coloured halo keeps the words legible over the scenery
      const halo = g.createRadialGradient(512, 360, 60, 512, 360, 520);
      halo.addColorStop(0, "rgba(255, 248, 232, 0.6)");
      halo.addColorStop(0.7, "rgba(255, 248, 232, 0.3)");
      halo.addColorStop(1, "rgba(255, 248, 232, 0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, 1024, 720);
      g.textAlign = "center";
      g.fillStyle = INK;
      g.shadowColor = "rgba(255, 245, 225, 0.9)";
      g.shadowBlur = 10;
      epigraph.forEach((line, i) => {
        const italic = i < 2;
        g.font = `${italic ? "italic " : ""}${i < 2 ? 76 : 54}px "Iowan Old Style", Palatino, Georgia, serif`;
        g.fillText(line, 512, 120 + i * (i < 2 ? 112 : 96) + (i >= 2 ? 60 : 0));
      });
    });
    this.epigraph = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.4),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        side: THREE.DoubleSide,
      }),
    );
    this.epigraph.renderOrder = 3;
    const ex = s.x + dir.x * 7.5, ez = s.z + dir.z * 7.5;
    this.epigraphBase = groundHeight(ex, ez) + 1.3;
    this.epigraph.position.set(ex, this.epigraphBase, ez);
    this.epigraph.rotation.y = Math.atan2(-dir.x, -dir.z); // faces the pigeon's starting point
    this.group.add(this.epigraph);
  }

  /** Starts the epigraph's fade-in (end of the Flyover). */
  revealEpigraph(now: number) {
    if (this.epigraphT < 0) this.epigraphT = now;
  }

  get epigraphOpacity() {
    return (this.epigraph.material as THREE.MeshBasicMaterial).opacity;
  }

  update(now: number, pigeon: THREE.Vector3, label: (week: string) => string) {
    if (this.epigraphT >= 0) {
      (this.epigraph.material as THREE.MeshBasicMaterial).opacity = Math.min(
        0.95,
        (now - this.epigraphT) / 3.5,
      );
    }
    this.epigraph.position.y = this.epigraphBase + Math.sin(now * 0.6) * 0.06;
    // the nearest Trees within ~20 units get a painted date on the Path
    const near: { i: number; d: number }[] = [];
    this.slots.forEach((s, i) => {
      const d = Math.hypot(s.at.x - pigeon.x, s.at.z - pigeon.z);
      if (d < 20) near.push({ i, d });
    });
    near.sort((a, b) => a.d - b.d);
    const wanted = new Map(near.slice(0, this.pool.length).map((n) => [n.i, n.d]));
    for (const p of this.pool) if (p.tree >= 0 && !wanted.has(p.tree)) p.tree = -1;
    for (const [i, d] of wanted) {
      const p = this.pool.find((q) => q.tree === i) ?? this.pool.find((q) => q.tree === -1)!;
      if (p.tree !== i) {
        p.tree = i;
        place(p.mesh, this.slots[i].at, this.slots[i].dir);
      }
      const text = label(this.slots[i].week);
      if (p.text !== text) {
        p.text = text;
        const g = p.g;
        g.clearRect(0, 0, 1024, 192);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `600 84px "Iowan Old Style", Palatino, Georgia, serif`;
        g.fillStyle = INK;
        g.shadowColor = "rgba(255, 245, 225, 0.9)";
        g.shadowBlur = 8;
        g.fillText(text, 512, 100, 1000);
        p.tex.needsUpdate = true;
      }
      // moderately close: fades in between 20 and 12 units
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(0.85, (20 - d) / 8));
      p.mesh.visible = true;
    }
    for (const p of this.pool) if (p.tree === -1) p.mesh.visible = false;
  }
}
