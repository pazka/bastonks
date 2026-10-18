// Progress saved in the browser (localStorage): Found ids, the ids seen last visit, preferences.
// Every access is guarded: private windows and blocked storage simply mean no memory.

const KEY = "bastonks.v1";

export interface Saved {
  found: string[];
  /** Mouse look: invert the horizontal / vertical axis (relative to the default feel). */
  invertX: boolean;
  invertY: boolean;
  seen: string[];
  visits: number;
  muted: boolean;
  lang: string | null;
  complete: boolean;
}

const EMPTY: Saved = {
  found: [],
  invertX: false,
  invertY: false,
  seen: [],
  visits: 0,
  muted: false,
  lang: null,
  complete: false,
};

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const v = JSON.parse(raw);
    const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === "string") : []);
    return {
      found: arr(v.found),
      invertX: v.invertX === true,
      invertY: v.invertY === true,
      seen: arr(v.seen),
      visits: Number.isInteger(v.visits) ? v.visits : 0,
      muted: v.muted === true,
      lang: typeof v.lang === "string" ? v.lang : null,
      complete: v.complete === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

export class Progress {
  readonly found: Set<string>;
  invertX: boolean;
  invertY: boolean;
  /** Ids present at the previous visit (empty on a first visit). */
  readonly seenBefore: Set<string>;
  readonly visits: number;
  muted: boolean;
  lang: string | null;
  complete: boolean;
  private timer: number | undefined;

  constructor() {
    const s = read();
    this.found = new Set(s.found);
    this.invertX = s.invertX;
    this.invertY = s.invertY;
    this.seenBefore = new Set(s.seen);
    this.visits = s.visits;
    this.muted = s.muted;
    this.lang = s.lang;
    this.complete = s.complete;
  }

  /** Records this visit: everything present now is "seen" for the next visit. */
  startVisit(allIds: string[]) {
    this.save({ seen: allIds, visits: this.visits + 1 });
  }

  save(extra: Partial<Saved> = {}) {
    clearTimeout(this.timer);
    const write = () => {
      try {
        const prev = read();
        const v: Saved = {
          ...prev,
          found: [...this.found],
          invertX: this.invertX,
          invertY: this.invertY,
          muted: this.muted,
          lang: this.lang,
          complete: this.complete,
          ...extra,
        };
        localStorage.setItem(KEY, JSON.stringify(v));
      } catch { /* storage unavailable: progress lives for this visit only */ }
    };
    if (Object.keys(extra).length) write();
    else this.timer = setTimeout(write, 300);
  }
}
