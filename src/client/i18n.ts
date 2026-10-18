// FR / EN interface strings. Card content always stays as written.

export type Lang = "fr" | "en";

export const THESIS_TITLE =
  "Détection automatique des émotions dans le discours de patients atteints de cérébrolésions acquises";
export const AUTHOR = "Salomé Klein";
/** Verbatim, same in FR and EN (BRIEF §4). */
export const EPIGRAPH = [
  "« And remember that bad times...",
  "are just times that are bad. »",
  "Astrid la voyante",
  "Animal Crossing : New Leaf",
  "(2013)",
];

const STRINGS = {
  fr: {
    found: (n: string, t: string) => `${n} / ${t} trouvés`,
    peanuts: (n: number, t: number) => `${n} / ${t} cacahuètes`,
    skip: "Passer",
    inspect: "Inspecter",
    inspectKey: "E — inspecter",
    close: "Fermer",
    about: "À propos",
    help: "Commandes",
    mute: "Couper le son",
    unmute: "Activer le son",
    lang: "English",
    loading: "Le jardin pousse…",
    error: "Le jardin n'a pas pu être chargé. Réessayez dans un instant.",
    stale: "Jardin d'hier : Trello ne répond pas, voici la dernière récolte.",
    week: "Semaine du",
    dates: "Dates",
    created: "Créée le",
    activity: "Dernière activité",
    due: "Échéance",
    archived: "Archivée",
    checklist: "Liste",
    labels: "Étiquettes",
    attachments: "Pièces jointes",
    greenhouse: "Serre",
    inProgress: "En cours",
    newGrowth: "Nouvelle pousse",
    peanut: "Cacahuète dorée ! Le pigeon se sent plus vif.",
    complete: "Tout est trouvé. Merci d'avoir parcouru ce travail.",
    fruits: {
      apple: "pomme",
      cherry: "cerise",
      plum: "prune",
      pear: "poire",
      lemon: "citron",
      fig: "figue",
      berries: "baies",
    },
    controlsDesktop: [
      ["ZQSD / WASD / flèches", "marcher, voler"],
      ["Espace", "s'envoler, battre des ailes, sauter de branche en branche"],
      ["Maj", "descendre, se poser"],
      ["E / Entrée", "inspecter"],
      ["Souris (glisser)", "tourner la caméra"],
      ["Échap", "fermer le panneau"],
    ],
    controlsTouch: [
      ["Joystick", "marcher, voler"],
      ["▲", "s'envoler, sauter de branche en branche"],
      ["▼", "descendre, se poser"],
      ["Glisser", "tourner la caméra"],
    ],
    aboutBody: [
      "Ce jardin a poussé à partir du tableau Trello sur lequel Salomé Klein a tenu le travail de sa thèse.",
      "Chaque arbre est une semaine de travail terminé ; chaque branche, une carte ; chaque fruit, une étiquette. Le chemin suit le temps, de 2023 à 2026. Dans la serre poussent les travaux encore en cours.",
      "Vous êtes un pigeon. Posez-vous, lisez, et laissez-vous surprendre par les cacahuètes dorées.",
    ],
    credits: "Crédits",
    creditsBody: [
      "Moteur 3D : three.js (licence MIT).",
      "Modèles, musique et effets sonores : créés en code pour ce projet, dédiés au domaine public (CC0).",
      "Polices : celles de votre appareil.",
      "Un cadeau d'Alexandre.",
    ],
    progressNote: "Votre progression est gardée dans ce navigateur uniquement.",
  },
  en: {
    found: (n: string, t: string) => `${n} / ${t} found`,
    peanuts: (n: number, t: number) => `${n} / ${t} peanuts`,
    skip: "Skip",
    inspect: "Inspect",
    inspectKey: "E — inspect",
    close: "Close",
    about: "About",
    help: "Controls",
    mute: "Mute",
    unmute: "Unmute",
    lang: "Français",
    loading: "The garden is growing…",
    error: "The garden could not be loaded. Please try again in a moment.",
    stale: "Yesterday's garden: Trello is not answering, here is the last harvest.",
    week: "Week of",
    dates: "Dates",
    created: "Created",
    activity: "Last activity",
    due: "Due",
    archived: "Archived",
    checklist: "Checklist",
    labels: "Labels",
    attachments: "Attachments",
    greenhouse: "Greenhouse",
    inProgress: "In progress",
    newGrowth: "New growth",
    peanut: "Golden peanut! The pigeon feels livelier.",
    complete: "Everything is found. Thank you for walking through this work.",
    fruits: {
      apple: "apple",
      cherry: "cherry",
      plum: "plum",
      pear: "pear",
      lemon: "lemon",
      fig: "fig",
      berries: "berries",
    },
    controlsDesktop: [
      ["WASD / ZQSD / arrows", "walk, fly"],
      ["Space", "take off, flap, hop from branch to branch"],
      ["Shift", "descend, land"],
      ["E / Enter", "inspect"],
      ["Mouse (drag)", "turn the camera"],
      ["Esc", "close the panel"],
    ],
    controlsTouch: [
      ["Joystick", "walk, fly"],
      ["▲", "take off, hop from branch to branch"],
      ["▼", "descend, land"],
      ["Drag", "turn the camera"],
    ],
    aboutBody: [
      "This garden grew from the Trello board on which Salomé Klein kept the work of her PhD.",
      "Each tree is a week of finished work; each branch, a card; each fruit, a label. The path follows time, from 2023 to 2026. In the greenhouse grows the work still in progress.",
      "You are a pigeon. Land, read, and let the golden peanuts surprise you.",
    ],
    credits: "Credits",
    creditsBody: [
      "3D engine: three.js (MIT licence).",
      "Models, music and sound effects: made in code for this project, dedicated to the public domain (CC0).",
      "Fonts: your device's own.",
      "A gift from Alexandre.",
    ],
    progressNote: "Your progress is kept in this browser only.",
  },
};

export type Strings = typeof STRINGS.fr;

export const THESIS_TITLE_EN =
  "Automatic detection of emotions in the speech of patients with acquired brain injury";

let current: Lang = "fr";
export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l;
}
export function lang(): Lang {
  return current;
}
export function t(): Strings {
  return STRINGS[current] as Strings;
}
export function defaultLang(stored: string | null): Lang {
  if (stored === "fr" || stored === "en") return stored;
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "fr").toLowerCase();
  return nav.startsWith("fr") ? "fr" : "en";
}
export function fmtInt(n: number): string {
  return new Intl.NumberFormat(current === "fr" ? "fr-FR" : "en-GB").format(n);
}
export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat(current === "fr" ? "fr-FR" : "en-GB", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(iso));
}
