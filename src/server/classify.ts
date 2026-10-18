// From board to world (BRIEF §3): Done lists and cards, Trees and their Branches, Seed Pots, Weeks, Fruits.

import type { CleanCard, CleanList, CleanSnapshot } from "./clean.ts";
import type { Fruit, Item, SeedPot, Species, Tree, World } from "../shared/types.ts";
import { nameSaysDone, resolveWeek, seasonOf } from "./week.ts";

export const FRUITS: readonly Fruit[] = ["apple", "cherry", "plum", "pear", "lemon", "fig", "berries"];

/** A Done list: its name holds a date or DONE, or it is archived. */
export function isDoneList(l: CleanList): boolean {
  return l.archived || nameSaysDone(l.name);
}

/** The open list whose cards are in progress: Seed Pots with a sprout. */
export function isInProgressList(l: CleanList): boolean {
  const n = l.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  return /^en[\s-]*cours\b/.test(n);
}

function toItem(c: CleanCard, labelIndex: Map<string, number>): Item {
  return {
    id: c.id,
    name: c.name,
    desc: c.desc,
    labels: c.labels.map((l) => labelIndex.get(l)).filter((i): i is number => i !== undefined),
    cover: c.cover,
    checklist: c.checklist,
    created: c.created,
    lastActivity: c.lastActivity,
    due: c.due,
    archived: c.archived,
    attachments: c.attachments.map((
      a,
    ) => (a.img ? { name: a.name, img: `/img/${a.img}` } : { name: a.name })),
  };
}

export function buildWorld(snap: CleanSnapshot, stale: boolean): World {
  const species: Species[] = snap.labels.map((l, i) => ({
    name: l.name,
    color: l.color,
    fruit: FRUITS[i % FRUITS.length],
  }));
  const labelIndex = new Map(snap.labels.map((l, i) => [l.id, i]));

  const cardsByList = new Map<string, CleanCard[]>();
  for (const c of snap.cards) {
    const arr = cardsByList.get(c.list) ?? [];
    arr.push(c);
    cardsByList.set(c.list, arr);
  }

  const trees: (Tree & { pos: number })[] = [];
  const pots: SeedPot[] = [];
  for (const list of snap.lists) {
    const cards = (cardsByList.get(list.id) ?? []).sort((a, b) => a.pos - b.pos);
    if (cards.length === 0) continue; // empty lists produce nothing
    const listDone = isDoneList(list);
    const done = cards.filter((c) => listDone || c.archived);
    if (done.length > 0) {
      const { week, from } = resolveWeek(
        list.name,
        done.map((c) => ({ created: new Date(c.created), lastActivity: new Date(c.lastActivity) })),
      );
      trees.push({
        id: list.id,
        name: list.name,
        week,
        weekFrom: from,
        season: seasonOf(week),
        archived: list.archived,
        branches: done.map((c) => toItem(c, labelIndex)),
        pos: list.pos,
      });
    }
    if (!listDone) {
      const sprout = isInProgressList(list);
      for (const c of cards) {
        if (c.archived) continue;
        pots.push({ ...toItem(c, labelIndex), list: list.name, sprout });
      }
    }
  }
  trees.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : a.pos - b.pos));

  const branches = trees.reduce((n, t) => n + t.branches.length, 0);
  return {
    snapshotAt: snap.fetchedAt,
    stale,
    species,
    trees: trees.map(({ pos: _pos, ...t }) => t),
    pots,
    counts: { trees: trees.length, branches, pots: pots.length },
  };
}
