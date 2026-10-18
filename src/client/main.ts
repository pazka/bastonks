// bastonks — the garden. Boot: load the world, build it, play the Flyover, hand control to the Pigeon.

import * as THREE from "three";
import type { World } from "../shared/types.ts";
import { SoundBoard } from "./audio.ts";
import { buildForest, type WorldItem } from "./forest.ts";
import { Glints, GlintState } from "./glints.ts";
import { defaultLang, EPIGRAPH, fmtDate, lang, setLang, t } from "./i18n.ts";
import { PathWords } from "./groundText.ts";
import { Input, type Intent } from "./input.ts";
import { buildLayout, Grid, groundHeight, type Layout } from "./layout.ts";
import { COLORS, SEASON_LEAVES } from "./palette.ts";
import { codePigeon } from "./pigeon.ts";
import { ChaseCamera, damp, Player } from "./player.ts";
import { Progress } from "./progress.ts";
import { boosted, TUNING } from "./tuning.ts";
import { UI } from "./ui.ts";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;

/** Test hook (Playwright e2e): read-only state plus an autopilot that drives the real controls. */
interface Hook {
  ready: boolean;
  error?: string;
  flyoverDone: boolean;
  state(): unknown;
  autopilot(index: number): void;
  skip(): void;
}
const hook: Hook = {
  ready: false,
  flyoverDone: false,
  state: () => ({}),
  autopilot: () => {},
  skip: () => {},
};
(globalThis as unknown as { __bastonks: Hook }).__bastonks = hook;

async function loadWorld(): Promise<World> {
  const res = await fetch("/api/world", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`world ${res.status}`);
  return await res.json();
}

function makeSky(radius: number) {
  const g = new THREE.SphereGeometry(radius, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(COLORS.skyTop) },
      horizon: { value: new THREE.Color(COLORS.skyHorizon) },
    },
    vertexShader:
      `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
      void main(){ float h = clamp(vP.y * 1.6 + 0.05, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.7));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(g, m);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

function flyoverPath(layout: Layout, start: THREE.Vector3, end: THREE.Vector3): {
  pos: THREE.CatmullRomCurve3;
  look: THREE.CatmullRomCurve3;
} {
  const R = layout.radius;
  const g = layout.greenhouse.center;
  const pos = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-R * 0.9, R * 0.75, -R * 1.1),
      new THREE.Vector3(R * 0.2, R * 0.55, -R * 0.9),
      new THREE.Vector3(R * 0.85, R * 0.35, 0),
      new THREE.Vector3(g.x * 0.8 + 6, 16, g.z * 0.8 + 6),
      new THREE.Vector3(0, 14, 0).lerp(start, 0.5),
      end,
    ],
    false,
    "centripetal",
  );
  const look = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(g.x * 0.3, 0, g.z * 0.3),
    new THREE.Vector3(g.x, 1, g.z),
    start.clone().add(new THREE.Vector3(0, 1, 0)),
    start.clone().add(new THREE.Vector3(0, 0.35, 0)),
  ]);
  return { pos, look };
}

async function main() {
  const progress = new Progress();
  setLang(defaultLang(progress.lang));
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const loadingText = document.getElementById("loading-text")!;
  loadingText.textContent = t().loading;

  let world: World;
  try {
    world = await loadWorld();
  } catch (e) {
    loadingText.textContent = t().error;
    hook.error = String(e);
    return;
  }

  // ---- renderer & scene -----------------------------------------------------------------------------
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: "high-performance" });
  } catch (e) {
    loadingText.textContent = t().error;
    hook.error = `webgl: ${e}`;
    return;
  }
  const maxPR = coarse ? 1.5 : 2;
  // `?lowres` (headless tests on software GL): tiny render target, no outlines
  const lowres = new URLSearchParams(location.search).has("lowres");
  let pixelRatio = lowres ? 0.35 : Math.min(devicePixelRatio || 1, maxPR);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, 40, 220);
  scene.background = new THREE.Color(COLORS.skyHorizon);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  const sunDir = new THREE.Vector3(0.5, 0.9, 0.3).normalize();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x9bbf7a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.9);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(sun);

  const layout = buildLayout(world);
  const quality = { outlines: !lowres, decor: lowres ? 0.2 : coarse ? 0.5 : 1 };
  const forest = buildForest(world, layout, quality);
  scene.add(forest.group);
  const sky = makeSky(layout.radius * 4);
  scene.add(sky);

  const pigeon = codePigeon(!lowres);
  scene.add(pigeon.root);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2b3a2b, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  scene.add(shadow);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.22, 6).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: COLORS.peanut, transparent: true, opacity: 0.85 }),
  );
  arrow.visible = false;
  scene.add(arrow);

  const words = new PathWords(layout, EPIGRAPH);
  scene.add(words.group);

  const glints = new Glints(forest.items, pixelRatio * 2);
  scene.add(glints.points);

  // ---- state ----------------------------------------------------------------------------------------
  const items = forest.items;
  const allIds = items.map((i) => i.item.id);
  const isFirstVisit = progress.seenBefore.size === 0;
  const newIds = new Set(isFirstVisit ? [] : allIds.filter((id) => !progress.seenBefore.has(id)));
  progress.startVisit(allIds);
  const total = items.length;
  const peanutTotal = layout.peanuts.length;
  const peanutIds = new Set(layout.peanuts.map((p) => p.id));
  for (const id of [...progress.peanuts]) if (!peanutIds.has(id)) progress.peanuts.delete(id);
  const countFound = () => items.reduce((n, i) => n + (progress.found.has(i.item.id) ? 1 : 0), 0);
  items.forEach((it, i) => {
    glints.set(
      i,
      progress.found.has(it.item.id)
        ? GlintState.Found
        : newIds.has(it.item.id)
        ? GlintState.New
        : GlintState.Unfound,
    );
  });
  layout.peanuts.forEach((p, i) => {
    if (progress.peanuts.has(p.id)) forest.hidePeanut(i);
  });
  const newItems = items.filter((i) => newIds.has(i.item.id));
  forest.grow(newItems, 0);

  const itemGrid = new Grid<WorldItem & { idx: number }>(4);
  items.forEach((it, idx) => itemGrid.add(Object.assign(it, { idx })));
  const nearBuf: (WorldItem & { idx: number })[] = [];

  const ui = new UI(world.species);
  const audio = new SoundBoard(progress.muted);
  const input = new Input(canvas, document.getElementById("stick")!, document.getElementById("knob")!);
  const player = new Player(forest, layout.start, layout.startYaw);
  player.boost = progress.boostLevel;
  player.onFlap = () => audio.wing();
  player.onHop = () => audio.wing();
  player.onLand = () => audio.land();
  const chase = new ChaseCamera(camera);

  const refreshCounter = () => ui.setCounter(countFound(), total, progress.peanuts.size, peanutTotal);
  const refreshTexts = () => {
    ui.refreshTexts(progress.muted);
    refreshCounter();
    ui.setStale(world.stale);
  };
  refreshTexts();
  ui.onLang = () => {
    setLang(lang() === "fr" ? "en" : "fr");
    progress.lang = lang();
    progress.save();
    refreshTexts();
  };
  ui.onMute = () => {
    progress.muted = !progress.muted;
    audio.setMuted(progress.muted);
    ui.setMuted(progress.muted);
    progress.save();
  };
  let gestured = false;
  const onGesture = () => {
    if (gestured) return;
    gestured = true;
    audio.start();
  };
  input.onAnyGesture = onGesture;
  addEventListener("pointerdown", onGesture, { capture: true });
  for (const [id, which] of [["t-up", "up"], ["t-down", "down"]] as const) {
    const b = document.getElementById(id)!;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onGesture();
      input.setTouchButton(which, true);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
      b.addEventListener(ev, () => input.setTouchButton(which, false));
    }
  }
  document.getElementById("t-inspect")!.addEventListener("click", () => input.tapInspect());
  if (coarse) {
    document.body.classList.add("touch");
    input.touchMode = true;
  }

  // ---- flyover ----------------------------------------------------------------------------------------
  const startPos = new THREE.Vector3(layout.start.x, layout.start.y, layout.start.z);
  player.pos.copy(startPos);
  chase.snapBehind(startPos, layout.startYaw);
  const camEnd = camera.position.clone();
  const fly = flyoverPath(layout, startPos, camEnd);
  const flyDuration = reducedMotion
    ? TUNING.flyoverReduced
    : progress.visits > 0
    ? TUNING.flyoverReturn
    : TUNING.flyoverFirst;
  let flyT = 0;
  let inFlyover = true;
  input.enabled = false;
  ui.showTitles(false);
  setTimeout(() => ui.showTitles(true), 400);
  const endFlyover = () => {
    if (!inFlyover) return;
    inFlyover = false;
    input.enabled = true;
    hook.flyoverDone = true;
    ui.endFlyover();
    ui.showTouch(input.touchMode || coarse);
    chase.snapBehind(player.pos, player.yaw);
    growStart = performance.now() / 1000;
    words.revealEpigraph(growStart);
  };
  ui.onSkip = endFlyover;
  hook.skip = endFlyover;
  addEventListener("keydown", (e) => {
    if (inFlyover && (e.key === "Escape" || e.key === " " || e.key === "Enter")) endFlyover();
  });
  canvas.addEventListener("pointerdown", () => {
    if (inFlyover && flyT > 0.15) endFlyover();
  });

  // ---- autopilot (e2e and nothing else) -------------------------------------------------------------
  let autopilot: WorldItem | null = null;
  hook.autopilot = (i: number) => {
    autopilot = items.filter((it) => it.kind === "branch")[i] ?? null;
  };
  const pilot = (it: Intent): Intent => {
    if (!autopilot) return it;
    const tgt = autopilot.perch;
    const dx = tgt.x - player.pos.x, dz = tgt.z - player.pos.z, dy = tgt.y + 0.3 - player.pos.y;
    const h = Math.hypot(dx, dz);
    // world direction → camera-relative stick
    const fx = Math.sin(chase.yaw), fz = Math.cos(chase.yaw);
    const nx = h > 0.01 ? dx / h : 0, nz = h > 0.01 ? dz / h : 0;
    const k = Math.min(1, h / 4);
    const my = (nx * fx + nz * fz) * k, mx = -(nx * fz - nz * fx) * k;
    const there = target === autopilot;
    const perchedElsewhere = player.mode === "perch" && !there;
    return {
      ...it,
      mx: perchedElsewhere ? 0 : mx,
      my: perchedElsewhere ? 0 : my,
      up: dy > 0.25 && player.vel.y < 2.5,
      upPressed: player.mode === "ground" || (perchedElsewhere && dy > 0),
      down: dy < -0.8,
      downPressed: perchedElsewhere && dy <= 0,
      inspect: there && h < 0.8,
    };
  };

  // ---- inspect / found / peanuts --------------------------------------------------------------------
  let target: (WorldItem & { idx: number }) | null = null;
  let gesture = 0;
  /** The panel takes a hint of its tree's season (or of the Greenhouse). */
  const panelTint = (w: WorldItem) =>
    w.tree >= 0 ? SEASON_LEAVES[layout.trees[w.tree].tree.season][0] : COLORS.sprout;
  const inspect = (w: WorldItem & { idx: number }) => {
    if (ui.current === w) return;
    const wasNew = newIds.has(w.item.id);
    // the chime only when the panel opens; hopping from branch to branch just turns its page
    const opening = ui.current === null;
    ui.openPanel(w, wasNew, panelTint(w));
    if (opening) audio.inspect();
    gesture = 1;
    if (!progress.found.has(w.item.id)) {
      progress.found.add(w.item.id);
      newIds.delete(w.item.id);
      glints.setBase(w.idx, GlintState.Found);
      progress.save();
      refreshCounter();
      const found = countFound();
      if (found === total && !progress.complete) {
        progress.complete = true;
        progress.save();
        ui.celebrate();
        audio.celebrate();
      }
    }
    if (autopilot === w) autopilot = null;
  };

  // ---- adaptive quality -----------------------------------------------------------------------------
  let frames = 0, acc = 0, qualityStep = 0;
  const outlineMeshes: THREE.Object3D[] = [];
  forest.group.traverse((o) => {
    if (o.name.endsWith("-outline")) outlineMeshes.push(o);
  });
  const adapt = (dt: number) => {
    frames++;
    acc += dt;
    if (acc < 2.5) return;
    const fps = frames / acc;
    frames = 0;
    acc = 0;
    if (fps < 48 && qualityStep < 4) {
      qualityStep++;
      if (pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(innerWidth, innerHeight, false);
        glints.setPixelRatio(pixelRatio * 2);
      } else if (outlineMeshes[0]?.visible) {
        for (const o of outlineMeshes) o.visible = false;
      }
    }
  };

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  // ---- loop -----------------------------------------------------------------------------------------
  let last = performance.now() / 1000;
  let growStart = Infinity;
  let fpsNow = 30;
  const tmpV = new THREE.Vector3();
  let cooTimer = 20 + Math.random() * 30;
  let lastPerched: WorldItem | null = null;
  const motion = reducedMotion ? 0.3 : 1;

  hook.state = () => ({
    mode: player.mode,
    pos: player.pos.toArray(),
    found: countFound(),
    total,
    peanuts: progress.peanuts.size,
    panelOpen: ui.current !== null,
    panelTitle: ui.current?.item.name ?? null,
    target: target?.item.name ?? null,
    flyover: inFlyover,
    trees: layout.trees.length,
    drawCalls: renderer.info.render.calls,
    autopilot: autopilot !== null,
    fps: Math.round(fpsNow),
    epigraph: words.epigraphOpacity,
    dbg: autopilot ? { perch: (autopilot as WorldItem).perch, tip: (autopilot as WorldItem).p } : null,
  });

  const frame = () => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    fpsNow = fpsNow * 0.95 + (1 / Math.max(1e-3, now - last)) * 0.05;
    last = now;
    const time = now;

    if (inFlyover) {
      flyT += dt / flyDuration;
      const u = Math.min(1, flyT);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      camera.position.copy(fly.pos.getPointAt(e));
      camera.lookAt(fly.look.getPointAt(e));
      if (u > 0.72) ui.showTitles(false);
      if (u >= 1) endFlyover();
    }

    const raw = input.read();
    const it = inFlyover ? raw : pilot(raw);
    if (!inFlyover) {
      player.update(dt, it, chase.yaw);
      chase.update(dt, player.pos, player.yaw, player.speed > 0.4, player.mode === "fly", it);
    }

    // pigeon pose
    gesture = damp(gesture, 0, 3, dt);
    pigeon.root.position.copy(player.pos);
    pigeon.root.rotation.y = player.yaw;
    pigeon.animate({
      mode: player.mode === "perch" ? "perch" : player.mode,
      speed: player.speed,
      flap: player.flap,
      t: time,
      gesture,
    });
    const groundY = player.mode === "perch" ? player.pos.y : groundHeight(player.pos.x, player.pos.z);
    shadow.position.set(player.pos.x, groundY + 0.03, player.pos.z);
    const hgt = player.pos.y - groundY;
    shadow.scale.setScalar(Math.max(0.4, 1 - hgt * 0.05));
    (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.28 - hgt * 0.01);

    // nearest inspectable item
    const range = boosted(TUNING.inspectRange, TUNING.boost.inspectRange, player.boost);
    let best: (WorldItem & { idx: number }) | null = null, bd = Infinity;
    if (!inFlyover) {
      for (const c of itemGrid.near(player.pos, range, nearBuf)) {
        const d = c.p.x === undefined
          ? Infinity
          : tmpV.set(c.p.x, c.p.y, c.p.z).distanceToSquared(player.pos);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    if (best !== target) {
      target = best;
      glints.setTarget(best ? best.idx : -1);
    }
    ui.setPrompt(!!target && ui.current !== target, input.touchMode);
    if (target && it.inspect) inspect(target);
    // perched on a Branch: its card opens by itself (and follows the pigeon from branch to branch)
    if (player.mode === "perch" && player.perch) {
      if (player.perch.item !== lastPerched) {
        lastPerched = player.perch.item;
        inspect(player.perch.item as WorldItem & { idx: number });
      }
    } else if (!player.hopping) lastPerched = null;

    // peanuts
    let nearestPeanut: THREE.Vector3 | null = null, pd = Infinity;
    layout.peanuts.forEach((p, i) => {
      if (progress.peanuts.has(p.id)) return;
      const d = tmpV.set(p.pos.x, p.pos.y, p.pos.z).distanceTo(player.pos);
      if (!inFlyover && d < TUNING.pickupRange) {
        progress.peanuts.add(p.id);
        forest.hidePeanut(i);
        player.boost = progress.boostLevel;
        progress.save();
        audio.pickup();
        ui.toast(t().peanut);
        refreshCounter();
        return;
      }
      if (d < pd) {
        pd = d;
        nearestPeanut = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
      }
    });
    // Boost: a sense of the nearest peanut's direction
    const np = nearestPeanut as THREE.Vector3 | null;
    if (np && player.boost > 0 && !inFlyover) {
      arrow.visible = true;
      const dir = tmpV.copy(np).sub(player.pos).normalize();
      arrow.position.copy(player.pos).addScaledVector(dir, 0.7).add(new THREE.Vector3(0, 0.55, 0));
      arrow.lookAt(np);
    } else arrow.visible = false;

    // coo now and then when idle on the ground or a perch
    cooTimer -= dt;
    if (cooTimer < 0) {
      cooTimer = 25 + Math.random() * 55;
      if (!inFlyover && player.speed < 0.2 && player.mode !== "fly") {
        audio.coo();
        gesture = 0.6;
      }
    }

    // New Growth: grows in after the Flyover
    if (now > growStart && newItems.length) {
      forest.grow(newItems, (now - growStart) / (reducedMotion ? 0.6 : 2.5));
    }
    forest.update(time, dt);
    if (!inFlyover) words.update(now, player.pos, (week) => `${t().week} ${fmtDate(week)}`);
    else words.update(now, new THREE.Vector3(1e6, 0, 0), () => "");
    glints.update(
      time,
      player.pos,
      boosted(TUNING.glintRange, TUNING.boost.glintRange, player.boost),
      motion,
    );

    // fog follows altitude so the overview stays readable
    const fog = scene.fog as THREE.Fog;
    const alt = Math.max(0, camera.position.y);
    fog.near = 30 + alt * 1.1;
    fog.far = Math.min(layout.radius * 2.6 + 120, 140 + alt * 3.2);
    sky.position.copy(camera.position);

    renderer.render(scene, camera);
    if (!inFlyover) adapt(dt);
    requestAnimationFrame(frame);
  };

  ui.loaded();
  hook.ready = true;
  requestAnimationFrame(frame);
}

main().catch((e) => {
  hook.error = String(e);
  console.error(e);
});
