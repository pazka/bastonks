// HTTP surface: /healthz, /api/world, /img/<id>, and the embedded front-end. HEAD is answered like GET.

import { ifNoneMatch } from "@std/http/etag";
import type { WorldService } from "./service.ts";
import { sniffImage } from "./store.ts";
import { errField, log, logEnabled } from "./log.ts";

export interface Asset {
  type: string;
  body: Uint8Array<ArrayBuffer>;
  /** Long-lived cache for fingerprinted files; index.html is always revalidated. */
  immutable: boolean;
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

function respond(body: BodyInit | null, status: number, headers: Record<string, string>, head: boolean) {
  return new Response(head ? null : body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

const json = (v: unknown, status: number, head: boolean, extra: Record<string, string> = {}) =>
  respond(JSON.stringify(v), status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  }, head);

/** The route template of a path, never the raw path (image ids, probes of random URLs). */
export function routeTemplate(path: string, assets: Map<string, Asset>): string {
  if (path.startsWith("/img/")) return "/img/:id";
  if (path === "/" || path === "/healthz" || path === "/api/world") return path;
  if (assets.has(path) && path !== "/index.html") return "/:asset";
  return "/:other";
}

/** X-Request-Id from the edge when it is a plain token, else a new one. */
function requestId(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && /^[A-Za-z0-9._:-]{1,128}$/.test(given) ? given : crypto.randomUUID();
}

const SLOW_MS = 1000;

export function makeHandler(svc: WorldService, assets: Map<string, Asset>) {
  return async (req: Request): Promise<Response> => {
    const t0 = performance.now();
    const url = new URL(req.url);
    const reqId = requestId(req);
    const line = (status: number) => ({
      req_id: reqId,
      method: req.method,
      route: routeTemplate(url.pathname, assets),
      status,
      dur_ms: Math.round(performance.now() - t0),
    });
    let res: Response;
    try {
      res = await route(req, url, svc, assets);
    } catch (e) {
      res = json({ error: "internal" }, 500, false);
      log("error", "request_failed", "unhandled error in a request", { ...line(500), ...errField(e) });
      res.headers.set("x-request-id", reqId);
      return res;
    }
    res.headers.set("x-request-id", reqId);
    // Requests are Traefik's job: log only what matters (5xx, slow), the rest at debug. /healthz is always
    // debug (AGENTS.md section 11), whatever its status: the probes call it every 30 s, a 503 included.
    const l = line(res.status);
    if (l.route === "/healthz") {
      if (logEnabled("debug")) log("debug", "http", "request", l);
    } else if (res.status >= 500) log("error", "http", "server error", l);
    else if (l.dur_ms > SLOW_MS) log("warn", "http", "slow request", l);
    else if (logEnabled("debug")) log("debug", "http", "request", l);
    return res;
  };
}

async function route(
  req: Request,
  url: URL,
  svc: WorldService,
  assets: Map<string, Asset>,
): Promise<Response> {
  const head = req.method === "HEAD";
  if (req.method !== "GET" && !head) {
    return respond("method not allowed", 405, { allow: "GET, HEAD", "content-type": "text/plain" }, false);
  }
  const path = url.pathname;
  // Dotfiles and traversal never resolve (the edge blocks them too).
  if (path.split("/").some((seg) => seg.startsWith(".")) || path.includes("..")) {
    return respond("not found", 404, { "content-type": "text/plain" }, head);
  }

  if (path === "/healthz") {
    const h = svc.health();
    return json(h, h.status === "ok" ? 200 : 503, head);
  }

  if (path === "/api/world") {
    const r = await svc.visit();
    if (!r) return json({ error: "no snapshot yet" }, 503, head, { "retry-after": "10" });
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
      etag: r.etag,
    };
    if (!ifNoneMatch(req.headers.get("if-none-match"), r.etag)) return respond(null, 304, headers, true);
    return respond(r.body, 200, headers, head);
  }

  if (path.startsWith("/img/")) {
    const id = path.slice(5);
    const bytes = await svc.image(id);
    const type = bytes ? sniffImage(bytes) : null;
    if (!bytes || !type) return respond("not found", 404, { "content-type": "text/plain" }, head);
    return respond(bytes, 200, {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
    }, head);
  }

  const asset = assets.get(path === "/" ? "/index.html" : path);
  if (asset) {
    return respond(asset.body, 200, {
      "content-type": asset.type,
      "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    }, head);
  }
  return respond("not found", 404, { "content-type": "text/plain" }, head);
}
