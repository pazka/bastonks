// JSON lines on stdout (box contract rule 8, hosh-management AGENTS.md section 11). Never pass URLs, ids or
// tokens of Trello here: Trello errors are reduced to their kind before they are logged, and `errField` hides
// every http(s) URL (a Trello request URL carries the key, the token and the board id).

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let min: Level = "info";
let version = "dev";
let sink: (line: string) => void = (line) => console.log(line);

export function setLogLevel(l: string | undefined) {
  if (l && l in ORDER) min = l as Level;
}

/** The release tag put on every line (set once at startup from the config). */
export function setLogVersion(v: string) {
  version = v;
}

/** Where the lines go (stdout by default). Tests capture them; returns the previous sink. */
export function setLogSink(s: (line: string) => void): (line: string) => void {
  const prev = sink;
  sink = s;
  return prev;
}

export function logEnabled(level: Level): boolean {
  return ORDER[level] >= ORDER[min];
}

/** One line: ts, level, service, version, event (stable snake_case name), msg, then the fields. */
export function log(level: Level, event: string, msg: string, fields: Record<string, unknown> = {}) {
  if (!logEnabled(level)) return;
  sink(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: "bastonks",
      version,
      event,
      msg,
      ...fields,
    }),
  );
}

const URL_RE = /\bhttps?:\/\/[^\s'"<>]+/gi;

/** The `err` field of an error line: type, message and stack, with every http(s) URL replaced by `<url>`. */
export function errField(e: unknown): { err: { type: string; message: string; stack?: string } } {
  const clean = (s: string) => s.replace(URL_RE, "<url>");
  if (e instanceof Error) {
    return {
      err: { type: e.name, message: clean(e.message), ...(e.stack ? { stack: clean(e.stack) } : {}) },
    };
  }
  return { err: { type: typeof e, message: clean(String(e)) } };
}
