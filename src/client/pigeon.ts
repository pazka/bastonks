// The Pigeon model. Built in code; swappable behind `PigeonModel` for a glTF later:
//   const gltf = await new GLTFLoader().loadAsync("/pigeon.glb");   // three/addons/loaders/GLTFLoader.js
//   toToon(gltf.scene);  // toon.ts: banded light + outlines
//   return gltfPigeon(gltf);  // map its animation clips (fly / glide / walk / idle) onto animate()
// The rest of the game only uses `root` (facing +z, feet at y = 0, ~0.5 units long) and `animate`.

import * as THREE from "three";
import { outlineMesh, toon } from "./toon.ts";

export type PigeonMode = "ground" | "fly" | "perch";

export interface PigeonPose {
  mode: PigeonMode;
  /** Horizontal speed (units/s). */
  speed: number;
  /** 0..1 how hard it is flapping. */
  flap: number;
  /** Seconds since start. */
  t: number;
  /** A peck / coo gesture in progress, 0..1. */
  gesture: number;
}

export interface PigeonModel {
  root: THREE.Object3D;
  animate(p: PigeonPose): void;
}

export function codePigeon(outlines: boolean): PigeonModel {
  const root = new THREE.Group();
  root.name = "pigeon";
  const body = new THREE.Group();
  root.add(body);
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, outline = 0.012) => {
    const m = new THREE.Mesh(geo, toon(color));
    if (outlines && outline > 0) outlineMesh(m, outline);
    parent.add(m);
    return m;
  };
  const GREY = 0x9aa3b5, DARK = 0x6e7590, NECK = 0x5f9e8f, PINK = 0xe58a8a;

  // torso
  const torso = add(body, new THREE.SphereGeometry(0.2, 12, 10).scale(0.85, 0.8, 1.25), GREY);
  torso.position.set(0, 0.3, 0);
  // iridescent neck
  const neck = new THREE.Group();
  neck.position.set(0, 0.38, 0.17);
  body.add(neck);
  add(neck, new THREE.SphereGeometry(0.12, 10, 8).scale(1, 1.1, 1), NECK).position.set(0, 0.02, 0);
  // head
  const head = new THREE.Group();
  head.position.set(0, 0.14, 0.05);
  neck.add(head);
  add(head, new THREE.SphereGeometry(0.095, 12, 10), GREY);
  const beak = add(head, new THREE.ConeGeometry(0.022, 0.085, 6).rotateX(Math.PI / 2), 0x4a4440, 0.006);
  beak.position.set(0, -0.012, 0.115);
  add(head, new THREE.SphereGeometry(0.024, 6, 5).scale(1.4, 0.8, 1), 0xf3f0ea, 0).position.set(
    0,
    0.012,
    0.085,
  );
  for (const s of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.022, 8, 6), 0xf28c28, 0).position.set(s * 0.06, 0.02, 0.05);
    add(head, new THREE.SphereGeometry(0.011, 6, 5), 0x1b1b22, 0).position.set(s * 0.072, 0.022, 0.06);
  }
  // wings (pivot at the shoulder)
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.13, 0.36, 0.02);
    body.add(pivot);
    const w = add(pivot, new THREE.SphereGeometry(0.2, 10, 6).scale(1.2, 0.18, 0.75), DARK);
    w.position.set(s * 0.17, 0, -0.04);
    // dark wing bars
    add(pivot, new THREE.BoxGeometry(0.22, 0.02, 0.03), 0x3e4256, 0).position.set(s * 0.2, 0.025, -0.02);
    add(pivot, new THREE.BoxGeometry(0.2, 0.02, 0.03), 0x3e4256, 0).position.set(s * 0.2, 0.025, -0.1);
    wings.push(pivot);
  }
  // tail
  const tail = add(body, new THREE.BoxGeometry(0.2, 0.03, 0.22).translate(0, 0, -0.11), DARK);
  tail.position.set(0, 0.3, -0.22);
  // legs
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.06, 0.16, 0.02);
    root.add(leg);
    add(leg, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5).translate(0, -0.08, 0), PINK, 0);
    add(leg, new THREE.BoxGeometry(0.05, 0.012, 0.07).translate(0, -0.16, 0.02), PINK, 0);
    legs.push(leg);
  }

  const animate = (p: PigeonPose) => {
    const { t } = p;
    if (p.mode === "fly") {
      const rate = 7 + 9 * p.flap;
      const amp = 0.25 + 0.75 * p.flap;
      const a = Math.sin(t * rate) * amp;
      wings[0].rotation.set(0, 0, -a - 0.1);
      wings[1].rotation.set(0, 0, a + 0.1);
      wings[0].rotation.y = wings[1].rotation.y = 0;
      body.rotation.x = -0.15 + 0.1 * Math.sin(t * rate);
      neck.rotation.x = 0.2;
      head.position.z = 0.05;
      tail.rotation.x = -0.1;
      for (const l of legs) l.rotation.x = 1.1;
    } else {
      // folded wings along the body
      for (const [i, w] of wings.entries()) {
        const s = i === 0 ? -1 : 1;
        w.rotation.set(0, s * 1.35, s * -0.25); // swept back along the flanks
      }
      body.rotation.x = 0;
      tail.rotation.x = 0.1;
      // the pigeon head-bob: head thrusts forward, then holds while the body catches up
      const walk = Math.min(1, p.speed / 3);
      const ph = (t * 4.5) % 1;
      head.position.z = 0.05 + walk * (ph < 0.35 ? (ph / 0.35) * 0.06 : 0.06 - ((ph - 0.35) / 0.65) * 0.06);
      neck.rotation.x = -p.gesture * 0.9 + Math.sin(t * 1.3) * 0.04 * (1 - walk);
      legs[0].rotation.x = walk * Math.sin(t * 9) * 0.6;
      legs[1].rotation.x = -walk * Math.sin(t * 9) * 0.6;
      body.position.y = walk * Math.abs(Math.sin(t * 9)) * 0.02;
    }
  };
  animate({ mode: "ground", speed: 0, flap: 0, t: 0, gesture: 0 });
  return { root, animate };
}
