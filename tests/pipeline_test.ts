import { assert, assertEquals } from "@std/assert";
import { cleanBoard, idPairs, makeHasher, pickPreview } from "../src/server/clean.ts";
import { buildWorld } from "../src/server/classify.ts";
import { hasMaskable } from "../src/server/mask.ts";
import { checkWorld } from "../src/server/smoke.ts";
import { FAKE_BOARD_ID, SEEDED_SECRETS, syntheticBoard } from "./fixtures/synthetic.ts";

const salt = new Uint8Array(32).fill(7);

async function world() {
  const raw = syntheticBoard();
  const pairs = idPairs(raw);
  const hash = await makeHasher(salt, pairs);
  const { snapshot, images } = cleanBoard(raw, hash, new Date("2026-10-18T00:00:00Z"));
  return { raw, snapshot, images, world: buildWorld(snapshot, false) };
}

Deno.test("synthetic board has the real board's shape", () => {
  const raw = syntheticBoard();
  assert(raw.lists!.length >= 165 && raw.lists!.length <= 190, `lists ${raw.lists!.length}`);
  assert(raw.cards!.length >= 2000 && raw.cards!.length <= 2300, `cards ${raw.cards!.length}`);
  assertEquals(raw.labels!.length, 7);
  assertEquals(raw.checklists!.length, 34);
  assertEquals(JSON.stringify(syntheticBoard()), JSON.stringify(raw), "deterministic");
});

Deno.test("world: capability thresholds (≥ 100 Trees, ≥ 2 000 Branches) and smoke checks", async () => {
  const { world: w } = await world();
  const raw = JSON.stringify(w);
  const { checks } = checkWorld(w, raw, 100, 2000);
  for (const c of checks) assert(c.ok, `${c.name}: ${JSON.stringify(c.detail)}`);
});

Deno.test("privacy: no seeded secret, Trello URL, board id or dropped field survives", async () => {
  const { snapshot, world: w } = await world();
  for (const s of [JSON.stringify(snapshot), JSON.stringify(w)]) {
    for (const secret of SEEDED_SECRETS) assert(!s.includes(secret), `leaked ${secret}`);
    assert(!/trello/i.test(s.replace(/Astuce Trello/g, "")), "trello string");
    for (
      const key of [
        '"url"',
        '"shortLink"',
        '"shortUrl"',
        '"idMembers"',
        '"members"',
        '"actions"',
        '"pluginData"',
        '"customFieldItems"',
        '"idBoard"',
        '"badges"',
      ]
    ) {
      assert(!s.includes(key), `field ${key}`);
    }
    assert(!s.includes(FAKE_BOARD_ID));
    assert(!s.includes("secret custom field") && !s.includes("never shown"));
  }
  const texts: string[] = [];
  for (const c of snapshot.cards) {
    texts.push(c.name, c.desc, ...c.checklist.map((i) => i.text), ...c.attachments.map((a) => a.name));
  }
  for (const l of snapshot.lists) texts.push(l.name);
  assertEquals(texts.filter(hasMaskable), []);
  assert(texts.some((t) => t.includes("patient •••")), "patient numbers masked, word kept");
});

Deno.test("privacy: no Trello id reaches the world (opaque ids only)", async () => {
  const { raw, world: w } = await world();
  const s = JSON.stringify(w);
  for (const c of raw.cards!.slice(0, 200)) assert(!s.includes(c.id));
  for (const l of raw.lists!) assert(!s.includes(l.id));
});

Deno.test("classification: Astuce Trello excluded, empty list nothing, Seed Pots and sprouts", async () => {
  const { world: w } = await world();
  const all = [...w.trees.flatMap((t) => t.branches), ...w.pots];
  assert(!all.some((i) => i.name.startsWith("Astuce Trello")));
  assert(!w.trees.some((t) => t.name === "Idées"));
  assertEquals(w.pots.filter((p) => p.list === "Backlog").length, 30); // 40 − 10 archived
  assertEquals(w.pots.filter((p) => p.list === "To do").length, 10);
  const enCours = w.pots.filter((p) => p.list === "En cours");
  assertEquals(enCours.length, 6);
  assert(enCours.every((p) => p.sprout));
  assert(w.pots.filter((p) => p.list !== "En cours").every((p) => !p.sprout));
  assert(w.pots.every((p) => !p.archived));
  // A Backlog / To-do list gets a Tree for its archived cards.
  assertEquals(w.trees.find((t) => t.name === "Backlog")?.branches.length, 10);
  assertEquals(w.trees.find((t) => t.name === "To do")?.branches.length, 5);
  // An archived list without a date is a Done list, Week from its cards.
  const old = w.trees.find((t) => t.name === "Vieux trucs")!;
  assertEquals([old.branches.length, old.weekFrom], [12, "cards"]);
});

Deno.test("classification: Weeks of the hand-typed lists", async () => {
  const { world: w } = await world();
  const week = (name: string) => w.trees.find((t) => t.name === name)?.week;
  assertEquals(week("DONE 20/11/023"), "2023-11-20");
  assertEquals(week("19/02/24"), "2024-02-19");
  assertEquals(week("DONE 18/08//2025"), "2025-08-18");
  assertEquals(week("DONE 6/10/2025"), "2025-10-06");
  assertEquals(week("3/11/2025"), "2025-11-03");
  assertEquals(week("DONE 13/05/2023"), "2024-05-13");
  const first = w.trees[0].week, last = w.trees.at(-1)!.week;
  assert(first.startsWith("2023-0") && last >= "2026-04", `${first} → ${last}`);
  const seasons = new Set(w.trees.map((t) => t.season));
  assertEquals(seasons.size, 4);
});

Deno.test("fruits, covers, checklists", async () => {
  const { world: w } = await world();
  assertEquals(w.species.map((s) => s.fruit), ["apple", "cherry", "plum", "pear", "lemon", "fig", "berries"]);
  const items = w.trees.flatMap((t) => t.branches);
  assert(items.filter((i) => i.labels.length > 0).length > 1200);
  assertEquals(items.filter((i) => i.cover).length + w.pots.filter((i) => i.cover).length, 15);
  assert(
    items.some((i) => i.checklist.some((c) => c.done)) && items.some((i) => i.checklist.some((c) => !c.done)),
  );
});

Deno.test("images: previews ≤ 1024 px, app URLs only for images", async () => {
  const { world: w, images } = await world();
  const atts = [...w.trees.flatMap((t) => t.branches), ...w.pots].flatMap((i) => i.attachments);
  assertEquals(atts.length, 6);
  assertEquals(atts.filter((a) => a.img).length, 4);
  for (const a of atts) if (a.img) assert(/^\/img\/[0-9a-f]{20}$/.test(a.img));
  assert(atts.some((a) => a.name === "manuscrit-v3.pdf" && !a.img));
  assertEquals(images.size, 4);
  for (const src of images.values()) assert(src.includes("/previews/p") && /p\d1\//.test(src), src); // the 600 px one
});

Deno.test("pickPreview", () => {
  const p = (w: number) => ({ url: `u${w}`, width: w, height: w });
  assertEquals(pickPreview({ id: "a", name: "x.png", previews: [p(150), p(1024), p(2000)] }), "u1024");
  assertEquals(pickPreview({ id: "a", name: "x.png", previews: [p(3000), p(2000)] }), "u2000");
  assertEquals(
    pickPreview({ id: "a", name: "x.pdf", mimeType: "application/pdf", previews: [p(150)] }),
    null,
  );
  assertEquals(pickPreview({ id: "a", name: "x.png", previews: [] }), null);
});
