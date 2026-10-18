import { assert, assertEquals } from "@std/assert";
import { WorldService } from "../src/server/service.ts";
import { Store } from "../src/server/store.ts";
import { makeHandler } from "../src/server/http.ts";
import { TrelloError } from "../src/server/trello.ts";
import { setLogLevel } from "../src/server/log.ts";
import { syntheticBoard } from "./fixtures/synthetic.ts";
import { gradientPng } from "./fixtures/png.ts";
import type { World } from "../src/shared/types.ts";

setLogLevel("error");
const board = syntheticBoard();

interface Fake {
  mode: "ok" | "fail" | "slow";
  calls: number;
  imageCalls: number;
}

async function setup(fake: Fake, dir?: string, fetchTimeoutMs = 2000) {
  const d = dir ?? await Deno.makeTempDir();
  const svc = new WorldService({
    store: new Store(d),
    fetchBoard: async (signal) => {
      fake.calls++;
      if (fake.mode === "fail") throw new TrelloError("http", 401);
      if (fake.mode === "slow") {
        await new Promise((r, j) => {
          const t = setTimeout(r, 300);
          signal.addEventListener("abort", () => (clearTimeout(t), j(new TrelloError("timeout"))));
        });
      }
      return structuredClone(board);
    },
    fetchImage: () => {
      fake.imageCalls++;
      return Promise.resolve(gradientPng(32, 24));
    },
    fetchTimeoutMs,
    minRefetchS: 0,
  });
  await svc.init();
  return { svc, dir: d };
}

Deno.test("visit: fresh world when Trello answers", async () => {
  const fake: Fake = { mode: "ok", calls: 0, imageCalls: 0 };
  const { svc } = await setup(fake);
  const r = await svc.visit();
  assert(r && !r.world.stale);
  assertEquals(svc.health().status, "ok");
  assertEquals(svc.health().last_fetch, "ok");
  await svc.settle();
});

Deno.test("visit: Trello down / 401 → last good snapshot, flagged stale; restart without Trello still serves", async () => {
  const fake: Fake = { mode: "ok", calls: 0, imageCalls: 0 };
  const { svc, dir } = await setup(fake);
  const good = await svc.visit();
  await svc.settle();
  fake.mode = "fail";
  const r = await svc.visit();
  assert(r?.world.stale);
  assertEquals(r.world.counts, good!.world.counts);
  assertEquals(svc.health().last_fetch, "error");
  assertEquals(svc.health().last_fetch_error, "trello http 401");
  // restart: snapshot from /data, Trello still failing
  const again = await setup(fake, dir);
  assertEquals(again.svc.health().status, "ok");
  const r2 = await again.svc.visit();
  assert(r2?.world.stale);
  assertEquals(r2.world.counts, good!.world.counts);
  // opaque ids are stable across restarts (salt in /data/.secrets)
  assertEquals(r2.world.trees[0].branches[0].id, good!.world.trees[0].branches[0].id);
});

Deno.test("visit: slow Trello → served within the timeout as stale, then refreshed in the background", async () => {
  const fake: Fake = { mode: "ok", calls: 0, imageCalls: 0 };
  const { svc } = await setup(fake, undefined, 100);
  await svc.visit();
  await svc.settle();
  fake.mode = "slow";
  const t0 = performance.now();
  const r = await svc.visit();
  assert(performance.now() - t0 < 250, "waited too long");
  assert(r?.world.stale);
  assertEquals(svc.health().last_fetch, "timeout");
  await svc.settle();
  assertEquals(svc.health().last_fetch, "ok");
});

Deno.test("visit: no snapshot and Trello down → null (503)", async () => {
  const fake: Fake = { mode: "fail", calls: 0, imageCalls: 0 };
  const { svc } = await setup(fake);
  assertEquals(await svc.visit(), null);
  assertEquals(svc.health().status, "no_snapshot");
});

Deno.test("visit: concurrent visits share one in-flight fetch", async () => {
  const fake: Fake = { mode: "slow", calls: 0, imageCalls: 0 };
  const { svc } = await setup(fake);
  await Promise.all(Array.from({ length: 20 }, () => svc.visit()));
  assertEquals(fake.calls, 1);
  await svc.settle();
});

Deno.test("http: world, ETag 304, healthz, images, dotfiles, CSP, HEAD", async () => {
  const fake: Fake = { mode: "ok", calls: 0, imageCalls: 0 };
  const { svc } = await setup(fake);
  const assets = new Map([["/index.html", {
    type: "text/html",
    body: new TextEncoder().encode("<canvas>"),
    immutable: false,
  }]]);
  const h = makeHandler(svc, assets);
  const get = (p: string, init?: RequestInit) => h(new Request(`http://x${p}`, init));

  const w = await get("/api/world");
  assertEquals(w.status, 200);
  const world = await w.json() as World;
  const etag = w.headers.get("etag")!;
  assert(etag);
  assertEquals((await get("/api/world", { headers: { "if-none-match": etag } })).status, 304);
  assert(w.headers.get("content-security-policy")!.includes("default-src 'self'"));

  const hz = await get("/healthz");
  const hb = await hz.json();
  assertEquals([hz.status, hb.status, hb.last_fetch], [200, "ok", "ok"]);
  assert(hb.trees >= 100 && hb.branches >= 2000 && typeof hb.snapshot_age_s === "number");
  const head = await get("/healthz", { method: "HEAD" });
  assertEquals([head.status, await head.text()], [200, ""]);

  await svc.settle();
  const img = world.trees.flatMap((t) => t.branches).flatMap((b) => b.attachments).find((a) => a.img)!.img!;
  const ir = await get(img);
  assertEquals([ir.status, ir.headers.get("content-type")], [200, "image/png"]);
  assert(ir.headers.get("cache-control")!.includes("immutable"));
  await ir.body?.cancel();
  assertEquals((await get("/img/0123456789abcdef0123")).status, 404);
  assertEquals((await get("/img/../snapshot.json")).status, 404);

  for (const p of ["/.env", "/.git/config", "/.secrets/id-salt"]) assertEquals((await get(p)).status, 404, p);
  assertEquals((await get("/")).status, 200);
  assertEquals((await get("/nope")).status, 404);
  assertEquals((await get("/api/world", { method: "POST" })).status, 405);
});

Deno.test("images are downloaded once and cached in /data/img", async () => {
  const fake: Fake = { mode: "ok", calls: 0, imageCalls: 0 };
  const { svc, dir } = await setup(fake);
  await svc.visit();
  await svc.settle();
  assertEquals(fake.imageCalls, 4);
  assertEquals(svc.health().images_cached, 4);
  await svc.visit();
  await svc.settle();
  assertEquals(fake.imageCalls, 4);
  const files = [...Deno.readDirSync(`${dir}/img`)];
  assertEquals(files.length, 4);
  assert(Deno.statSync(`${dir}/.secrets/id-salt`).mode! & 0o600);
});
