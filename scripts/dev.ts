// Local dev / e2e server: the real server code, fed by the synthetic board instead of Trello.
// `deno task build && deno task dev` → http://127.0.0.1:8000. Never used in production.

import { loadAssets } from "../src/server/assets.ts";
import { makeHandler } from "../src/server/http.ts";
import { WorldService } from "../src/server/service.ts";
import { Store } from "../src/server/store.ts";
import { TrelloError } from "../src/server/trello.ts";
import { gradientPng } from "../tests/fixtures/png.ts";
import { syntheticBoard } from "../tests/fixtures/synthetic.ts";

const port = Number(Deno.env.get("APP_PORT") ?? 8000);
const dataDir = Deno.env.get("APP_DATA_DIR") ?? "./data/dev";
/** BASTONKS_DEV_TRELLO=down simulates Trello being unreachable (the stale path). */
const down = () => Deno.env.get("BASTONKS_DEV_TRELLO") === "down";

const board = syntheticBoard();
const svc = new WorldService({
  store: new Store(dataDir),
  fetchBoard: () => {
    if (down()) return Promise.reject(new TrelloError("network"));
    return Promise.resolve(structuredClone(board));
  },
  fetchImage: (url) => Promise.resolve(gradientPng(320, 240, url.length % 5)),
  fetchTimeoutMs: 3000,
  minRefetchS: 10,
});
await svc.init();
await svc.refresh();
Deno.serve({ hostname: "127.0.0.1", port }, makeHandler(svc, loadAssets()));
