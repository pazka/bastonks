// bastonks — the garden. Boot: load the world, build it, play the Flyover, hand control to the Pigeon.

import * as THREE from "three";
import type { World } from "../shared/types.ts";
import { SoundBoard } from "./audio.ts";
import { buildForest, type WorldItem } from "./forest.ts";
import { Glints, GlintState } from "./glints.ts";
import { defaultLang, EPIGRAPH, fmtDate, lang, setLang, t } from "./i18n.ts";
import { PathWords } from "./groundText.ts";
import { Flutter } from "./particles.ts";
import { Weather, WIND } from "./wind.ts";
import { Input, type Intent } from "./input.ts";
import { buildLayout, Grid, groundHeight, type Layout } from "./layout.ts";
import { COLORS, SEASON_LEAVES } from "./palette.ts";
import { codePigeon } from "./pigeon.ts";
import { ChaseCamera, damp, type PerchPoint, Player } from "./player.ts";
import { Progress } from "./progress.ts";
import { TUNING } from "./tuning.ts";
import { UI } from "./ui.ts";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;

/** Test hook (Playwright e2e): read-only state plus an autopilot that drives the real controls. */
interface Hook {
  /** The world is built and the enter button is offered. */
  ready: boolean;
  /** The visitor pressed it: the intro plays. */
  entered: boolean;
  error?: string;
  flyoverDone: boolean;
  state(): unknown;
  autopilot(index: number, kind?: "branch" | "pot"): void;
  teleport(index: number, kind?: "branch" | "pot"): void;
  skip(): void;
}
const hook: Hook = {
  ready: false,
  entered: false,
  flyoverDone: false,
  state: () => ({}),
  autopilot: () => {},
  teleport: () => {},
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

/**
 * The intro: one slow spiral descending onto the pigeon. Starts high above, turns `turns` times around the
 * starting point while coming down and closer, and ends exactly at the chase camera's first position.
 */
function spiralIntro(layout: Layout, start: THREE.Vector3, end: THREE.Vector3, turns: number) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const endAngle = Math.atan2(dx, dz), endR = Math.hypot(dx, dz);
  const R0 = layout.radius * 0.8, H0 = layout.radius * 0.85;
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  return (u: number) => {
    const e = u * u * (3 - 2 * u); // ease in and out
    const k = 1 - e;
    const a = endAngle + k * turns * Math.PI * 2;
    const r = endR + (R0 - endR) * Math.pow(k, 1.25);
    const h = end.y + (H0 - end.y) * Math.pow(k, 1.7);
    pos.set(start.x + Math.sin(a) * r, h, start.z + Math.cos(a) * r);
    look.set(start.x, start.y + 0.35 * e, start.z);
    return { pos, look };
  };
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
  const words = new PathWords(layout, EPIGRAPH);
  if (lowres) words.live = false;
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
  const newItems = items.filter((i) => newIds.has(i.item.id));
  forest.grow(newItems, 0);

  const itemGrid = new Grid<WorldItem & { idx: number }>(4);
  items.forEach((it, idx) => itemGrid.add(Object.assign(it, { idx })));
  const nearBuf: (WorldItem & { idx: number })[] = [];

  const ui = new UI(world.species);
  const audio = new SoundBoard(progress.muted);
  const input = new Input(canvas, document.getElementById("stick")!, document.getElementById("knob")!);
  const player = new Player(forest, layout.start, layout.startYaw);
  player.onFlap = () => audio.wing();
  const flutter = new Flutter();
  scene.add(flutter.mesh);
  const weather = new Weather();
  /** Leaf colours of the tree a Branch belongs to (falling leaves match their tree). */
  const leafPalette = (it: WorldItem) =>
    it.tree >= 0 ? SEASON_LEAVES[layout.trees[it.tree].tree.season] : [COLORS.sprout];
  player.onHop = () => {
    audio.wing();
    if (player.perch) {
      forest.bounce(player.perch.item, performance.now() / 1000);
      flutter.burst(player.perch.item.p, 2, leafPalette(player.perch.item));
    }
  };
  player.onLand = () => {
    if (player.perch) {
      // the branch takes the pigeon's weight: it swings and a few leaves let go (silently)
      forest.bounce(player.perch.item, performance.now() / 1000);
      flutter.burst(player.perch.item.p, 3 + Math.floor(Math.random() * 3), leafPalette(player.perch.item));
    } else if (player.mode === "ground") {
      audio.land();
      flutter.burst(player.pos, 4, [COLORS.grassDark, COLORS.grass, 0xffffff, 0xffe08a], 1.2, 0.25);
    }
  };
  const chase = new ChaseCamera(camera);

  const applyMouse = () => {
    input.lookX = progress.invertX ? -1 : 1;
    input.lookY = progress.invertY ? -1 : 1;
    ui.mouse = { x: progress.invertX, y: progress.invertY };
  };
  applyMouse();
  ui.onMouseOption = (axis, inverted) => {
    if (axis === "x") progress.invertX = inverted;
    else progress.invertY = inverted;
    progress.save();
    applyMouse();
  };
  const refreshCounter = () => ui.setCounter(countFound(), total);
  const refreshTexts = () => {
    ui.refreshTexts(progress.muted);
    refreshCounter();
    ui.setStale(world.stale, world.snapshotAt);
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
  ui.setupFullscreen(coarse);

  // ---- flyover ----------------------------------------------------------------------------------------
  const startPos = new THREE.Vector3(layout.start.x, layout.start.y, layout.start.z);
  player.pos.copy(startPos);
  chase.snapBehind(startPos, layout.startYaw);
  const camEnd = camera.position.clone();
  const flyDuration = reducedMotion
    ? TUNING.flyoverReduced
    : progress.visits > 0
    ? TUNING.flyoverReturn
    : TUNING.flyoverFirst;
  const intro = spiralIntro(layout, startPos, camEnd, TUNING.introTurnRate * flyDuration);
  // the title stays up `introReadExtra` seconds longer than the spiral alone would keep it
  const titlesUntil = (0.62 * (flyDuration - TUNING.introReadExtra) + TUNING.introReadExtra) / flyDuration;
  let flyT = 0;
  let inFlyover = true;
  input.enabled = false;
  ui.showTitles(false);
  let entered = false; // the intro waits behind the loading screen for the enter button
  const endFlyover = () => {
    if (!inFlyover) return;
    inFlyover = false;
    input.enabled = true;
    hook.flyoverDone = true;
    ui.endFlyover();
    ui.showTouch(input.touchMode || coarse);
    ui.offerFullscreen(input.touchMode || coarse);
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
  hook.autopilot = (i: number, kind: "branch" | "pot" = "branch") => {
    autopilot = items.filter((it) => it.kind === kind)[i] ?? null;
  };
  /** Test hook: put the pigeon on the ground next to an item (for screenshots of distant places). */
  hook.teleport = (i: number, kind: "branch" | "pot" = "pot") => {
    const it = items.filter((x) => x.kind === kind)[i];
    if (!it) return;
    player.pos.set(it.perch.x - 1.6, groundHeight(it.perch.x - 1.6, it.perch.z - 1.2), it.perch.z - 1.2);
    player.mode = "ground";
    player.perch = null;
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
    const there = player.perch?.item === autopilot;
    const perchedElsewhere = player.mode === "perch" && !there;
    return {
      ...it,
      mx: perchedElsewhere ? 0 : mx,
      my: perchedElsewhere ? 0 : my,
      up: dy > 0.25 && player.vel.y < 2.5,
      upPressed: player.mode === "ground" || (perchedElsewhere && dy > 0),
      down: dy < -0.8,
      downPressed: perchedElsewhere && dy <= 0,
      inspect: false, // the card opens by perching, like a visitor's would
    };
  };

  // ---- inspect / found --------------------------------------------------------------------
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
      words.live = false; // a struggling device: words appear at once instead of being traced
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
  let cooTimer = 20 + Math.random() * 30;
  let lastPerched: WorldItem | null = null;
  let lastPot: WorldItem | null = null;
  const motion = reducedMotion ? 0.3 : 1;

  hook.state = () => ({
    mode: player.mode,
    pos: player.pos.toArray(),
    found: countFound(),
    total,
    panelOpen: ui.current !== null,
    panelTitle: ui.current?.item.name ?? null,
    target: target?.item.name ?? null,
    flyover: inFlyover,
    trees: layout.trees.length,
    drawCalls: renderer.info.render.calls,
    autopilot: autopilot !== null,
    fps: Math.round(fpsNow),
    epigraph: words.epigraphProgress,
    dbg: autopilot ? { perch: (autopilot as WorldItem).perch, tip: (autopilot as WorldItem).p } : null,
  });

  const frame = () => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    fpsNow = fpsNow * 0.95 + (1 / Math.max(1e-3, now - last)) * 0.05;
    last = now;
    const time = now;

    if (inFlyover) {
      if (entered) flyT += dt / flyDuration;
      const u = Math.min(1, flyT);
      const c = intro(u);
      camera.position.copy(c.pos);
      camera.lookAt(c.look);
      if (u > titlesUntil) ui.showTitles(false);
      if (u >= 1) endFlyover();
    }

    const raw = input.read();
    const it = inFlyover ? raw : pilot(raw);
    if (!inFlyover) {
      player.update(dt, it, chase.yaw);
      chase.perched = player.mode === "perch" || player.hopping;
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
    // E: the closest Branch (unfound cards first) within reach — highlighted, the pigeon swoops to it
    let best: PerchPoint | null = null;
    if (!inFlyover && !player.hopping) {
      best = player.closestPerch(TUNING.swoopRange, (pp) => progress.found.has(pp.item.item.id));
    }
    const bestItem = best ? best.item as WorldItem & { idx: number } : null;
    if (bestItem !== target) {
      target = bestItem;
      glints.setTarget(bestItem ? bestItem.idx : -1);
    }
    const perchHint = player.mode === "perch" && player.perch
      ? {
        rank: player.perch.ladder.length ? player.perch.rank : 0,
        count: Math.max(1, player.perch.ladder.length),
      }
      : null;
    ui.setPrompt(!!best && !perchHint, input.touchMode, perchHint);
    if (best && it.inspect) player.swoopTo(best);
    // perched on a Branch: its card opens by itself (and follows the pigeon from branch to branch)
    if (player.mode === "perch" && player.perch) {
      if (player.perch.item !== lastPerched) {
        lastPerched = player.perch.item;
        inspect(player.perch.item as WorldItem & { idx: number });
      }
    } else if (!player.hopping) {
      lastPerched = null;
      // in the Greenhouse: the closest Seed Pot opens its card by itself as the pigeon walks by
      if (!inFlyover && player.mode !== "fly") {
        let pot: (WorldItem & { idx: number }) | null = null, pd = 1.7 * 1.7;
        for (const c of itemGrid.near(player.pos, 1.7, nearBuf)) {
          if (c.kind !== "pot") continue;
          const d = (c.p.x - player.pos.x) ** 2 + (c.p.z - player.pos.z) ** 2;
          if (d < pd) {
            pd = d;
            pot = c;
          }
        }
        // once per approach: closing the panel next to the same pot keeps it closed
        if (pot !== lastPot) {
          lastPot = pot;
          if (pot) inspect(pot);
        }
      }
    }

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
    // wind, and the pigeon's touch on grass and foliage
    weather.update(dt, time);
    WIND.uPigeon.value.copy(player.pos);
    const moving = player.hopping ? 1 : Math.min(1, player.speed / 3);
    WIND.uPigeonMove.value += (moving - WIND.uPigeonMove.value) * Math.min(1, dt * 4);
    audio.setWind(weather.gust);
    if (!inFlyover && player.mode === "fly" && player.speed > 1.5) {
      // brushing through a leaf cluster: leaves let go, and it rustles
      for (const c of itemGrid.near(player.pos, 1.1, nearBuf)) {
        if (c.kind !== "branch") continue;
        if (Math.random() < dt * 6) flutter.burst(player.pos, 1, leafPalette(c));
        if (Math.random() < dt * 3) audio.rustle(0.4);
        break;
      }
    }
    flutter.update(dt);
    words.update(now, inFlyover ? null : player.pos, (week) => `${t().week} ${fmtDate(week)}`);
    glints.update(
      time,
      player.pos,
      TUNING.glintRange,
      motion,
    );

    // fog follows altitude so the overview stays readable
    const fog = scene.fog as THREE.Fog;
    const alt = Math.max(0, camera.position.y);
    fog.near = 30 + alt * 1.1;
    fog.far = Math.min(layout.radius * 2.6 + 120, 140 + alt * 3.2);
    sky.position.copy(camera.position);

    renderer.render(scene, camera);
    adapt(dt); // also during the intro, so a slow device stops tracing letters live before the citation
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
  ui.offerEnter(() => {
    onGesture(); // music and forest start with the intro
    entered = true;
    hook.entered = true;
    setTimeout(() => ui.showTitles(true), 900);
  });
  hook.ready = true;
}

main().catch((e) => {
  hook.error = String(e);
  console.error(e);
});
