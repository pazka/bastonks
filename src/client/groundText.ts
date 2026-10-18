// Words written in the earth, as if traced by hand while you watch:
// - the epigraph, in a ring around the spot where the pigeon begins (the start of the Path), on a sandy clearing;
// - each Tree's Week, written on the Path when the pigeon comes moderately close.
// Glyphs are drawn one by one with a little wobble, dark earth with a light rim, as if drawn with a stick.

import * as THREE from "three";
import { groundHeight, type Layout, type V3 } from "./layout.ts";
import { COLORS } from "./palette.ts";

/** Handwriting faces available on most devices; the generic `cursive` closes the list. */
const HAND =
  `"Segoe Print", "Bradley Hand", "Chalkboard SE", "Noteworthy", "Comic Neue", "Marker Felt", cursive`;
const INK = "#5b3b22";
const RIM = "rgba(255, 242, 214, 0.75)";

/** Deterministic wobble per glyph. */
function wobble(i: number, k: number) {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

interface Glyph {
  ch: string;
  x: number;
  y: number;
  rot: number;
  size: number;
}

/** One glyph traced into the soil; `a` (0..1) is how far its tracing has come. */
function drawGlyph(g: CanvasRenderingContext2D, gl: Glyph, i: number, a: number) {
  if (a <= 0 || gl.ch === " ") return;
  g.save();
  g.translate(gl.x, gl.y);
  g.rotate(gl.rot + wobble(i, 1) * 0.06);
  const s = gl.size * (1 + wobble(i, 2) * 0.05) * (0.85 + 0.15 * a);
  g.font = `${Math.round(s)}px ${HAND}`;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.globalAlpha = Math.min(1, a * 1.4);
  const dy = wobble(i, 3) * s * 0.04;
  g.fillStyle = RIM;
  g.fillText(gl.ch, 1.5, dy + 2.5); // the lighter lip of the groove
  g.fillStyle = INK;
  g.fillText(gl.ch, 0, dy);
  g.restore();
}

function texture(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A plane lying on the ground, subdivided and draped over the hills; canvas "up" points along `dir`. */
function drapedPlane(
  tex: THREE.Texture,
  w: number,
  h: number,
  at: V3,
  dir: { x: number; z: number },
  lift: number,
) {
  const geo = new THREE.PlaneGeometry(w, h, 24, 24).rotateX(-Math.PI / 2);
  const yaw = Math.atan2(-dir.x, -dir.z);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    const wx = at.x + lx * c + lz * s, wz = at.z - lx * s + lz * c;
    pos.setY(i, groundHeight(wx, wz) + lift);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      fog: true,
    }),
  );
  m.position.set(at.x, 0, at.z);
  m.rotation.y = yaw;
  m.renderOrder = 1;
  return m;
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

/** Radius of the epigraph ring's clearing, in world units (decor keeps out of it). */
export const CLEARING_RADIUS = 5.4;

interface Writing {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  glyphs: Glyph[];
  start: number;
  /** Glyphs traced per second. */
  speed: number;
  done: boolean;
  /** Extra strokes drawn when the writing is complete (the ring's circle). */
  after?: (g: CanvasRenderingContext2D, t: number) => void;
}

function redraw(w: Writing, now: number) {
  if (w.done || w.start < 0) return;
  const n = (now - w.start) * w.speed;
  const g = w.g;
  g.clearRect(0, 0, w.canvas.width, w.canvas.height);
  w.glyphs.forEach((gl, i) => drawGlyph(g, gl, i, Math.max(0, Math.min(1, n - i))));
  const extra = (n - w.glyphs.length) / (w.speed * 1.5);
  if (w.after) w.after(g, Math.max(0, Math.min(1, extra)));
  w.tex.needsUpdate = true;
  if (n >= w.glyphs.length + 1 && (!w.after || extra >= 1)) w.done = true;
}

export class PathWords {
  readonly group = new THREE.Group();
  private slots: { at: V3; dir: { x: number; z: number }; week: string }[];
  private pool: { mesh: THREE.Mesh; w: Writing; tree: number; text: string }[] = [];
  private ring: Writing;

  constructor(layout: Layout, epigraph: string[]) {
    // a date never lands inside the epigraph's clearing: slide it along the Path, out of the ring
    this.slots = layout.trees.map((t) => {
      const slot = { ...onPath(layout, t.pos), week: t.tree.week };
      const d = Math.hypot(slot.at.x - layout.start.x, slot.at.z - layout.start.z);
      const clear = CLEARING_RADIUS + 1.4;
      if (d < clear) {
        const push = clear - d + 0.2;
        slot.at = { x: slot.at.x + slot.dir.x * push, y: slot.at.y, z: slot.at.z + slot.dir.z * push };
      }
      return slot;
    });
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 192;
      const w: Writing = {
        canvas,
        g: canvas.getContext("2d")!,
        tex: texture(canvas),
        glyphs: [],
        start: -1,
        speed: 22,
        done: true,
      };
      // stretched along the Path like a road marking, so it reads normally from the pigeon's low viewpoint
      const mesh = drapedPlane(w.tex, 3.6, 2.4, { x: 0, y: 0, z: 0 }, { x: 0, z: 1 }, 0.08);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, w, tree: -1, text: "" });
    }

    // ---- the epigraph ring, centred where the pigeon starts ----
    const s = layout.start, yaw = layout.startYaw;
    const dir = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const clearing = new THREE.Mesh(
      new THREE.CircleGeometry(CLEARING_RADIUS, 48).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({ color: COLORS.path, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const cp = clearing.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) cp.setY(i, groundHeight(s.x + cp.getX(i), s.z + cp.getZ(i)) + 0.045);
    clearing.geometry.computeVertexNormals();
    clearing.position.set(s.x, 0, s.z);
    this.group.add(clearing);

    const S = 2048, C = S / 2;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const g = canvas.getContext("2d")!;
    const glyphs: Glyph[] = [];
    // Canvas "up" is the direction the pigeon faces, so each line is centred ahead of it, letters' tops
    // pointing outwards: read from the middle of the ring, they stand upright.
    const ringLine = (text: string, r: number, size: number) => {
      g.font = `${size}px ${HAND}`;
      const widths = [...text].map((ch) => g.measureText(ch).width * 1.04);
      const arc = widths.reduce((a, b) => a + b, 0) / r;
      let a = -Math.PI / 2 - arc / 2;
      [...text].forEach((ch, i) => {
        const half = widths[i] / 2 / r;
        a += half;
        glyphs.push({ ch, x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, rot: a + Math.PI / 2, size });
        a += half;
      });
    };
    ringLine(`${epigraph[0]} ${epigraph[1]}`, 860, 104);
    ringLine(epigraph.slice(2).join(" · "), 640, 82);
    this.ring = {
      canvas,
      g,
      tex: texture(canvas),
      glyphs,
      start: -1,
      speed: glyphs.length / 8, // the whole citation is traced in about eight seconds
      done: false,
      // then a wobbly circle is drawn round it, closing the ring
      after: (g, t) => {
        if (t <= 0) return;
        g.save();
        g.strokeStyle = INK;
        g.lineWidth = 6;
        g.lineCap = "round";
        g.globalAlpha = 0.8;
        g.beginPath();
        const end = t * Math.PI * 2;
        for (let a = 0; a <= end; a += 0.02) {
          const r = 960 + Math.sin(a * 7) * 6 + Math.sin(a * 23) * 3;
          const x = C + Math.cos(a - Math.PI / 2) * r, y = C + Math.sin(a - Math.PI / 2) * r;
          if (a === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
      },
    };
    this.group.add(drapedPlane(this.ring.tex, 10.4, 10.4, s, dir, 0.075));
  }

  /** Starts tracing the epigraph (during the descent of the intro, or at once when it is skipped). */
  revealEpigraph(now: number) {
    if (this.ring.start < 0) this.ring.start = now;
  }

  /** 0 = not started, 0.5 = being written, 1 = written. */
  get epigraphProgress() {
    if (this.ring.start < 0) return 0;
    return this.ring.done ? 1 : 0.5;
  }

  update(now: number, pigeon: THREE.Vector3 | null, label: (week: string) => string) {
    redraw(this.ring, now);
    // the nearest Trees within ~20 units get their date written on the Path
    const near: { i: number; d: number }[] = [];
    if (pigeon) {
      this.slots.forEach((s, i) => {
        const d = Math.hypot(s.at.x - pigeon.x, s.at.z - pigeon.z);
        if (d < 20) near.push({ i, d });
      });
    }
    near.sort((a, b) => a.d - b.d);
    const wanted = new Map(near.slice(0, this.pool.length).map((n) => [n.i, n.d]));
    for (const p of this.pool) if (p.tree >= 0 && !wanted.has(p.tree)) p.tree = -1;
    for (const [i, d] of wanted) {
      const p = this.pool.find((q) => q.tree === i) ?? this.pool.find((q) => q.tree === -1)!;
      const text = label(this.slots[i].week);
      if (p.tree !== i || p.text !== text) {
        p.tree = i;
        p.text = text;
        this.layoutDate(p, text, now);
        const slot = this.slots[i];
        const fresh = drapedPlane(p.w.tex, 3.6, 2.4, slot.at, slot.dir, 0.08);
        p.mesh.geometry.dispose();
        p.mesh.geometry = fresh.geometry;
        p.mesh.position.copy(fresh.position);
        p.mesh.rotation.copy(fresh.rotation);
        (fresh.material as THREE.Material).dispose();
      }
      redraw(p.w, now);
      // moderately close: fades in between 20 and 12 units
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(0.9, (20 - d) / 8));
      p.mesh.visible = true;
    }
    for (const p of this.pool) if (p.tree === -1) p.mesh.visible = false;
  }

  /** Lays the date's glyphs out on one line and starts tracing them. */
  private layoutDate(p: { w: Writing }, text: string, now: number) {
    const g = p.w.g;
    const size = 86;
    g.font = `${size}px ${HAND}`;
    const widths = [...text].map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const scale = Math.min(1, 980 / total);
    let x = 512 - (total * scale) / 2;
    p.w.glyphs = [...text].map((ch, i) => {
      const w = widths[i] * scale;
      const gl = { ch, x: x + w / 2, y: 128, rot: 0, size: size * scale };
      x += w;
      return gl;
    });
    p.w.start = now;
    p.w.done = false;
  }
}
