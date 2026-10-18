// Tuning values (BRIEF §11: boost strengths and peanut count are set in playtesting). One place, on purpose.

export const TUNING = {
  // Pigeon movement
  walkSpeed: 3.2,
  flySpeed: 9,
  flapLift: 11,
  gravity: 9,
  glideSink: 1.4,
  maxAltitude: 70,
  /** Vertical reach of one hop from perch to perch. Layout keeps branch gaps below this. */
  climbReach: 1.7,
  perchSnap: 0.9,
  inspectRange: 2.4,
  pickupRange: 1.4,

  // Glints on unfound items
  glintRange: 14,

  // Per Golden Peanut (Boost level n multiplies by 1 + n × k, capped)
  boost: {
    glintRange: 0.6,
    flySpeed: 0.12,
    inspectRange: 0.15,
    climbReach: 0.2,
    maxLevel: 6,
  },

  // Flyover durations (s)
  flyoverFirst: 16,
  flyoverReturn: 7,
  flyoverReduced: 4,
} as const;

export function boosted(base: number, k: number, level: number): number {
  return base * (1 + k * Math.min(level, TUNING.boost.maxLevel));
}
