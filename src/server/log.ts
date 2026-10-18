// JSON lines on stdout (box contract rule 8). Never pass URLs, ids or tokens of Trello here.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let min: Level = "info";

export function setLogLevel(l: string | undefined) {
  if (l && l in ORDER) min = l as Level;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[min]) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
}
