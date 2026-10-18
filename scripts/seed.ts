// Writes a cleaned snapshot of the synthetic board (+ its image previews) into a data dir, as the server
// would have stored it. Used by CI to start the hardened container with a world but no Trello access.
// Usage: deno run --allow-read --allow-write=<dir> scripts/seed.ts <dir>

import { cleanBoard, idPairs, makeHasher } from "../src/server/clean.ts";
import { gradientPng } from "../tests/fixtures/png.ts";
import { syntheticBoard } from "../tests/fixtures/synthetic.ts";
import exceptional from "../config/exceptional.json" with { type: "json" };

const dir = Deno.args[0];
if (!dir) throw new Error("usage: seed.ts <dir>");
const raw = syntheticBoard();
const salt = crypto.getRandomValues(new Uint8Array(32));
const hash = await makeHasher(salt, [
  ...idPairs(raw),
  ...exceptional.cards.map((id) => ["card", id] as [string, string]),
]);
const { snapshot, images } = cleanBoard(raw, hash, new Date(Date.now() - 3600_000));
await Deno.mkdir(`${dir}/img`, { recursive: true });
await Deno.mkdir(`${dir}/.secrets`, { recursive: true, mode: 0o700 });
await Deno.writeFile(`${dir}/.secrets/id-salt`, salt, { mode: 0o600 });
await Deno.writeTextFile(`${dir}/snapshot.json`, JSON.stringify(snapshot));
let i = 0;
for (const id of images.keys()) await Deno.writeFile(`${dir}/img/${id}`, gradientPng(320, 240, i++));
console.log(`seeded ${snapshot.cards.length} cards, ${images.size} images into ${dir}`);
