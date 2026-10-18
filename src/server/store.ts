// Everything persisted lives under the data dir (/data): the cleaned snapshot, cached image previews and
// the id salt. Writes are atomic (temp file + rename) so a crash never leaves a torn snapshot.

import type { CleanSnapshot } from "./clean.ts";

export class Store {
  constructor(readonly dir: string) {}

  get snapshotPath() {
    return `${this.dir}/snapshot.json`;
  }
  get imgDir() {
    return `${this.dir}/img`;
  }

  async init(): Promise<void> {
    await Deno.mkdir(`${this.dir}/.secrets`, { recursive: true, mode: 0o700 });
    await Deno.mkdir(this.imgDir, { recursive: true });
  }

  /** The salt of opaque ids, generated once (box contract rule 6: app-generated secrets in /data/.secrets). */
  async salt(): Promise<Uint8Array<ArrayBuffer>> {
    const p = `${this.dir}/.secrets/id-salt`;
    try {
      const s = await Deno.readFile(p);
      if (s.byteLength >= 32) return s;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    const s = crypto.getRandomValues(new Uint8Array(32));
    await this.atomicWrite(p, s, 0o600);
    return s;
  }

  async loadSnapshot(): Promise<CleanSnapshot | null> {
    try {
      const snap = JSON.parse(await Deno.readTextFile(this.snapshotPath)) as CleanSnapshot;
      return snap?.v === 1 && Array.isArray(snap.cards) ? snap : null;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound || e instanceof SyntaxError) return null;
      throw e;
    }
  }

  async saveSnapshot(s: CleanSnapshot): Promise<void> {
    await this.atomicWrite(this.snapshotPath, new TextEncoder().encode(JSON.stringify(s)), 0o600);
  }

  imagePath(id: string): string {
    if (!/^[0-9a-f]{20}$/.test(id)) throw new Error("bad image id");
    return `${this.imgDir}/${id}`;
  }

  async readImage(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      return await Deno.readFile(this.imagePath(id));
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return null;
      throw e;
    }
  }

  async hasImage(id: string): Promise<boolean> {
    try {
      await Deno.stat(this.imagePath(id));
      return true;
    } catch {
      return false;
    }
  }

  async writeImage(id: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.atomicWrite(this.imagePath(id), data, 0o600);
  }

  private async atomicWrite(path: string, data: Uint8Array<ArrayBuffer>, mode: number) {
    const tmp = `${path}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    await Deno.writeFile(tmp, data, { mode });
    await Deno.rename(tmp, path);
  }
}

/** Image type from magic bytes; only these four are ever served. */
export function sniffImage(b: Uint8Array<ArrayBuffer>): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  return null;
}
