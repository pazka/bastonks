// bastonks — one binary: `serve` (default), `healthcheck` (compose) and `smoke` (hosh-deploy POST_DEPLOY).

import { loadAssets } from "./assets.ts";
import { loadConfig } from "./config.ts";
import { makeHandler } from "./http.ts";
import { logShutdown, logStartup } from "./lifecycle.ts";
import { setLogLevel, setLogVersion } from "./log.ts";
import { WorldService } from "./service.ts";
import { runSmoke } from "./smoke.ts";
import { Store } from "./store.ts";
import { fetchBoard, fetchImage } from "./trello.ts";

async function serve() {
  const t0 = performance.now();
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  setLogVersion(cfg.version);
  const store = new Store(cfg.dataDir);
  const svc = new WorldService({
    store,
    fetchBoard: (signal) => fetchBoard(cfg.trello, signal),
    fetchImage: (url, signal) => fetchImage(cfg.trello, url, signal),
    fetchTimeoutMs: cfg.fetchTimeoutMs,
    minRefetchS: cfg.minRefetchS,
  });
  await svc.init();
  svc.refresh(); // warm up: a first snapshot before the first visit
  const handler = makeHandler(svc, loadAssets());
  const ctl = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    Deno.addSignalListener(sig, () => {
      logShutdown(sig, performance.now() - t0);
      ctl.abort();
    });
  }
  const server = Deno.serve({
    hostname: "0.0.0.0",
    port: cfg.port,
    signal: ctl.signal,
    onListen: ({ port }) => void logStartup(cfg, store, port),
  }, handler);
  await server.finished;
}

async function healthcheck(base: string): Promise<number> {
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(4000) });
    const body = await res.json();
    return res.status === 200 && body?.status === "ok" ? 0 : 1;
  } catch {
    return 1;
  }
}

const [cmd = "serve", ...rest] = Deno.args;
const base = rest.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:8000";
if (cmd === "serve") await serve();
else if (cmd === "healthcheck") Deno.exit(await healthcheck(base));
else if (cmd === "smoke") Deno.exit(await runSmoke(base, rest));
else {
  console.error(
    "usage: bastonks [serve | healthcheck [url] | smoke [url] [--min-trees N] [--min-branches N]]",
  );
  Deno.exit(2);
}
