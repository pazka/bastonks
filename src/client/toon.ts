// Cel shading: MeshToonMaterial with a banded gradient map, and inverted-hull outlines drawn from a
// smoothed-normal copy of each geometry. Works with InstancedMesh (the outline shares the instance matrices).

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { WIND, WIND_GLSL, windCall, type WindKind } from "./wind.ts";

let gradient: THREE.DataTexture | null = null;

/** 3 light bands: shadow, mid, lit. */
export function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

/**
 * Toon material that dissolves (dithered) when the camera comes within `near` units: foliage never blocks
 * the view of the pigeon perched among the branches.
 */
export function toonNearFade(
  color: THREE.ColorRepresentation,
  near = 2.6,
  opts: THREE.MeshToonMaterialParameters = {},
) {
  const m = toon(color, opts);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNear = { value: near };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNear;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        {
          float camDist = length(vViewPosition);
          if (camDist < uNear) {
            float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (n > smoothstep(uNear * 0.35, uNear, camDist)) discard;
          }
        }`,
      );
  };
  m.customProgramCacheKey = () => `toon-near-fade-${near}`;
  return m;
}

const outlineMaterials = new Map<string, THREE.ShaderMaterial>();

/** Outline material: pushes vertices along their (smoothed) normals and draws back faces in a dark ink. */
export function outlineMaterial(
  thickness: number,
  color = 0x2b2a33,
  near = 0,
  wind: WindKind | null = null,
): THREE.ShaderMaterial {
  const key = `${thickness}:${color}:${near}:${wind}`;
  const hit = outlineMaterials.get(key);
  if (hit) return hit;
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { thickness: { value: thickness }, ink: { value: new THREE.Color(color) }, uNear: { value: near } },
  ]);
  if (wind) Object.assign(uniforms, WIND); // shared, not copied: the outline sways with its mesh
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      ${wind ? WIND_GLSL : ""}
      uniform float thickness;
      varying float vCamDist;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        ${
      wind
        ? `vec3 io = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; // windy outlines are instanced
        vec4 wp = modelMatrix * p;
        wp.xyz += ${windCall(wind, "wp.xyz", "io")};
        vec4 mvPosition = viewMatrix * wp;`
        : "vec4 mvPosition = modelViewMatrix * p;"
    }
        vec3 vn = normalize(normalMatrix * n);
        // Thickness grows a little with distance so far outlines stay visible but thin.
        float w = thickness * clamp(-mvPosition.z * 0.04, 1.0, 3.0);
        mvPosition.xyz += vn * w;
        vCamDist = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 ink;
      uniform float uNear;
      varying float vCamDist;
      void main() {
        if (vCamDist < uNear) discard; // matches the dissolving foliage (toonNearFade)
        gl_FragColor = vec4(ink, 1.0);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    fog: true,
  });
  outlineMaterials.set(key, m);
  return m;
}

/** The outline copy of a geometry: welded vertices, smooth normals (no cracks at hard edges). */
export function outlineGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = new THREE.BufferGeometry();
  pos.setAttribute("position", g.getAttribute("position").clone());
  if (g.index) pos.setIndex(g.index.clone());
  const welded = mergeVertices(pos, 1e-3);
  welded.computeVertexNormals();
  return welded;
}

/** Adds an outline twin to an InstancedMesh (same instances, same count). */
export function outlineInstanced(
  mesh: THREE.InstancedMesh,
  thickness: number,
  color?: number,
  near = 0,
): THREE.InstancedMesh {
  const o = new THREE.InstancedMesh(
    outlineGeometry(mesh.geometry),
    outlineMaterial(thickness, color, near, (mesh.userData.wind as WindKind | undefined) ?? null),
    mesh.count,
  );
  o.instanceMatrix = mesh.instanceMatrix;
  o.count = mesh.count;
  o.frustumCulled = false;
  o.renderOrder = -1;
  o.name = `${mesh.name}-outline`;
  return o;
}

/** Adds an outline twin to a plain mesh (pigeon parts, greenhouse frame). */
export function outlineMesh(mesh: THREE.Mesh, thickness: number, color?: number): THREE.Mesh {
  const o = new THREE.Mesh(outlineGeometry(mesh.geometry), outlineMaterial(thickness, color));
  o.name = `${mesh.name}-outline`;
  mesh.add(o);
  return o;
}

/** Converts any loaded model (e.g. a glTF pigeon) to the toon look: same colours/maps, banded light, outlines. */
export function toToon(root: THREE.Object3D, thickness = 0.02) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name.endsWith("-outline")) return;
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = toon(old.color ?? 0xffffff, { map: old.map ?? null });
    outlineMesh(mesh, thickness);
  });
}
