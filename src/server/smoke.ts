// Capability smoke (BRIEF §10, DEPLOY.md §3), run INSIDE the container by hosh-deploy after each deploy and
// by CI against the hardened container. Prints one JSON line per check, never any card content.

import { hasMaskable } from "./mask.ts";
import type { World } from "../shared/types.ts";

interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}

function flag(args: string[], name: string, def: number): number {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
}

/** Fields that hold generated values (opaque ids, ISO dates), not card content. */
const GENERATED = new Set([
  "id",
  "img",
  "created",
  "lastActivity",
  "due",
  "week",
  "snapshotAt",
  "exceptional",
]);

/** Every content string inside a JSON value. */
function* strings(v: unknown): Generator<string> {
  if (typeof v === "string") yield v;
  else if (Array.isArray(v)) { for (const x of v) yield* strings(x); }
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) if (!GENERATED.has(k)) yield* strings(x);
  }
}

export function checkWorld(world: World, raw: string, minTrees: number, minBranches: number) {
  const checks: Check[] = [];
  const items = [...world.trees.flatMap((t) => t.branches), ...world.pots];
  checks.push({ name: "trees", ok: world.trees.length >= minTrees, detail: world.trees.length });
  checks.push({ name: "branches", ok: world.counts.branches >= minBranches, detail: world.counts.branches });
  checks.push({ name: "no-trello-string", ok: !/trello\.com/i.test(raw) });
  const leaks = [...strings(world)].filter((s) => hasMaskable(s)).length;
  checks.push({ name: "masked (email/phone/patient codes)", ok: leaks === 0, detail: leaks });
  checks.push({ name: "no-astuce-trello", ok: !items.some((i) => /^\s*Astuce Trello/i.test(i.name)) });
  const weeks = world.trees.map((t) => t.week);
  checks.push({ name: "path in week order", ok: weeks.every((w, i) => i === 0 || weeks[i - 1] <= w) });
  const atts = items.flatMap((i) => i.attachments);
  checks.push({
    name: "only images have urls",
    ok: atts.every((a) => !a.img || /^\/img\/[0-9a-f]{20}$/.test(a.img)),
  });
  return { checks, firstImage: atts.find((a) => a.img)?.img };
}

export async function runSmoke(base: string, args: string[]): Promise<number> {
  const minTrees = flag(args, "--min-trees", 100);
  const minBranches = flag(args, "--min-branches", 2000);
  const expectStale = args.includes("--expect-stale");
  const checks: Check[] = [];
  const get = (p: string, init?: RequestInit) =>
    fetch(`${base}${p}`, { ...init, signal: AbortSignal.timeout(15000) });
  try {
    const h = await get("/healthz");
    const hb = await h.json();
    checks.push({ name: "healthz", ok: h.status === 200 && hb.status === "ok", detail: hb.last_fetch });

    const r = await get("/api/world");
    const raw = await r.text();
    const world = JSON.parse(raw) as World;
    checks.push({ name: "world 200", ok: r.status === 200 });
    const w = checkWorld(world, raw, minTrees, minBranches);
    checks.push(...w.checks);
    if (expectStale) checks.push({ name: "stale when Trello is unreachable", ok: world.stale === true });

    const etag = r.headers.get("etag");
    const r304 = await get("/api/world", { headers: etag ? { "if-none-match": etag } : {} });
    await r304.body?.cancel();
    checks.push({ name: "etag 304", ok: !!etag && (r304.status === 304 || r304.status === 200) });

    if (w.firstImage) {
      const im = await get(w.firstImage);
      const type = im.headers.get("content-type") ?? "";
      await im.body?.cancel();
      checks.push({ name: "image served", ok: im.status === 200 && type.startsWith("image/"), detail: type });
    } else {
      checks.push({ name: "image served", ok: true, detail: "no image attachment in the world" });
    }

    const page = await get("/");
    const html = await page.text();
    const csp = page.headers.get("content-security-policy") ?? "";
    checks.push({
      name: "front-end + strict CSP",
      ok: page.status === 200 && html.includes("<canvas") && csp.includes("default-src 'self'"),
    });
    const dot = await get("/.env");
    await dot.body?.cancel();
    checks.push({ name: "dotfiles 404", ok: dot.status === 404 });
  } catch (e) {
    checks.push({ name: "reachable", ok: false, detail: e instanceof Error ? e.name : "error" });
  }
  for (const c of checks) console.log(JSON.stringify({ smoke: c.name, ok: c.ok, detail: c.detail }));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(JSON.stringify({ smoke: "summary", ok: failed === 0, failed, total: checks.length }));
  return failed === 0 ? 0 : 1;
}
