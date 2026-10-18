// HTTP surface: /healthz, /api/world, /img/<id>, and the embedded front-end. HEAD is answered like GET.

import { ifNoneMatch } from "@std/http/etag";
import type { WorldService } from "./service.ts";
import { sniffImage } from "./store.ts";
import { log } from "./log.ts";

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

export function makeHandler(svc: WorldService, assets: Map<string, Asset>) {
  return async (req: Request): Promise<Response> => {
    const t0 = performance.now();
    const url = new URL(req.url);
    const res = await route(req, url, svc, assets).catch((e) => {
      log("error", "handler error", { path: url.pathname, error: e instanceof Error ? e.name : "error" });
      return json({ error: "internal" }, 500, false);
    });
    if (url.pathname !== "/healthz") {
      log("info", "req", {
        method: req.method,
        path: url.pathname.startsWith("/img/") ? "/img/:id" : url.pathname.slice(0, 64),
        status: res.status,
        ms: Math.round(performance.now() - t0),
      });
    }
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
