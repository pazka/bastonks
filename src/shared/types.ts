// Shapes shared by the server and the browser. Nothing here may carry a Trello URL or the board id.

/** One checklist line of a card. */
export interface CheckItem {
  text: string;
  done: boolean;
}

/** An attachment as shown to the visitor: its (masked) name, and an app-served image URL for images. */
export interface Attachment {
  name: string;
  /** `/img/<opaque-id>` for image attachments, absent for everything else (name only). */
  img?: string;
}

/** A card, cleaned and masked: the content of a Branch or a Seed Pot. */
export interface Item {
  /** Opaque id (salted hash of the Trello id), stable for a given /data volume. */
  id: string;
  name: string;
  desc: string;
  /** Indexes into `World.species`. */
  labels: number[];
  /** Trello cover colour name (e.g. "green", "sky"), or null. */
  cover: string | null;
  checklist: CheckItem[];
  /** ISO dates. */
  created: string;
  lastActivity: string;
  due: string | null;
  archived: boolean;
  attachments: Attachment[];
}

export type Season = "spring" | "summer" | "autumn" | "winter";

export interface Tree {
  id: string;
  /** Masked list name. */
  name: string;
  /** Monday of the Tree's Week, `YYYY-MM-DD`. */
  week: string;
  /** Where the Week came from: the list name, or the cards' dates. */
  weekFrom: "name" | "cards";
  season: Season;
  archived: boolean;
  branches: Item[];
}

export interface SeedPot extends Item {
  /** Masked name of the open list it comes from. */
  list: string;
  /** Card of the « En cours » list: drawn with a visible sprout. */
  sprout: boolean;
}

export interface Species {
  /** Label name, masked (may be empty). */
  name: string;
  /** Trello label colour name or null. */
  color: string | null;
  /** Fruit species drawn for this label. */
  fruit: Fruit;
}

export type Fruit = "apple" | "cherry" | "plum" | "pear" | "lemon" | "fig" | "berries";

export interface World {
  /** When the served content was fetched from Trello and last changed (ISO). */
  snapshotAt: string;
  /** True when the visit's fetch failed or timed out and an older snapshot is served. */
  stale: boolean;
  species: Species[];
  /** Done Trees, in Week order (the Path). */
  trees: Tree[];
  /** Seed Pots of the Greenhouse. */
  pots: SeedPot[];
  counts: { trees: number; branches: number; pots: number };
}
