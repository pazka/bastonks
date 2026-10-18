import { assert, assertEquals } from "@std/assert";
import { buildLayout, Grid, maxPerchGap } from "../src/client/layout.ts";
import { TUNING } from "../src/client/tuning.ts";
import { cleanBoard, idPairs, makeHasher } from "../src/server/clean.ts";
import { buildWorld } from "../src/server/classify.ts";
import { syntheticBoard } from "./fixtures/synthetic.ts";
import exceptional from "../config/exceptional.json" with { type: "json" };

async function world() {
  const raw = syntheticBoard();
  const h = await makeHasher(new Uint8Array(32), [
    ...idPairs(raw),
    ...exceptional.cards.map((id) => ["card", id] as [string, string]),
  ]);
  return buildWorld(
    cleanBoard(raw, h).snapshot,
    new Set(exceptional.cards.map((id) => h("card", id))),
    false,
  );
}

Deno.test("layout: deterministic, one slot per Tree, every item placed", async () => {
  const w = await world();
  const a = buildLayout(w), b = buildLayout(w);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(a.trees.length, w.trees.length);
  assertEquals(a.trees.reduce((n, t) => n + t.branches.length, 0), w.counts.branches);
  assertEquals(a.pots.length, w.pots.length);
  assertEquals(a.peanuts.length, w.exceptional.length);
});

Deno.test("layout: Trees do not overlap and taller Trees hold more Branches", async () => {
  const l = buildLayout(await world());
  for (let i = 0; i < l.trees.length; i++) {
    for (let j = i + 1; j < l.trees.length; j++) {
      const a = l.trees[i], b = l.trees[j];
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      assert(d > (a.crownR + b.crownR) * 0.8, `trees ${i} and ${j} overlap (${d.toFixed(1)})`);
    }
  }
  const small = l.trees.find((t) => t.branches.length <= 9)!,
    big = l.trees.find((t) => t.branches.length >= 16)!;
  assert(big.height > small.height + 1);
});

Deno.test("layout: every Tree is climbable without boosts", async () => {
  const l = buildLayout(await world());
  for (const t of l.trees) {
    assert(maxPerchGap(t) <= TUNING.climbReach, `tree ${t.index} gap ${maxPerchGap(t)}`);
  }
});

Deno.test("layout: Greenhouse clear of the forest", async () => {
  const l = buildLayout(await world());
  const g = l.greenhouse;
  for (const t of l.trees) {
    assert(
      Math.hypot(t.pos.x - g.center.x, t.pos.z - g.center.z) > Math.max(g.w, g.d) / 2 + t.crownR,
      `tree ${t.index}`,
    );
  }
});

Deno.test("grid: near()", () => {
  const g = new Grid<{ p: { x: number; y: number; z: number }; n: number }>(4);
  for (let i = 0; i < 100; i++) g.add({ p: { x: i, y: 0, z: 0 }, n: i });
  assertEquals(g.near({ x: 50, y: 0, z: 0 }, 2.5).map((v) => v.n).sort((a, b) => a - b), [
    48,
    49,
    50,
    51,
    52,
  ]);
});
