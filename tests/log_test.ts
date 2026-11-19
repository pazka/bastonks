// Logging standard (hosh-management AGENTS.md section 11): one JSON object per line with ts, level, service,
// version, event, msg; one startup and one shutdown line; requests logged only when they matter, with req_id,
// method, route template, status and dur_ms; `err` on error lines; jobs log a start and an end line; no Trello
// URL, key, token, board or card id in any line.

import { assert, assertEquals, assertMatch } from "@std/assert";
import { configNamesSet, loadConfig } from "../src/server/config.ts";
import { makeHandler } from "../src/server/http.ts";
import { logShutdown, logStartup } from "../src/server/lifecycle.ts";
import { errField, setLogLevel, setLogSink, setLogVersion } from "../src/server/log.ts";
import { WorldService } from "../src/server/service.ts";
import { Store } from "../src/server/store.ts";
import { TrelloError } from "../src/server/trello.ts";
import { FAKE_BOARD_ID, SEEDED_SECRETS, syntheticBoard } from "./fixtures/synthetic.ts";
import { gradientPng } from "./fixtures/png.ts";

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Line = Record<string, unknown>;

/** Captures the log lines at `level` for the time of `fn`, then restores stdout and the test level. */
async function capture(level: string, fn: () => Promise<void> | void): Promise<Line[]> {
  const lines: string[] = [];
  const prev = setLogSink((l) => lines.push(l));
  setLogLevel(level);
  setLogVersion("v9.9.9-test");
  try {
    await fn();
  } finally {
    setLogSink(prev);
    setLogLevel("error");
    setLogVersion("dev");
  }
  return lines.map((l) => JSON.parse(l)); // every line is one JSON object
}

function checkFormat(rec: Line) {
  for (const k of ["ts", "level", "service", "version", "event", "msg"]) {
    assert(k in rec, `${k} missing: ${JSON.stringify(rec)}`);
  }
  assertMatch(rec.ts as string, TS);
  assert(["debug", "info", "warn", "error"].includes(rec.level as string), `level ${rec.level}`);
  assertEquals(rec.service, "bastonks");
  assertEquals(rec.version, "v9.9.9-test");
  assertMatch(rec.event as string, /^[a-z][a-z0-9_]*$/);
}

/** No Trello secret, id or URL in the lines. */
function assertNothingSecret(recs: Line[]) {
  const raw = JSON.stringify(recs);
  for (const s of [FAKE_BOARD_ID, ...SEEDED_SECRETS, "trello-key-zz", "trello-token-zz", "https://"]) {
    assert(!raw.includes(s), `${s} in the log: ${raw.slice(0, 400)}`);
  }
}

async function service(mode: "ok" | "fail", dir?: string, imageFails = false) {
  const svc = new WorldService({
    store: new Store(dir ?? await Deno.makeTempDir({ prefix: "bastonks-log-" })),
    fetchBoard: () => {
      if (mode === "fail") return Promise.reject(new TrelloError("http", 401));
      return Promise.resolve(structuredClone(syntheticBoard()));
    },
    fetchImage: () =>
      imageFails ? Promise.reject(new TrelloError("http", 404)) : Promise.resolve(gradientPng(32, 24)),
    fetchTimeoutMs: 2000,
    minRefetchS: 0,
  });
  await svc.init();
  return svc;
}

const ASSETS = new Map([
  ["/index.html", { type: "text/html", body: new TextEncoder().encode("<canvas>"), immutable: false }],
  ["/app-1234.js", { type: "text/javascript", body: new TextEncoder().encode("1"), immutable: true }],
]);

Deno.test("log: startup line has version, port, data dir writable and config names without values", async () => {
  const dataDir = await Deno.makeTempDir({ prefix: "bastonks-log-" });
  const env: Record<string, string> = {
    TRELLO_KEY: "trello-key-zz",
    TRELLO_TOKEN: "trello-token-zz",
    TRELLO_BOARD_ID: FAKE_BOARD_ID,
    APP_DATA_DIR: dataDir,
    BASTONKS_VERSION: "v9.9.9-test",
    UNRELATED: "x",
  };
  const cfg = loadConfig((k) => env[k]);
  assertEquals(cfg.version, "v9.9.9-test");
  assertEquals(loadConfig(() => undefined).version, "dev");
  const store = new Store(dataDir);
  await store.init();
  const recs = await capture("info", () => logStartup(cfg, store, 8123, (k) => env[k]));
  assertEquals(recs.length, 1);
  const s = recs[0];
  checkFormat(s);
  assertEquals([s.level, s.event, s.port, s.data_dir_writable, s.log_level], [
    "info",
    "startup",
    8123,
    true,
    "info",
  ]);
  assertEquals(s.config, [
    "TRELLO_KEY",
    "TRELLO_TOKEN",
    "TRELLO_BOARD_ID",
    "APP_DATA_DIR",
    "BASTONKS_VERSION",
  ]);
  assertEquals(configNamesSet((k) => env[k]), s.config);
  assertNothingSecret(recs);
  assert(!JSON.stringify(s).includes(dataDir));
  assertEquals(
    [...Deno.readDirSync(dataDir)].map((e) => e.name).sort(),
    [".secrets", "img"],
    "probe file removed",
  );

  // a data dir that cannot be written: the same line, at error, says so
  await Deno.remove(dataDir, { recursive: true });
  const bad = await capture("info", () => logStartup(cfg, store, 8123, (k) => env[k]));
  checkFormat(bad[0]);
  assertEquals([bad[0].level, bad[0].event, bad[0].data_dir_writable], ["error", "startup", false]);

  const down = await capture("info", () => logShutdown("SIGTERM", 12.6));
  checkFormat(down[0]);
  assertEquals([down[0].level, down[0].event, down[0].signal, down[0].uptime_ms], [
    "info",
    "shutdown",
    "SIGTERM",
    13,
  ]);
});

Deno.test("log: an unhandled error in a request gives one error line with err, route template and req_id", async () => {
  const svc = await service("ok");
  // a raw Trello error carries the request URL (key, token, board id): it must not reach the log
  svc.visit = () =>
    Promise.reject(
      new Error(
        `fetch failed: https://api.trello.com/1/boards/${FAKE_BOARD_ID}?key=trello-key-zz&token=trello-token-zz`,
      ),
    );
  const h = makeHandler(svc, ASSETS);
  let res!: Response;
  const recs = await capture("info", async () => {
    res = await h(new Request("http://x/api/world?board=zz", { headers: { "x-request-id": "qa-req-1" } }));
  });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "internal" });
  assertEquals(res.headers.get("x-request-id"), "qa-req-1");
  assertEquals(recs.length, 1, JSON.stringify(recs));
  const e = recs[0];
  checkFormat(e);
  assertEquals([e.level, e.event, e.req_id, e.method, e.route, e.status], [
    "error",
    "request_failed",
    "qa-req-1",
    "GET",
    "/api/world",
    500,
  ]);
  assertEquals(typeof e.dur_ms, "number");
  const err = e.err as Record<string, string>;
  assertEquals(err.type, "Error");
  assertEquals(err.message, "fetch failed: <url>");
  assert(typeof err.stack === "string" && err.stack.includes("<url>"), err.stack);
  assertNothingSecret(recs);
  assert(!JSON.stringify(e).includes("board=zz"));
});

Deno.test("log: requests are logged only when they matter; req_id is echoed or generated", async () => {
  const svc = await service("ok");
  await svc.refresh();
  await svc.settle();
  const h = makeHandler(svc, ASSETS);
  const get = (p: string, init?: RequestInit) => h(new Request(`http://x${p}`, init));
  const imgPath = (await (await get("/api/world")).text()).match(/"(\/img\/[^"]+)"/)?.[1];
  assert(imgPath, "the synthetic board has image previews");
  const imgId = imgPath.slice(5);

  // at info, normal answers (2xx, 304, 404) write nothing
  let res!: Response;
  const quiet = await capture("info", async () => {
    res = await get("/");
    await get("/healthz");
    await get("/api/world");
    await get("/nope?x=secret-query");
  });
  assertEquals(quiet.filter((r) => r.event === "http" || r.event === "request_failed"), []);
  assertMatch(res.headers.get("x-request-id") ?? "", UUID);
  const echoed = await get("/healthz", { headers: { "x-request-id": "edge-abc.1" } });
  assertEquals(echoed.headers.get("x-request-id"), "edge-abc.1");
  const refused = await get("/healthz", { headers: { "x-request-id": "bad id with spaces" } });
  assertMatch(refused.headers.get("x-request-id") ?? "", UUID);
  const notGet = await get("/api/world", { method: "POST" });
  assertEquals([notGet.status, typeof notGet.headers.get("x-request-id")], [405, "string"]);

  // a 5xx is an error line: /api/world before any snapshot (Trello down) answers 503
  const empty = await service("fail");
  const r503 = await capture("info", async () => {
    const r = await makeHandler(empty, ASSETS)(new Request("http://x/api/world"));
    assertEquals(r.status, 503);
  });
  const l503 = r503.filter((r) => r.event === "http");
  assertEquals(l503.length, 1, JSON.stringify(r503));
  checkFormat(l503[0]);
  assertEquals([l503[0].level, l503[0].msg, l503[0].route, l503[0].status], [
    "error",
    "server error",
    "/api/world",
    503,
  ]);

  // at debug, every request, /healthz included, with the route template only
  const all = await capture("debug", async () => {
    await get("/");
    await get("/healthz");
    await get("/app-1234.js");
    await get("/index.html");
    await get("/nope/deeper?x=secret-query");
    await get(imgPath);
  });
  const http = all.filter((r) => r.event === "http");
  for (const r of http) {
    checkFormat(r);
    assertEquals([r.level, r.msg, r.method], ["debug", "request", "GET"]);
    assertMatch(r.req_id as string, UUID);
    assertEquals(typeof r.dur_ms, "number");
  }
  assertEquals(http.map((r) => [r.route, r.status]), [
    ["/", 200],
    ["/healthz", 200],
    ["/:asset", 200],
    ["/:other", 200],
    ["/:other", 404],
    ["/img/:id", 200],
  ]);
  const raw = JSON.stringify(all);
  assert(!raw.includes("secret-query") && !raw.includes("deeper") && !raw.includes("app-1234"), raw);
  assert(!raw.includes(imgId), "image id in the log");
});

Deno.test("log: /healthz is logged at debug only, a 503 (no snapshot) included", async () => {
  const empty = await service("fail");
  const h = makeHandler(empty, ASSETS);
  const quiet = await capture("info", async () => {
    const r = await h(new Request("http://x/healthz", { headers: { "x-request-id": "qa-health-503" } }));
    assertEquals(r.status, 503);
    assertEquals((await r.json()).status, "no_snapshot");
  });
  assertEquals(
    quiet.filter((r) => r.event === "http" || r.event === "request_failed"),
    [],
    JSON.stringify(quiet),
  );
  const dbg = await capture("debug", async () => {
    const r = await h(new Request("http://x/healthz", { headers: { "x-request-id": "qa-health-503" } }));
    assertEquals(r.status, 503);
  });
  const http = dbg.filter((r) => r.event === "http");
  assertEquals(http.length, 1, JSON.stringify(dbg));
  checkFormat(http[0]);
  assertEquals([http[0].level, http[0].msg, http[0].req_id, http[0].method, http[0].route, http[0].status], [
    "debug",
    "request",
    "qa-health-503",
    "GET",
    "/healthz",
    503,
  ]);
});

Deno.test("log: a request slower than 1 s gives one warn line with the route template, status and dur_ms", async () => {
  const svc = await service("ok");
  await svc.refresh();
  const orig = svc.visit.bind(svc);
  svc.visit = async () => {
    await sleep(1100);
    return orig();
  };
  const h = makeHandler(svc, ASSETS);
  let res!: Response;
  const recs = await capture("info", async () => {
    res = await h(new Request("http://x/api/world?x=1", { headers: { "x-request-id": "qa-slow-1" } }));
  });
  assertEquals(res.status, 200);
  const http = recs.filter((r) => r.event === "http");
  assertEquals(http.length, 1, JSON.stringify(recs));
  const s = http[0];
  checkFormat(s);
  assertEquals([s.level, s.msg, s.req_id, s.method, s.route, s.status], [
    "warn",
    "slow request",
    "qa-slow-1",
    "GET",
    "/api/world",
    200,
  ]);
  assert(typeof s.dur_ms === "number" && s.dur_ms > 1000, `dur_ms ${s.dur_ms}`);
  await svc.settle();
});

Deno.test("log: the Trello fetch and the image prefetch write a start and an end line with dur_ms and counts", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bastonks-log-" });
  const svc = await service("ok", dir);
  const recs = await capture("info", async () => {
    assert(await svc.refresh());
    await svc.settle();
  });
  for (const r of recs) checkFormat(r);
  const events = recs.map((r) => r.event);
  assertEquals(events, [
    "trello_fetch_start",
    "trello_fetch_done",
    "image_prefetch_start",
    "image_prefetch_done",
  ]);
  const done = recs[1];
  assertEquals(done.level, "info");
  assert(Number.isInteger(done.dur_ms) && Number.isInteger(done.cards) && Number.isInteger(done.lists));
  assert((done.cards as number) > 0 && done.changed === true, JSON.stringify(done));
  const [start, end] = [recs[2], recs[3]];
  assert((start.missing as number) > 0 && start.missing === start.images, JSON.stringify(start));
  assertEquals([end.level, end.downloaded, end.failed, end.cached], ["info", start.missing, 0, start.images]);
  assert(Number.isInteger(end.dur_ms));
  assertNothingSecret(recs);

  // same board again: every image is cached, no prefetch job; a restart logs the stored snapshot
  const again = await capture("info", async () => {
    await svc.refresh();
    await svc.settle();
  });
  assertEquals(again.map((r) => [r.event, r.changed]), [["trello_fetch_start", undefined], [
    "trello_fetch_done",
    false,
  ]]);
  const restart = await capture("info", () => service("fail", dir).then(() => {}));
  assertEquals(restart.map((r) => r.event), ["snapshot_loaded"]);
  checkFormat(restart[0]);
  assertEquals(restart[0].cards, done.cards);
});

Deno.test("log: failed Trello and image fetches are warn lines with the reduced kind only", async () => {
  const down = await service("fail");
  const recs = await capture("info", async () => {
    assertEquals(await down.refresh(), false);
  });
  assertEquals(recs.map((r) => r.event), ["trello_fetch_start", "trello_fetch_failed"]);
  const f = recs[1];
  checkFormat(f);
  assertEquals(f.level, "warn");
  assert(typeof f.error === "string" && (f.error as string).length > 0);
  assert(Number.isInteger(f.dur_ms));

  const noImages = await service("ok", undefined, true);
  const img = await capture("info", async () => {
    await noImages.refresh();
    await noImages.settle();
  });
  const failed = img.filter((r) => r.event === "image_fetch_failed");
  assert(failed.length > 0);
  for (const r of failed) assertEquals(r.level, "warn");
  const end = img.find((r) => r.event === "image_prefetch_done")!;
  assertEquals([end.level, end.downloaded, end.failed], ["warn", 0, failed.length]);
  assertNothingSecret([...recs, ...img]);
});

Deno.test("log: APP_LOG_LEVEL filters; err of a non-Error value", async () => {
  const svc = await service("fail");
  const warnOnly = await capture("warn", async () => {
    await svc.refresh();
  });
  assertEquals(warnOnly.map((r) => r.event), ["trello_fetch_failed"]);
  assertEquals(errField("boom at https://trello.com/b/xyz"), {
    err: { type: "string", message: "boom at <url>" },
  });
  assertEquals(loadConfig(() => undefined).logLevel, "info");
});
