// Tuning values (feel, set in playtesting). One place, on purpose.

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

  /** E: offered only near a tree — the pigeon swoops to the closest Branch within this range (unfound first). */
  swoopRange: 4.5,

  // Flyover durations (s)
  flyoverFirst: 24,
  flyoverReturn: 12,
  flyoverReduced: 5,
} as const;
