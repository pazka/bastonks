// Soft palette: seasons, Trello's named colours (covers and labels), ground and sky.

import type { Season } from "../shared/types.ts";

export const SEASON_LEAVES: Record<Season, number[]> = {
  spring: [0xa8e07a, 0x9bd86f, 0xbfe892, 0xf2c4d6],
  summer: [0x3f9a4a, 0x4aa653, 0x358a43, 0x56b05a],
  autumn: [0xe8a838, 0xd9692e, 0xf0c04a, 0xc8552c],
  winter: [0x9fb3a8, 0xb7c7c0, 0x8aa197, 0xe9f0ee],
};

/** Trello colour names → soft display colours. `_light` / `_dark` variants are derived. */
const TRELLO: Record<string, number> = {
  green: 0x61bd4f,
  yellow: 0xf2d600,
  orange: 0xff9f1a,
  red: 0xeb5a46,
  purple: 0xc377e0,
  blue: 0x3d8fd6,
  sky: 0x2fc8e6,
  lime: 0x7be6a4,
  pink: 0xff8ed4,
  black: 0x505f79,
};

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t);
}

export function trelloColor(name: string | null, fallback = 0xd9a55b): number {
  if (!name) return fallback;
  const [base, variant] = name.split("_");
  const c = TRELLO[base];
  if (c === undefined) return fallback;
  if (variant === "light") return mix(c, 0xffffff, 0.35);
  if (variant === "dark") return mix(c, 0x000000, 0.3);
  return c;
}

export function cssHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

export const COLORS = {
  trunk: 0x8a5a3b,
  trunkDark: 0x6d452d,
  grass: 0x8fcf6a,
  grassDark: 0x6fb556,
  path: 0xe9d6a5,
  skyTop: 0x7fc4ec,
  skyHorizon: 0xf3e6cf,
  fog: 0xf3e6cf,
  pot: 0xc8693f,
  potRim: 0xb05a35,
  soil: 0x5b3b2a,
  sprout: 0x7fd36b,
  glass: 0xcfeff0,
  frame: 0xf4f0e6,
  peanut: 0xf2c14e,
  rock: 0xb8b2a6,
  flower: [0xffffff, 0xffd3e0, 0xffe680, 0xc9b6ff],
};
