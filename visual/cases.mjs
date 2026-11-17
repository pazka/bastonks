// Visual use cases covered by the harness (ids from TESTING.md "Visual use cases").
// Each: { id, mask?, steps(page) }. Every case starts on "/" in a fresh browser context (no saved progress)
// and the steps bring the page to the state to shoot, through the page's own buttons and its test hook
// (`globalThis.__bastonks`, the one e2e/garden_test.ts drives).
// The 3D garden (#scene) is NOT compared: software WebGL with a running clock is not reproducible pixel for
// pixel. It is hidden before every shot, so the cases compare the interface drawn over it (loading screen,
// titles, HUD, panel, dialogs, touch buttons). The e2e test proves the garden itself renders and plays.
// - mask: CSS selectors made invisible before the shot (layout kept): content that depends on the clock
//   or on timers. Listed in TESTING.md next to the case.
export const WIDTHS = [1400, 1024, 390];

const H = "globalThis.__bastonks";
// timers and banners that come and go on their own (stale banner 5 s, fullscreen offer 12 s, toasts,
// celebration), and the prompt that depends on where the pigeon stands
const MOVING = ["#stale", "#fs-offer", "#toast", "#celebrate", "#prompt", ".leaf"];

async function must(p, expr, what, ms = 60000) {
  if (!(await p.waitFor(expr, ms))) throw new Error(`timed out waiting for ${what}`);
}
const ready = (p) => must(p, `${H} && (${H}.ready || ${H}.error !== undefined)`, "the world to load", 120000);
async function enter(p) {
  await ready(p);
  await must(p, `!document.querySelector("#enter").hidden`, "the enter button");
  await p.evaluate(`document.querySelector("#enter").click(); true`);
  await must(p, `${H}.entered === true`, "entering");
}
async function garden(p) {
  await enter(p);
  await must(p, `!!document.querySelector(".title-card.on")`, "the titles");
  await p.evaluate(`document.querySelector("#skip").click(); true`);
  await must(p, `${H}.flyoverDone === true && !document.querySelector("#hud").hidden`, "the end of the flyover");
  // the title card leaves after 1.2 s, the loading screen after 2.6 s
  await must(p, `document.querySelector("#flyover").hidden && !document.querySelector("#loading")`, "the intro to clear", 10000);
}
async function dialog(p, button, id) {
  await p.evaluate(`document.querySelector("${button}").click(); true`);
  await must(p, `document.querySelector("${id}").open`, `${id} to open`, 5000);
}

export const CASES = [
  // L1: the world is built, one large button invites in (French visitor)
  {
    id: "L1-enter",
    mask: MOVING,
    steps: async (p) => {
      await ready(p);
      await must(p, `!document.querySelector("#enter").hidden`, "the enter button");
    },
  },
  // L2: the world cannot be loaded (/api/world answers 503): the loading screen says so
  {
    id: "L2-load-error",
    mask: MOVING,
    failWorld: true,
    steps: async (p) => {
      await must(p, `${H} && ${H}.error !== undefined`, "the load error", 60000);
    },
  },
  // T1: the flyover titles (thesis title, byline, skip button)
  {
    id: "T1-titles",
    mask: MOVING,
    steps: async (p) => {
      await enter(p);
      await must(p, `!!document.querySelector(".title-card.on")`, "the titles");
      // the loading screen lifts away by an animation (frozen by the harness) and is removed after 2.6 s
      await must(p, `!document.querySelector("#loading")`, "the loading screen to leave", 10000);
    },
  },
  // G1: the garden after the intro: counter, HUD buttons (and touch controls on the phone)
  { id: "G1-garden", mask: MOVING, steps: garden },
  // G2: a Seed Pot of the Greenhouse opens its card in the side panel (walking by it, as a visitor would)
  {
    id: "G2-panel",
    mask: MOVING,
    steps: async (p) => {
      await garden(p);
      await p.evaluate(`${H}.teleport(0, "pot"); true`);
      await must(p, `${H}.state().panelOpen === true`, "the panel to open", 30000);
      await must(p, `[...document.querySelectorAll("#panel img")].every((i) => i.complete && i.naturalWidth > 0)`, "the panel images", 10000);
    },
  },
  // G3: the About dialog (stale snapshot line masked: its date is the seed's)
  {
    id: "G3-about",
    mask: [...MOVING, "#about-body p.small:last-child"],
    steps: async (p) => {
      await garden(p);
      await dialog(p, "#btn-about", "#about");
    },
  },
  // G4: the Controls dialog (keyboard + mouse options on desktop, touch controls on the phone)
  {
    id: "G4-help",
    mask: MOVING,
    steps: async (p) => {
      await garden(p);
      await dialog(p, "#btn-help", "#help");
    },
  },
  // G5: the interface in English (language button), with the About dialog
  {
    id: "G5-english-about",
    mask: [...MOVING, "#about-body p.small:last-child"],
    steps: async (p) => {
      await garden(p);
      await p.evaluate(`document.querySelector("#btn-lang").click(); true`);
      await must(p, `document.documentElement.lang === "en"`, "English", 5000);
      await dialog(p, "#btn-about", "#about");
    },
  },
];
