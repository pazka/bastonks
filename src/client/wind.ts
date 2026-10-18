// Wind and the pigeon's touch on the garden, done in the vertex shaders (no extra draw calls):
// - occasional slow gusts sway leaves, fruits, grass, flowers and, barely, the trunks;
// - grass and flowers part around the pigeon; foliage shivers when it flies or hops through.
// One set of uniforms is shared by every patched material (and the matching outlines).

import * as THREE from "three";

export type WindKind = "leaf" | "grass" | "tree";

export const WIND = {
  uTime: { value: 0 },
  /** 0..1 gust strength (a gentle breeze is always there). */
  uWind: { value: 0.15 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uPigeon: { value: new THREE.Vector3(0, -100, 0) },
  /** 0..1 how much the pigeon is moving (foliage only shivers when it brushes through). */
  uPigeonMove: { value: 0 },
};

export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform vec3 uPigeon;
uniform float uPigeonMove;
vec3 windLeaf(vec3 wp, vec3 io) {
  float ph = io.x * 0.21 + io.z * 0.17;
  float sway = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.3;
  float amp = 0.025 + uWind * (0.09 + 0.006 * io.y);
  vec3 off = vec3(uWindDir.x, 0.0, uWindDir.y) * sway * amp;
  off += vec3(sin(uTime * 7.0 + ph * 3.0), sin(uTime * 9.0 + ph), cos(uTime * 8.0 + ph * 2.0)) * 0.012 * uWind;
  float near = smoothstep(1.9, 0.4, distance(io, uPigeon)) * uPigeonMove;
  off += vec3(sin(uTime * 21.0 + wp.y * 7.0), 0.5 * sin(uTime * 17.0 + wp.x * 5.0), cos(uTime * 19.0 + wp.z * 6.0))
    * 0.07 * near;
  return off;
}
vec3 windGrass(vec3 wp, vec3 io) {
  float h = clamp((wp.y - io.y) / 0.45, 0.0, 1.0);
  float ph = io.x * 0.7 + io.z * 0.5;
  float sway = sin(uTime * 1.8 + ph) * (0.03 + 0.14 * uWind) + sin(uTime * 4.0 + ph * 2.0) * 0.01;
  vec3 off = vec3(uWindDir.x, 0.0, uWindDir.y) * sway * h;
  vec2 v = io.xz - uPigeon.xz;
  float low = smoothstep(1.6, 0.2, uPigeon.y - io.y);
  float push = smoothstep(1.2, 0.15, length(v)) * low;
  off.xz += normalize(v + vec2(1e-4)) * push * 0.32 * h;
  off.y -= push * 0.18 * h;
  return off;
}
vec3 windTree(vec3 wp, vec3 io) {
  float h = max(0.0, wp.y - io.y);
  float ph = io.x * 0.11 + io.z * 0.13;
  float sway = sin(uTime * 0.9 + ph) * (0.002 + 0.006 * uWind) * h * h * 0.15;
  return vec3(uWindDir.x, 0.0, uWindDir.y) * sway;
}
`;

const FN: Record<WindKind, string> = { leaf: "windLeaf", grass: "windGrass", tree: "windTree" };

/** Vertex code that places `transformed` in the world, applies the wind, and projects it. */
function projectWithWind(kind: WindKind) {
  return /* glsl */ `
    vec4 mvPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      vec3 wIo = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec3 wIo = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    vec4 wPos = modelMatrix * mvPosition;
    wPos.xyz += ${FN[kind]}(wPos.xyz, wIo);
    mvPosition = viewMatrix * wPos;
    gl_Position = projectionMatrix * mvPosition;`;
}

/** Adds wind to a built-in material (chains any patch already there, e.g. the near-camera fade). */
export function withWind<T extends THREE.Material>(m: T, kind: WindKind): T {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, WIND);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WIND_GLSL}`)
      .replace("#include <project_vertex>", projectWithWind(kind));
  };
  m.customProgramCacheKey = () => `${prevKey}|wind-${kind}`;
  return m;
}

/** For hand-written shaders (outlines): the same displacement, given a world position and instance origin. */
export function windCall(kind: WindKind, wp: string, io: string) {
  return `${FN[kind]}(${wp}, ${io})`;
}

/**
 * The weather: a light breeze, and every 18–45 s a slow gust (rises in ~3 s, holds, fades in ~4 s) from a
 * direction that drifts over time. `gust` (0..1) also drives the wind and rustling sounds.
 */
export class Weather {
  gust = 0.15;
  private next = 8 + Math.random() * 10;
  private event: { t: number; peak: number; hold: number } | null = null;
  private angle = Math.random() * Math.PI * 2;

  update(dt: number, time: number) {
    this.next -= dt;
    if (!this.event && this.next <= 0) {
      this.event = { t: 0, peak: 0.55 + Math.random() * 0.45, hold: 2 + Math.random() * 3 };
      this.next = 18 + Math.random() * 27;
    }
    let target = 0.12 + 0.05 * Math.sin(time * 0.13);
    if (this.event) {
      const e = this.event;
      e.t += dt;
      const up = 3, down = 4;
      const k = e.t < up ? e.t / up : e.t < up + e.hold ? 1 : Math.max(0, 1 - (e.t - up - e.hold) / down);
      target = Math.max(target, e.peak * (k * k * (3 - 2 * k)));
      if (e.t > up + e.hold + down) this.event = null;
    }
    this.gust += (target - this.gust) * Math.min(1, dt * 2);
    this.angle += dt * 0.02;
    WIND.uTime.value = time;
    WIND.uWind.value = this.gust;
    WIND.uWindDir.value.set(Math.cos(this.angle), Math.sin(this.angle));
  }
}
