// The startup and shutdown lines (hosh-management AGENTS.md section 11), apart from main.ts so they are tested.

import { type Config, configNamesSet } from "./config.ts";
import { log } from "./log.ts";
import type { Store } from "./store.ts";

/** One `startup` line: version (on every line), port, data dir writable, config names that are set (no values). */
export async function logStartup(
  cfg: Config,
  store: Store,
  port: number,
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
) {
  const writable = await store.probe();
  log(writable ? "info" : "error", "startup", "bastonks listening", {
    port,
    data_dir_writable: writable,
    log_level: cfg.logLevel,
    config: configNamesSet(env),
  });
}

/** One `shutdown` line when a stop signal arrives. */
export function logShutdown(signal: string, upMs: number) {
  log("info", "shutdown", "stopping", { signal, uptime_ms: Math.round(upMs) });
}
