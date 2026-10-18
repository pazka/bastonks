// Configuration from env only (box contract rule 6). The variable list is also the compiled --allow-env list.

export const ENV_VARS = [
  "TRELLO_KEY",
  "TRELLO_TOKEN",
  "TRELLO_BOARD_ID",
  "APP_DATA_DIR",
  "APP_PORT",
  "APP_FETCH_TIMEOUT_MS",
  "APP_MIN_REFETCH_S",
  "APP_LOG_LEVEL",
  "APP_BASE_URL",
  "APP_TRUSTED_PROXIES",
] as const;

export interface Config {
  trello: { key: string; token: string; boardId: string };
  dataDir: string;
  port: number;
  /** How long a visit waits for Trello before the last good snapshot is served (BRIEF: ~3 s). */
  fetchTimeoutMs: number;
  /** Visits closer than this to the last successful fetch reuse it (protects the Trello rate limit). */
  minRefetchS: number;
  logLevel: string;
}

function int(v: string | undefined, def: number, lo: number, hi: number): number {
  const n = v === undefined || v === "" ? def : Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
}

export function loadConfig(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Config {
  return {
    trello: {
      key: env("TRELLO_KEY") ?? "",
      token: env("TRELLO_TOKEN") ?? "",
      boardId: env("TRELLO_BOARD_ID") ?? "",
    },
    dataDir: env("APP_DATA_DIR") || "/data",
    port: int(env("APP_PORT"), 8000, 1, 65535),
    fetchTimeoutMs: int(env("APP_FETCH_TIMEOUT_MS"), 3000, 200, 30000),
    minRefetchS: int(env("APP_MIN_REFETCH_S"), 10, 0, 3600),
    logLevel: env("APP_LOG_LEVEL") || "info",
  };
}
