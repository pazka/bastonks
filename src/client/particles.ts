// Little things the pigeon stirs up: leaves that flutter down when it brushes through foliage or lands on a
// branch, and grass bits / petals when it lands on the ground. One instanced mesh, a small fixed pool.

import * as THREE from "three";
import { groundHeight } from "./layout.ts";
import { WIND } from "./wind.ts";

const N = 64;

interface Bit {
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  size: number;
}

export class Flutter {
  readonly mesh: THREE.InstancedMesh;
  private bits: Bit[] = [];
  private next = 0;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();

  constructor() {
    const leaf = new THREE.CircleGeometry(0.07, 5).scale(1.7, 1, 1);
    this.mesh = new THREE.InstancedMesh(
      leaf,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, fog: true }),
      N,
    );
    this.mesh.frustumCulled = false;
    this.mesh.name = "flutter";
    for (let i = 0; i < N; i++) {
      this.bits.push({
        life: 0,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rot: new THREE.Euler(),
        size: 1,
      });
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
      this.hide(i);
    }
  }

  private hide(i: number) {
    this.tmp.scale.setScalar(0);
    this.tmp.updateMatrix();
    this.mesh.setMatrixAt(i, this.tmp.matrix);
  }

  /** `count` bits around `at`, coloured from `palette`; `up` > 0 kicks them up (landing on the ground). */
  burst(
    at: THREE.Vector3 | { x: number; y: number; z: number },
    count: number,
    palette: number[],
    up = 0,
    spread = 0.4,
  ) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      const b = this.bits[i];
      b.life = 2.5 + Math.random() * 2.5;
      b.p.set(
        at.x + (Math.random() - 0.5) * spread,
        at.y + (Math.random() - 0.3) * spread,
        at.z + (Math.random() - 0.5) * spread,
      );
      b.v.set((Math.random() - 0.5) * 1.2, up * (0.6 + Math.random()), (Math.random() - 0.5) * 1.2);
      b.spin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
      b.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      b.size = 0.7 + Math.random() * 0.7;
      this.mesh.setColorAt(i, this.color.setHex(palette[Math.floor(Math.random() * palette.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    const wind = WIND.uWind.value, dir = WIND.uWindDir.value, t = WIND.uTime.value;
    this.bits.forEach((b, i) => {
      if (b.life <= 0) return;
      any = true;
      b.life -= dt;
      const ground = groundHeight(b.p.x, b.p.z) + 0.04;
      if (b.p.y > ground) {
        // a leaf sways as it falls, carried a little by the wind
        b.v.y = Math.max(-0.7, b.v.y - 2.2 * dt);
        b.v.x += (Math.sin(t * 3 + i) * 0.9 + dir.x * wind * 1.5 - b.v.x) * dt * 1.5;
        b.v.z += (Math.cos(t * 2.6 + i) * 0.9 + dir.y * wind * 1.5 - b.v.z) * dt * 1.5;
        b.p.addScaledVector(b.v, dt);
        b.rot.x += b.spin.x * dt;
        b.rot.y += b.spin.y * dt;
        b.rot.z += b.spin.z * dt;
      } else {
        // resting on the ground: lie flat, then fade away
        b.p.y = ground;
        b.rot.set(-Math.PI / 2, b.rot.y, 0);
        b.life = Math.min(b.life, 1.2);
      }
      const s = b.size * Math.min(1, b.life / 0.6);
      this.tmp.position.copy(b.p);
      this.tmp.rotation.copy(b.rot);
      this.tmp.scale.setScalar(Math.max(0, s));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
      if (b.life <= 0) this.hide(i);
    });
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
