// One Points draw call for every inspectable item: a soft twinkle on unfound items,
// a stronger pulsing halo on New Growth, and a ring on the item the pigeon can inspect right now.

import * as THREE from "three";
import type { WorldItem } from "./forest.ts";

export const GlintState = { Found: 0, Unfound: 1, New: 2, Target: 3 } as const;
export type GlintState = (typeof GlintState)[keyof typeof GlintState];

export class Glints {
  readonly points: THREE.Points;
  private state: Float32Array;
  private attr: THREE.BufferAttribute;
  private uniforms: Record<string, THREE.IUniform>;
  private target = -1;
  private targetPrev: number = 0;

  constructor(items: WorldItem[], pixelRatio: number) {
    const pos = new Float32Array(items.length * 3);
    const phase = new Float32Array(items.length);
    this.state = new Float32Array(items.length);
    items.forEach((it, i) => {
      pos.set([it.p.x, it.p.y + 0.15, it.p.z], i * 3);
      phase[i] = (i * 0.6180339) % 1;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    this.attr = new THREE.BufferAttribute(this.state, 1);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aState", this.attr);
    this.uniforms = {
      uTime: { value: 0 },
      uRange: { value: 14 },
      uPigeon: { value: new THREE.Vector3() },
      uScale: { value: pixelRatio },
      uMotion: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aState;
        uniform float uTime, uRange, uScale, uMotion;
        uniform vec3 uPigeon;
        varying float vAlpha;
        varying float vState;
        void main() {
          vState = aState;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = distance(position, uPigeon);
          float range = aState > 2.5 ? 1e4 : aState > 1.5 ? uRange * 2.5 : uRange;
          float tw = 0.55 + 0.45 * sin(uTime * (2.0 + aPhase * 2.0) * uMotion + aPhase * 40.0);
          float pulse = 0.75 + 0.25 * sin(uTime * 3.0 * uMotion);
          vAlpha = (aState < 0.5 ? 0.0 : 1.0) * smoothstep(range, range * 0.55, d) * (aState > 1.5 ? pulse : tw);
          float size = aState > 2.5 ? 120.0 : aState > 1.5 ? 90.0 : 46.0;
          gl_PointSize = size * uScale / max(1.0, -mv.z) * (aState > 0.5 ? 1.0 : 0.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vState;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          float star = max(0.0, 1.0 - abs(p.x * p.y) * 18.0) * (1.0 - r);
          float core = smoothstep(0.35, 0.0, r);
          float ring = smoothstep(0.08, 0.0, abs(r - 0.78));
          vec3 col = vState > 2.5 ? vec3(1.0, 0.95, 0.7) : vState > 1.5 ? vec3(0.75, 1.0, 0.55) : vec3(1.0, 0.93, 0.7);
          float a = vState > 2.5 ? ring + core * 0.4 : (star + core) * 0.9;
          gl_FragColor = vec4(col, a * vAlpha);
          if (gl_FragColor.a < 0.01) discard;
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  set(i: number, s: number) {
    this.state[i] = s;
    this.attr.needsUpdate = true;
  }

  /** Marks the inspectable item (or none with -1). */
  setTarget(i: number) {
    if (i === this.target) return;
    if (this.target >= 0) this.state[this.target] = this.targetPrev;
    this.target = i;
    if (i >= 0) {
      this.targetPrev = this.state[i];
      this.state[i] = GlintState.Target;
    }
    this.attr.needsUpdate = true;
  }

  /** Updates the remembered state of the current target too. */
  setBase(i: number, s: number) {
    if (i === this.target) this.targetPrev = s;
    else this.set(i, s);
  }

  update(time: number, pigeon: THREE.Vector3, range: number, motion: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uRange.value = range;
    (this.uniforms.uPigeon.value as THREE.Vector3).copy(pigeon);
    this.uniforms.uMotion.value = motion;
  }

  setPixelRatio(pr: number) {
    this.uniforms.uScale.value = pr;
  }
}
