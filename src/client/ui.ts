// DOM interface: counter, side panel, About / Controls dialogs, Flyover titles, touch buttons, toasts.
// Card content is always inserted as text (never HTML), so links in descriptions stay plain text.

import type { Species } from "../shared/types.ts";
import type { WorldItem } from "./forest.ts";
import { AUTHOR, EPIGRAPH, fmtDate, fmtInt, lang, t, THESIS_TITLE, THESIS_TITLE_EN } from "./i18n.ts";
import { cssHex, trelloColor } from "./palette.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const FRUIT_DOT: Record<string, number> = {
  apple: 0xe0503a,
  cherry: 0xc9283e,
  plum: 0x7a4fa0,
  pear: 0xc8d45a,
  lemon: 0xf7dc4a,
  fig: 0x8a5a8c,
  berries: 0x4b5fc2,
};

export class UI {
  onLang: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onSkip: (() => void) | null = null;
  onPanelClose: (() => void) | null = null;
  private toastTimer: number | undefined;
  current: WorldItem | null = null;

  constructor(private species: Species[]) {
    $("btn-lang").addEventListener("click", () => this.onLang?.());
    $("btn-mute").addEventListener("click", () => this.onMute?.());
    $("btn-about").addEventListener("click", () => this.openDialog("about"));
    $("btn-help").addEventListener("click", () => this.openDialog("help"));
    $("skip").addEventListener("click", () => this.onSkip?.());
    $("panel-close").addEventListener("click", () => this.closePanel());
    for (const d of document.querySelectorAll("dialog")) {
      d.querySelector("[data-close]")?.addEventListener("click", () => d.close());
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
    }
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) this.closePanel();
    });
  }

  loaded() {
    $("loading").classList.add("done");
    setTimeout(() => $("loading").remove(), 900);
  }

  loadingError() {
    $("loading-text").textContent = t().error;
  }

  setLoadingText() {
    $("loading-text").textContent = t().loading;
  }

  // ---- flyover ------------------------------------------------------------------------------------------

  showTitles(show: boolean) {
    $("flyover").hidden = false;
    $("thesis-title").textContent = THESIS_TITLE;
    $("author").textContent = AUTHOR;
    $("epigraph").textContent = EPIGRAPH.join("\n");
    $("skip").textContent = t().skip;
    document.querySelector(".title-card")!.classList.toggle("on", show);
  }

  endFlyover() {
    document.querySelector(".title-card")!.classList.remove("on");
    setTimeout(() => ($("flyover").hidden = true), 1200);
    $("skip").hidden = true;
    $("hud").hidden = false;
  }

  // ---- hud ----------------------------------------------------------------------------------------------

  refreshTexts(muted: boolean) {
    const s = t();
    $("btn-lang").textContent = s.lang;
    $("btn-lang").setAttribute("lang", lang() === "fr" ? "en" : "fr");
    $("btn-about").textContent = s.about;
    $("btn-help").title = s.help;
    $("btn-help").setAttribute("aria-label", s.help);
    this.setMuted(muted);
    $("skip").textContent = s.skip;
    $("t-inspect").textContent = s.inspect;
    $("panel-close").setAttribute("aria-label", s.close);
    for (const b of document.querySelectorAll("dialog [data-close]")) b.setAttribute("aria-label", s.close);
    this.renderAbout();
    this.renderHelp();
    if (this.current) this.renderPanel(this.current, false);
  }

  setMuted(m: boolean) {
    const b = $("btn-mute");
    b.textContent = m ? "🔇" : "🔊";
    b.setAttribute("aria-pressed", String(m));
    b.setAttribute("aria-label", m ? t().unmute : t().mute);
    b.title = m ? t().unmute : t().mute;
  }

  setCounter(found: number, total: number, peanuts: number, peanutsTotal: number) {
    const s = t();
    let text = s.found(fmtInt(found), fmtInt(total));
    if (peanutsTotal > 0) text += ` · ${s.peanuts(peanuts, peanutsTotal)}`;
    $("counter").textContent = text;
  }

  setStale(stale: boolean) {
    $("stale").hidden = !stale;
    $("stale").textContent = t().stale;
  }

  setPrompt(visible: boolean, touch: boolean) {
    $("prompt").hidden = !visible || touch;
    $("prompt").textContent = t().inspectKey;
    $("t-inspect").hidden = !visible || !touch;
  }

  toast(text: string, ms = 3200) {
    const e = $("toast");
    e.textContent = text;
    e.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (e.hidden = true), ms);
  }

  celebrate() {
    const c = $("celebrate");
    c.replaceChildren(el("p", "", t().complete));
    c.hidden = false;
    setTimeout(() => (c.hidden = true), 7000);
  }

  showTouch(on: boolean) {
    $("touch").hidden = !on;
  }

  // ---- panel --------------------------------------------------------------------------------------------

  openPanel(w: WorldItem, isNew: boolean) {
    this.current = w;
    this.renderPanel(w, isNew);
    $("panel").hidden = false;
    document.body.classList.add("panel-open");
    $("panel-body").scrollTop = 0;
  }

  closePanel() {
    if ($("panel").hidden) return;
    $("panel").hidden = true;
    document.body.classList.remove("panel-open");
    this.current = null;
    this.onPanelClose?.();
  }

  private renderPanel(w: WorldItem, isNew: boolean) {
    const s = t();
    const it = w.item;
    const body = $("panel-body");
    const parts: HTMLElement[] = [];
    const kicker = w.kind === "branch"
      ? `${s.week} ${fmtDate(w.week!)}`
      : `${s.greenhouse} · ${w.list}${w.sprout ? ` · ${s.inProgress}` : ""}`;
    const k = el("p", "kicker", kicker);
    if (isNew) k.append(el("span", "badge", s.newGrowth));
    parts.push(k, el("h2", "", it.name || "—"));
    if (it.desc.trim()) parts.push(el("p", "desc", it.desc.trim()));

    const images = it.attachments.filter((a) => a.img);
    for (const a of images) {
      const img = el("img");
      img.alt = a.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.src = a.img!;
      parts.push(img);
    }
    if (it.checklist.length) {
      parts.push(el("h3", "", s.checklist));
      const ul = el("ul");
      for (const c of it.checklist) {
        const li = el("li", c.done ? "done" : "todo");
        li.append(el("span", "mark", c.done ? "✓" : "○"), el("span", "", c.text));
        ul.append(li);
      }
      parts.push(ul);
    }
    if (it.labels.length) {
      parts.push(el("h3", "", s.labels));
      const box = el("div", "labels");
      for (const i of it.labels) {
        const sp = this.species[i];
        const tag = el("span", "label");
        const dot = el("span", "fruit");
        dot.style.background = cssHex(trelloColor(sp.color, FRUIT_DOT[sp.fruit]));
        dot.title = s.fruits[sp.fruit];
        tag.append(dot, document.createTextNode(`${sp.name || "·"} · ${s.fruits[sp.fruit]}`));
        box.append(tag);
      }
      parts.push(box);
    }
    const others = it.attachments.filter((a) => !a.img);
    if (others.length) {
      parts.push(el("h3", "", s.attachments));
      const ul = el("ul");
      for (const a of others) {
        const li = el("li");
        li.append(el("span", "mark", "📎"), el("span", "", a.name));
        ul.append(li);
      }
      parts.push(ul);
    }
    const dates = el("div", "dates");
    const line = (label: string, v: string) =>
      dates.append(el("div", "", `${label}${lang() === "fr" ? " : " : ": "}${v}`));
    line(s.created, fmtDate(it.created));
    line(s.activity, fmtDate(it.lastActivity));
    if (it.due) line(s.due, fmtDate(it.due));
    if (it.archived) dates.append(el("div", "", s.archived));
    parts.push(el("h3", "", s.dates), dates);
    body.replaceChildren(...parts);
  }

  // ---- dialogs ------------------------------------------------------------------------------------------

  private openDialog(id: string) {
    const d = $<HTMLDialogElement>(id);
    if (!d.open) d.showModal();
  }

  private renderAbout() {
    const s = t();
    const b = $("about-body");
    const title = el("p", "thesis", `« ${THESIS_TITLE} »`);
    const parts: HTMLElement[] = [el("h2", "", s.about), title];
    if (lang() === "en") parts.push(el("p", "small", THESIS_TITLE_EN));
    parts.push(el("p", "", `${AUTHOR}`));
    for (const p of s.aboutBody) parts.push(el("p", "", p));
    parts.push(el("h3", "", s.credits));
    for (const p of s.creditsBody) parts.push(el("p", "small", p));
    parts.push(el("p", "small", s.progressNote));
    b.replaceChildren(...parts);
  }

  private renderHelp() {
    const s = t();
    const b = $("help-body");
    const table = el("table");
    const rows = document.body.classList.contains("touch") ? s.controlsTouch : s.controlsDesktop;
    for (const [k, v] of rows) {
      const tr = el("tr");
      tr.append(el("td", "", k), el("td", "", v));
      table.append(tr);
    }
    b.replaceChildren(el("h2", "", s.help), table);
  }
}
