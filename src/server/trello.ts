// The only module that talks to Trello. One board call per visit (nested lists, cards with attachments,
// checklists and labels — Trello REST "nested resources"), with the credentials in the Authorization
// header so they never appear in a URL. Errors are reduced to a kind: no URL, id or token is ever logged.

export interface RawPreview {
  url?: string;
  width?: number;
  height?: number;
  bytes?: number;
}
export interface RawAttachment {
  id: string;
  name?: string;
  mimeType?: string | null;
  isUpload?: boolean;
  url?: string;
  bytes?: number | null;
  previews?: RawPreview[];
}
export interface RawCard {
  id: string;
  name?: string;
  desc?: string;
  closed?: boolean;
  idList: string;
  idLabels?: string[];
  pos?: number;
  dateLastActivity?: string;
  due?: string | null;
  cover?: { color?: string | null; [k: string]: unknown } | null;
  attachments?: RawAttachment[];
  // anything else Trello sends is ignored by the allowlist in clean.ts
  [k: string]: unknown;
}
export interface RawList {
  id: string;
  name?: string;
  closed?: boolean;
  pos?: number;
  [k: string]: unknown;
}
export interface RawLabel {
  id: string;
  name?: string;
  color?: string | null;
  [k: string]: unknown;
}
export interface RawCheckItem {
  id?: string;
  name?: string;
  state?: string;
  pos?: number;
}
export interface RawChecklist {
  id: string;
  idCard: string;
  pos?: number;
  checkItems?: RawCheckItem[];
  [k: string]: unknown;
}
export interface RawBoard {
  lists?: RawList[];
  cards?: RawCard[];
  labels?: RawLabel[];
  checklists?: RawChecklist[];
  [k: string]: unknown;
}

export interface TrelloCreds {
  key: string;
  token: string;
  boardId: string;
}

export type FetchOutcome = "ok" | "timeout" | "error";

/** A Trello failure, reduced to something safe to log and report. */
export class TrelloError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "http" | "invalid" | "config",
    readonly status?: number,
  ) {
    super(status ? `trello ${kind} ${status}` : `trello ${kind}`);
  }
}

export const TRELLO_API = "https://api.trello.com/1";

/** Hosts the app may fetch from (also the compiled --allow-net list, see deno.json task "compile"). */
export const TRELLO_HOSTS = ["api.trello.com", "trello.com", "trello-attachments.s3.amazonaws.com"];

export function authHeader(c: TrelloCreds): string {
  return `OAuth oauth_consumer_key="${c.key}", oauth_token="${c.token}"`;
}

/** Query string of the single board call. Archived lists and cards are part of the work: `all`. */
export function boardQuery(): string {
  const q = new URLSearchParams({
    fields: "id",
    lists: "all",
    list_fields: "name,closed,pos",
    labels: "all",
    label_fields: "name,color",
    labels_limit: "1000",
    cards: "all",
    card_fields: "name,desc,closed,idList,idLabels,pos,dateLastActivity,due,cover",
    card_attachments: "true",
    card_attachment_fields: "name,mimeType,isUpload,url,bytes,previews",
    checklists: "all",
    checklist_fields: "idCard,pos",
    checkItem_fields: "name,state,pos",
  });
  return q.toString();
}

/** Fetches the board. Throws TrelloError only. */
export async function fetchBoard(c: TrelloCreds, signal: AbortSignal): Promise<RawBoard> {
  if (!c.key || !c.token || !c.boardId) throw new TrelloError("config");
  if (!/^[A-Za-z0-9]{8,32}$/.test(c.boardId)) throw new TrelloError("config");
  let res: Response;
  try {
    res = await fetch(`${TRELLO_API}/boards/${c.boardId}?${boardQuery()}`, {
      headers: { Authorization: authHeader(c), Accept: "application/json" },
      signal,
      redirect: "error",
    });
  } catch (_e) {
    throw new TrelloError(signal.aborted ? "timeout" : "network");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new TrelloError("http", res.status);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (_e) {
    throw new TrelloError(signal.aborted ? "timeout" : "invalid");
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as RawBoard).cards)) {
    throw new TrelloError("invalid");
  }
  return body as RawBoard;
}

/** Downloads an attachment preview with the credentials; follows redirects only to Trello's own hosts. */
export async function fetchImage(
  c: TrelloCreds,
  url: string,
  signal: AbortSignal,
  maxBytes = 4_000_000,
): Promise<Uint8Array<ArrayBuffer>> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:" || !TRELLO_HOSTS.includes(u.hostname)) throw new TrelloError("invalid");
    // Credentials only go to Trello itself, never to the storage host it may redirect to.
    const headers: HeadersInit = u.hostname.endsWith("trello.com") ? { Authorization: authHeader(c) } : {};
    let res: Response;
    try {
      res = await fetch(u, { headers, signal, redirect: "manual" });
    } catch (_e) {
      throw new TrelloError(signal.aborted ? "timeout" : "network");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new TrelloError("http", res.status);
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new TrelloError("http", res.status);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new TrelloError("invalid");
    return buf;
  }
  throw new TrelloError("http", 310);
}
