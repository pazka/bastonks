// A deterministic, entirely fictional board with the shape of the real one (export of 2026-10-18):
// ~165 weekly `DONE dd/mm/yyyy` lists 2023-01 → 2026-04 (most archived), open Backlog / To do / En cours,
// 7 labels, 34 checklists, a few covers and attachments, Trello tip cards, an empty list, hand-typed
// dates, and seeded personal data that the privacy pipeline must remove. Shaped like the Trello REST
// board response, including fields the allowlist must drop (members, actions, urls, shortLinks…).

import type {
  RawAttachment,
  RawBoard,
  RawCard,
  RawChecklist,
  RawLabel,
  RawList,
} from "../../src/server/trello.ts";

/** A few milestone cards with fixed ids (stable fixtures), one in each year of the work. */
const MILESTONE_IDS = [
  "63c0a1f0aaaaaaaaaaaa0001",
  "6420b2e0aaaaaaaaaaaa0002",
  "64f3c4d0aaaaaaaaaaaa0003",
  "65a0d5c0aaaaaaaaaaaa0004",
  "6620e6b0aaaaaaaaaaaa0005",
  "66f0f7a0aaaaaaaaaaaa0006",
];

export const FAKE_BOARD_ID = "5f0b0a0d0e0a0d0b0e0e0f00";

/** Strings seeded into the board that must never reach the world JSON. */
export const SEEDED_SECRETS = [
  "salome.k@example.org",
  "jury.these@univ-exemple.fr",
  "06 12 34 56 78",
  "+33 6 98 76 54 32",
  "patient 12",
  "Patient n°7",
  "047_B",
  "112_AB",
  "https://trello.com/c/AbCdEf12/42-carte",
  FAKE_BOARD_ID,
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const ddmmyyyy = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

const TITLES = [
  "Relire le chapitre 2",
  "Annoter le corpus",
  "Réunion avec Marie",
  "Écrire l'état de l'art",
  "Script d'extraction des pauses",
  "Lire Scherer 2005",
  "Préparer la présentation du labo",
  "Corriger la bibliographie",
  "Entraîner le modèle prosodique",
  "Mail à Thomas pour le comité",
  "Tableau des émotions par patient",
  "Mettre à jour le plan de thèse",
  "Analyse statistique des valences",
  "Formulaire éthique",
  "Figures du chapitre 4",
  "Transcrire les entretiens",
  "Comparer les annotateurs (kappa)",
  "Séminaire doctoral",
  "Rédiger la discussion",
  "Nettoyer les fichiers audio",
  "Relecture par Julie",
  "Inscription en 3e année",
  "Poster pour le colloque",
  "Lire sur l'alexithymie",
  "Réécrire l'introduction",
  "Évaluer le classifieur",
  "Choisir les features acoustiques",
  "Café avec Léa",
];

const DESCS = [
  "Penser à vérifier les annotations doubles.\nVoir aussi https://example.org/article.pdf",
  "Notes de la réunion :\n- revoir les catégories\n- refaire les figures en couleur\n- envoyer à Anne",
  "Contacter le secrétariat au 06 12 34 56 78 ou salome.k@example.org pour la salle.",
  "Corpus : patient 12 et Patient n°7, transcriptions 047_B et 112_AB à revérifier.",
  "Lien vers l'ancienne carte : https://trello.com/c/AbCdEf12/42-carte (à fusionner)",
  "Envoyer le PDF à jury.these@univ-exemple.fr avant vendredi. Tel. +33 6 98 76 54 32",
  "Le modèle atteint 0.71 de F1 sur la valence. Encore du travail sur l'arousal.",
  "Chapitre long, découpé en trois parties. ".repeat(40),
];

const LABELS: RawLabel[] = [
  { id: "63a0000000000000000a0001", name: "Rédaction", color: "green", idBoard: FAKE_BOARD_ID },
  { id: "63a0000000000000000a0002", name: "Lecture", color: "blue", idBoard: FAKE_BOARD_ID },
  { id: "63a0000000000000000a0003", name: "Analyse", color: "orange", idBoard: FAKE_BOARD_ID },
  { id: "63a0000000000000000a0004", name: "Réunion", color: "purple", idBoard: FAKE_BOARD_ID },
  { id: "63a0000000000000000a0005", name: "Code", color: "sky", idBoard: FAKE_BOARD_ID },
  { id: "63a0000000000000000a0006", name: "Admin", color: "yellow_light", idBoard: FAKE_BOARD_ID },
  { id: "63a0000000000000000a0007", name: "Important", color: "red", idBoard: FAKE_BOARD_ID },
];

/** Builds the board. Same output on every call. */
export function syntheticBoard(): RawBoard {
  const r = rng(20231106);
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  let counter = 0;
  const idAt = (t: number) =>
    Math.floor(t / 1000).toString(16).padStart(8, "0") + (++counter).toString(16).padStart(16, "0");

  const lists: RawList[] = [];
  const cards: RawCard[] = [];
  const checklists: RawChecklist[] = [];
  let pos = 16384;

  const addList = (name: string, closed: boolean, createdAt: number): RawList => {
    const l: RawList = {
      id: idAt(createdAt),
      name,
      closed,
      pos: pos += 16384,
      idBoard: FAKE_BOARD_ID,
      subscribed: false,
    };
    lists.push(l);
    return l;
  };

  const addCard = (
    list: RawList,
    created: number,
    activity: number,
    opts: Partial<RawCard> = {},
  ): RawCard => {
    const id = (opts.id as string | undefined) ?? idAt(created);
    const nLabels = r() < 0.67 ? 1 + Math.floor(r() * 2.2) : 0;
    const idLabels = [...new Set(Array.from({ length: nLabels }, () => pick(LABELS).id))];
    const c: RawCard = {
      id,
      name: pick(TITLES),
      desc: "",
      closed: false,
      idList: list.id,
      idBoard: FAKE_BOARD_ID,
      idLabels,
      pos: pos += 1024,
      dateLastActivity: new Date(activity).toISOString(),
      due: null,
      cover: { color: null, idAttachment: null, size: "normal", brightness: "dark" },
      // fields the allowlist must drop
      url: `https://trello.com/c/${id.slice(-8)}/1-carte`,
      shortUrl: `https://trello.com/c/${id.slice(-8)}`,
      shortLink: id.slice(-8),
      idMembers: ["5a0000000000000000000001"],
      badges: { comments: 1 },
      customFieldItems: [{ value: { text: "secret custom field" } }],
      pluginData: [{ value: "plugin secret" }],
      ...opts,
    };
    cards.push(c);
    return c;
  };

  // Weekly Done lists: Fridays from 2023-01-06 to 2026-04, with a few holiday gaps.
  const weeks: number[] = [];
  for (let t = Date.UTC(2023, 0, 6); t <= Date.UTC(2026, 3, 24); t += 7 * DAY) {
    const d = new Date(t);
    const holiday = (d.getUTCMonth() === 7 && d.getUTCDate() > 7 && d.getUTCDate() < 22) ||
      (d.getUTCMonth() === 11 && d.getUTCDate() > 23);
    if (!holiday) weeks.push(t);
  }
  const weird = new Map<number, string>([
    [Date.UTC(2023, 10, 24), "DONE 20/11/023"], // typo in year, date 4 days before the Friday
    [Date.UTC(2024, 1, 23), "19/02/24"], // no DONE, short year
    [Date.UTC(2025, 7, 22), "DONE 18/08//2025"],
    [Date.UTC(2025, 9, 10), "DONE 6/10/2025"],
    [Date.UTC(2025, 10, 7), "3/11/2025"],
    [Date.UTC(2024, 4, 17), "DONE 13/05/2023"], // wrong year: cards are from May 2024
  ]);
  const exceptionalIds = [...MILESTONE_IDS];

  for (let wi = 0; wi < weeks.length; wi++) {
    const friday = weeks[wi];
    const name = weird.get(friday) ?? `DONE ${ddmmyyyy(new Date(friday))}`;
    const archived = wi < weeks.length - 4;
    const list = addList(name, archived, friday - 2 * DAY);
    const n = 8 + Math.floor(r() * 10);
    for (let k = 0; k < n; k++) {
      const created = friday - Math.floor((2 + r() * 18) * DAY);
      const activity = friday + Math.floor(r() * 3 * DAY);
      addCard(list, created, activity, { closed: r() < 0.08 });
    }
    // Milestones land in the week that matches their id timestamp.
    for (let e = exceptionalIds.length - 1; e >= 0; e--) {
      const t = parseInt(exceptionalIds[e].slice(0, 8), 16) * 1000;
      if (t <= friday && t > friday - 7 * DAY) {
        addCard(list, t, friday, { id: exceptionalIds[e], name: "Jalon : soutenance blanche" });
        exceptionalIds.splice(e, 1);
      }
    }
  }
  for (const id of exceptionalIds) {
    // any placeholder that fell into a holiday gap goes into the following week
    const t = parseInt(id.slice(0, 8), 16) * 1000;
    const list = lists[Math.max(0, weeks.findIndex((w) => w >= t))];
    addCard(list, t, t + 3 * DAY, { id, name: "Jalon : chapitre terminé" });
  }

  // Open lists of unfinished work, with archived (done) cards and Trello tip cards.
  const now = Date.UTC(2026, 9, 10);
  const backlog = addList("Backlog", false, Date.UTC(2023, 0, 2));
  for (let k = 0; k < 3; k++) {
    addCard(backlog, Date.UTC(2023, 0, 2), Date.UTC(2023, 0, 2), { name: `Astuce Trello : ${pick(TITLES)}` });
  }
  for (let k = 0; k < 40; k++) {
    const created = Date.UTC(2023, 0, 2) + Math.floor(r() * 1200) * DAY;
    addCard(backlog, created, Math.min(now, created + 30 * DAY), { closed: k < 10 });
  }
  const todo = addList("To do", false, Date.UTC(2023, 0, 2));
  for (let k = 0; k < 15; k++) {
    const created = Date.UTC(2025, 0, 2) + Math.floor(r() * 400) * DAY;
    addCard(todo, created, Math.min(now, created + 10 * DAY), { closed: k < 5 });
  }
  const inProgress = addList("En cours", false, Date.UTC(2023, 0, 2));
  for (let k = 0; k < 6; k++) addCard(inProgress, now - 20 * DAY, now - 2 * DAY);
  addList("Idées", false, Date.UTC(2023, 0, 3)); // empty: produces nothing
  const old = addList("Vieux trucs", true, Date.UTC(2023, 2, 1)); // archived, no date: a Done list
  for (let k = 0; k < 12; k++) addCard(old, Date.UTC(2023, 1, 1) + k * DAY, Date.UTC(2023, 3, 1));

  // Content details on a deterministic subset of cards.
  const done = cards.filter((c) => !/^Astuce/.test(c.name ?? ""));
  for (let i = 0; i < 74; i++) done[(i * 29) % done.length].desc = DESCS[i % DESCS.length];
  done[5].name = "Envoyer le corpus du patient 12 à salome.k@example.org";
  done[6].name = "Transcrire 047_B";
  const coverColors = ["green", "yellow", "orange", "red", "purple", "blue", "sky", "lime", "pink", "black"];
  for (let i = 0; i < 15; i++) done[(i * 137 + 11) % done.length].cover = { color: coverColors[i % 10] };
  for (let i = 0; i < 34; i++) {
    const card = done[(i * 61 + 3) % done.length];
    const n = 3 + (i % 9);
    checklists.push({
      id: idAt(Date.parse(card.dateLastActivity as string)),
      idCard: card.id,
      idBoard: FAKE_BOARD_ID,
      name: "Checklist",
      pos: 16384,
      checkItems: Array.from({ length: n }, (_, k) => ({
        id: `c${i}-${k}`,
        name: k === 1 && i % 7 === 0
          ? "Appeler le 06 12 34 56 78"
          : `Étape ${k + 1} : ${pick(TITLES).toLowerCase()}`,
        state: r() < 0.8 ? "complete" : "incomplete",
        pos: (k + 1) * 16384,
      })),
    });
  }
  const attachmentCards = [done[40], done[400], done[900], done[1500], done[1800], done[2000 % done.length]];
  attachmentCards.forEach((card, i) => {
    const image = i < 4;
    const att: RawAttachment = {
      id: idAt(Date.parse(card.dateLastActivity as string)),
      name: image
        ? `figure-${i + 1}${i === 2 ? "-047_B" : ""}.png`
        : i === 4
        ? "manuscrit-v3.pdf"
        : "notes.docx",
      mimeType: image ? "image/png" : i === 4 ? "application/pdf" : "application/msword",
      isUpload: true,
      bytes: 123456,
      url: `https://trello.com/1/cards/${card.id}/attachments/a${i}/download/file`,
      previews: image
        ? [150, 600, 1200, 2048].map((w, k) => ({
          id: `p${i}${k}`,
          url:
            `https://trello.com/1/cards/${card.id}/attachments/a${i}/previews/p${i}${k}/download/figure.png`,
          width: w,
          height: Math.round(w * 0.75),
          bytes: w * 20,
          scaled: true,
        }))
        : [],
    };
    card.attachments = [att];
  });

  return {
    id: FAKE_BOARD_ID,
    name: "bastonks",
    url: `https://trello.com/b/${FAKE_BOARD_ID}/bastonks`,
    members: [{ id: "5a0000000000000000000001", fullName: "Salomé Klein", username: "salome" }],
    actions: [{ type: "commentCard", data: { text: "a comment, never shown" } }],
    labels: LABELS,
    lists,
    cards,
    checklists,
  };
}
