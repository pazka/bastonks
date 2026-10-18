// Privacy pipeline: raw Trello board → cleaned snapshot. ALLOWLIST: only the fields copied below survive.
// Every text is masked. Trello ids are replaced by salted opaque ids. Image sources stay in memory only.

import { mask } from "./mask.ts";
import type { RawAttachment, RawBoard, RawCard } from "./trello.ts";
import { dateFromTrelloId } from "./week.ts";
import type { CheckItem } from "../shared/types.ts";

export interface CleanAttachment {
  name: string;
  /** Opaque image id, for image attachments only. */
  img?: string;
}
export interface CleanCard {
  id: string;
  list: string;
  name: string;
  desc: string;
  labels: string[];
  cover: string | null;
  checklist: CheckItem[];
  created: string;
  lastActivity: string;
  due: string | null;
  /** Trello start date, if set (older snapshots lack it). */
  start?: string | null;
  archived: boolean;
  pos: number;
  attachments: CleanAttachment[];
}
export interface CleanList {
  id: string;
  name: string;
  archived: boolean;
  pos: number;
}
export interface CleanLabel {
  id: string;
  name: string;
  color: string | null;
}
export interface CleanSnapshot {
  v: 1;
  fetchedAt: string;
  labels: CleanLabel[];
  lists: CleanList[];
  cards: CleanCard[];
}

/** Where to download an image (Trello URL): kept in memory, never stored, never sent. */
export type ImageSources = Map<string, string>;

export type IdHasher = (kind: string, trelloId: string) => string;

/**
 * Opaque ids: first 20 hex chars of HMAC-SHA-256(salt, "<kind>:<trello id>"). The salt is generated once in
 * /data/.secrets, so ids are stable for a volume and cannot be mapped back to Trello without it.
 * WebCrypto is async, so all ids of a board are computed up front and looked up synchronously.
 */
export async function makeHasher(
  salt: Uint8Array<ArrayBuffer>,
  pairs: Iterable<[string, string]>,
): Promise<IdHasher> {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const table = new Map<string, string>();
  await Promise.all([...pairs].map(async ([kind, id]) => {
    const k = `${kind}:${id}`;
    if (table.has(k)) return;
    table.set(k, "");
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(k)));
    table.set(k, [...sig.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  }));
  return (kind, id) => {
    const v = table.get(`${kind}:${id}`);
    if (!v) throw new Error(`id not prepared: ${kind}`);
    return v;
  };
}

/** Every (kind, id) pair `cleanBoard` will ask the hasher for. */
export function idPairs(raw: RawBoard): [string, string][] {
  const out: [string, string][] = [];
  for (const l of raw.labels ?? []) if (typeof l.id === "string") out.push(["label", l.id]);
  for (const l of raw.lists ?? []) if (typeof l.id === "string") out.push(["list", l.id]);
  for (const c of raw.cards ?? []) {
    if (typeof c.id !== "string") continue;
    out.push(["card", c.id]);
    for (const a of c.attachments ?? []) if (typeof a.id === "string") out.push(["img", a.id]);
  }
  return out;
}

export const EXCLUDED_CARD = /^\s*Astuce Trello/i;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/i;
const MAX_PREVIEW = 1024;

/** The best preview URL of an image attachment: the largest pre-scaled one ≤ 1024 px, else the smallest. */
export function pickPreview(a: RawAttachment): string | null {
  const isImage = (a.mimeType && IMAGE_MIME.test(a.mimeType)) || IMAGE_EXT.test(a.name ?? "");
  if (!isImage || a.isUpload === false) return null;
  const previews = (a.previews ?? []).filter((p) => p.url && p.width && p.height);
  if (previews.length === 0) return null;
  const size = (p: { width?: number; height?: number }) => Math.max(p.width ?? 0, p.height ?? 0);
  const fitting = previews.filter((p) => size(p) <= MAX_PREVIEW).sort((x, y) => size(y) - size(x));
  const chosen = fitting[0] ?? previews.sort((x, y) => size(x) - size(y))[0];
  return chosen.url ?? null;
}

function iso(s: unknown, fallback: Date): string {
  if (typeof s === "string") {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const COLOR = /^[a-z_]{2,20}$/;
const color = (v: unknown): string | null => (typeof v === "string" && COLOR.test(v) ? v : null);

export interface CleanResult {
  snapshot: CleanSnapshot;
  images: ImageSources;
}

/** Applies the allowlist + masking. `now` is the fetch time. */
export function cleanBoard(raw: RawBoard, hash: IdHasher, now = new Date()): CleanResult {
  const images: ImageSources = new Map();
  const checklistsByCard = new Map<string, CheckItem[]>();
  const checklists = [...(raw.checklists ?? [])].sort((a, b) => num(a.pos) - num(b.pos));
  for (const cl of checklists) {
    if (typeof cl.idCard !== "string") continue;
    const items = [...(cl.checkItems ?? [])].sort((a, b) => num(a.pos) - num(b.pos));
    const out = checklistsByCard.get(cl.idCard) ?? [];
    for (const it of items) {
      const text = mask(str(it.name)).trim();
      if (text) out.push({ text, done: it.state === "complete" });
    }
    checklistsByCard.set(cl.idCard, out);
  }

  const labels: CleanLabel[] = (raw.labels ?? []).map((l) => ({
    id: hash("label", l.id),
    name: mask(str(l.name)),
    color: color(l.color),
  }));
  const labelIds = new Set((raw.labels ?? []).map((l) => l.id));

  const lists: CleanList[] = (raw.lists ?? []).map((l) => ({
    id: hash("list", l.id),
    name: mask(str(l.name)).trim(),
    archived: l.closed === true,
    pos: num(l.pos),
  }));
  const listIds = new Set((raw.lists ?? []).map((l) => l.id));

  const cards: CleanCard[] = [];
  for (const c of (raw.cards ?? []) as RawCard[]) {
    if (typeof c.id !== "string" || !listIds.has(c.idList)) continue;
    if (EXCLUDED_CARD.test(str(c.name))) continue;
    const created = dateFromTrelloId(c.id);
    const attachments: CleanAttachment[] = [];
    for (const a of c.attachments ?? []) {
      if (typeof a.id !== "string") continue;
      const name = mask(str(a.name)).trim() || "•";
      const src = pickPreview(a);
      if (src) {
        const id = hash("img", a.id);
        images.set(id, src);
        attachments.push({ name, img: id });
      } else {
        attachments.push({ name });
      }
    }
    cards.push({
      id: hash("card", c.id),
      list: hash("list", c.idList),
      name: mask(str(c.name)).trim(),
      desc: mask(str(c.desc)),
      labels: (c.idLabels ?? []).filter((id) => labelIds.has(id)).map((id) => hash("label", id)),
      cover: color(c.cover?.color),
      checklist: checklistsByCard.get(c.id) ?? [],
      created: created.toISOString(),
      lastActivity: iso(c.dateLastActivity, created),
      due: typeof c.due === "string" ? iso(c.due, created) : null,
      start: typeof c.start === "string" ? iso(c.start, created) : null,
      archived: c.closed === true,
      pos: num(c.pos),
      attachments,
    });
  }
  return { snapshot: { v: 1, fetchedAt: now.toISOString(), labels, lists, cards }, images };
}
