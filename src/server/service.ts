// Refresh per visit (BRIEF §1): each world request triggers one board fetch, shared by concurrent visits.
// A visit waits up to `fetchTimeoutMs`; after that (or on any Trello error) the last good snapshot is
// served, flagged `stale`. The fetch keeps running in the background and refreshes the next visit.

import { buildWorld } from "./classify.ts";
import { cleanBoard, type CleanSnapshot, idPairs, type ImageSources, makeHasher } from "./clean.ts";
import { log } from "./log.ts";
import { sniffImage, type Store } from "./store.ts";
import { type FetchOutcome, type RawBoard, TrelloError } from "./trello.ts";
import type { World } from "../shared/types.ts";

export interface ServiceDeps {
  store: Store;
  fetchBoard: (signal: AbortSignal) => Promise<RawBoard>;
  fetchImage: (url: string, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>;
  fetchTimeoutMs: number;
  minRefetchS: number;
  /** Hard limit of one background board fetch. */
  backgroundTimeoutMs?: number;
  now?: () => number;
}

export interface Rendered {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
  world: World;
}

export interface Health {
  status: "ok" | "no_snapshot";
  snapshot_age_s: number | null;
  last_fetch: FetchOutcome | "none";
  last_fetch_error?: string;
  trees: number;
  branches: number;
  pots: number;
  images_cached: number;
  images_known: number;
}

export class WorldService {
  private snapshot: CleanSnapshot | null = null;
  private snapshotAt = 0; // ms of the last successful fetch (or of the stored snapshot)
  private images: ImageSources = new Map();
  private inflight: Promise<boolean> | null = null;
  private lastOutcome: FetchOutcome | "none" = "none";
  private lastError: string | undefined;
  private rendered = new Map<boolean, Rendered>();
  private imageFetches = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();
  private imagesCached = 0;
  private prefetching: Promise<void> | null = null;
  private salt: Uint8Array<ArrayBuffer> | null = null;
  private readonly now: () => number;

  constructor(private d: ServiceDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Loads the stored snapshot (a restart without Trello still serves the world). */
  async init(): Promise<void> {
    await this.d.store.init();
    this.salt = await this.d.store.salt();
    const snap = await this.d.store.loadSnapshot();
    if (snap) {
      this.setSnapshot(snap);
      this.snapshotAt = Date.parse(snap.fetchedAt) || 0;
      log("info", "snapshot loaded", { cards: snap.cards.length, at: snap.fetchedAt });
    }
  }

  private setSnapshot(s: CleanSnapshot) {
    this.snapshot = s;
    this.rendered.clear();
  }

  /** One fetch at a time; resolves true on success. Never rejects. */
  refresh(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    const p = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    this.inflight = p;
    return p;
  }

  private async doRefresh(): Promise<boolean> {
    const t0 = this.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.d.backgroundTimeoutMs ?? 20_000);
    try {
      const raw = await this.d.fetchBoard(ctl.signal);
      const hash = await makeHasher(this.salt!, idPairs(raw));
      const { snapshot, images } = cleanBoard(raw, hash, new Date(this.now()));
      const changed = !this.snapshot || !sameContent(this.snapshot, snapshot);
      // Unchanged content keeps the same snapshot (and ETag); `snapshotAt` still records this fetch.
      if (changed) {
        await this.d.store.saveSnapshot(snapshot);
        this.setSnapshot(snapshot);
      }
      this.images = images;
      this.snapshotAt = this.now();
      this.lastOutcome = "ok";
      this.lastError = undefined;
      log("info", "trello fetch ok", {
        ms: this.now() - t0,
        lists: snapshot.lists.length,
        cards: snapshot.cards.length,
        changed,
      });
      this.prefetching = this.prefetchImages();
      return true;
    } catch (e) {
      const kind = e instanceof TrelloError ? e.message : "trello error";
      this.lastOutcome = e instanceof TrelloError && e.kind === "timeout" ? "timeout" : "error";
      this.lastError = kind;
      // Only the reduced kind is logged: raw errors can contain the request URL (board id).
      log("warn", "trello fetch failed", { ms: this.now() - t0, error: kind });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The world for one visit. Null only when no snapshot has ever been obtained. */
  async visit(): Promise<Rendered | null> {
    let fresh: boolean;
    if (
      this.snapshot && this.lastOutcome === "ok" && this.now() - this.snapshotAt < this.d.minRefetchS * 1000
    ) {
      fresh = true;
    } else {
      const p = this.refresh();
      let timer: number | undefined;
      const timeout = new Promise<"timeout">((r) => {
        timer = setTimeout(() => r("timeout"), this.d.fetchTimeoutMs);
      });
      const r = await Promise.race([p, timeout]);
      clearTimeout(timer);
      if (r === "timeout") {
        if (this.lastOutcome !== "error") this.lastOutcome = "timeout";
        fresh = false;
      } else fresh = r;
    }
    return this.render(!fresh);
  }

  render(stale: boolean): Rendered | null {
    if (!this.snapshot) return null;
    const hit = this.rendered.get(stale);
    if (hit) return hit;
    const world = buildWorld(this.snapshot, stale);
    const body = new TextEncoder().encode(JSON.stringify(world));
    const r: Rendered = { body, etag: `"${fnv(body)}"`, world };
    this.rendered.set(stale, r);
    return r;
  }

  health(): Health {
    const w = this.snapshot ? this.render(this.lastOutcome !== "ok") : null;
    return {
      status: this.snapshot ? "ok" : "no_snapshot",
      snapshot_age_s: this.snapshot ? Math.max(0, Math.round((this.now() - this.snapshotAt) / 1000)) : null,
      last_fetch: this.lastOutcome,
      ...(this.lastError ? { last_fetch_error: this.lastError } : {}),
      trees: w?.world.counts.trees ?? 0,
      branches: w?.world.counts.branches ?? 0,
      pots: w?.world.counts.pots ?? 0,
      images_cached: this.imagesCached,
      images_known: this.images.size,
    };
  }

  /** Is `id` an image of the current snapshot? */
  knowsImage(id: string): boolean {
    if (!this.snapshot) return false;
    if (this.images.has(id)) return true;
    return this.snapshot.cards.some((c) => c.attachments.some((a) => a.img === id));
  }

  /** Image bytes from the cache, downloading them once on demand if the source is known. */
  async image(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!/^[0-9a-f]{20}$/.test(id) || !this.knowsImage(id)) return null;
    const cached = await this.d.store.readImage(id);
    if (cached) return cached;
    return await this.download(id);
  }

  private download(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const src = this.images.get(id);
    if (!src) return Promise.resolve(null);
    const running = this.imageFetches.get(id);
    if (running) return running;
    const p = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15_000);
      try {
        const bytes = await this.d.fetchImage(src, ctl.signal);
        if (!sniffImage(bytes)) throw new TrelloError("invalid");
        await this.d.store.writeImage(id, bytes);
        this.imagesCached++;
        return bytes;
      } catch (e) {
        log("warn", "image fetch failed", { error: e instanceof TrelloError ? e.message : "error" });
        return null;
      } finally {
        clearTimeout(timer);
        this.imageFetches.delete(id);
      }
    })();
    this.imageFetches.set(id, p);
    return p;
  }

  private async prefetchImages() {
    let cached = 0;
    for (const id of this.images.keys()) {
      if (await this.d.store.hasImage(id)) cached++;
      else if (await this.download(id)) cached++;
    }
    this.imagesCached = cached;
  }

  /** Waits for background work (tests). */
  async settle() {
    while (this.inflight) await this.inflight;
    await this.prefetching;
    await Promise.all([...this.imageFetches.values()]);
  }
}

function sameContent(a: CleanSnapshot, b: CleanSnapshot): boolean {
  return JSON.stringify({ ...a, fetchedAt: "" }) === JSON.stringify({ ...b, fetchedAt: "" });
}

function fnv(b: Uint8Array<ArrayBuffer>): string {
  let h = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < b.length; i++) {
    h = Math.imul(h ^ b[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b[i], 0x5bd1e995) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + b.length.toString(16);
}
