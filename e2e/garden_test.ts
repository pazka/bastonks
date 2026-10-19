// deno-lint-ignore-file no-explicit-any
// End-to-end (BRIEF §10): the front-end loads, the Flyover plays, the Pigeon flies to a Branch and the panel
// shows its card. Real server code on the synthetic board, headless Chromium driven by playwright-core.
// Run: deno task build && CHROME_PATH=/path/to/chrome deno task e2e

import { assert, assertEquals } from "@std/assert";
import { chromium } from "playwright-core";
import { loadAssets } from "../src/server/assets.ts";
import { makeHandler } from "../src/server/http.ts";
import { setLogLevel } from "../src/server/log.ts";
import { WorldService } from "../src/server/service.ts";
import { Store } from "../src/server/store.ts";
import { gradientPng } from "../tests/fixtures/png.ts";
import { syntheticBoard } from "../tests/fixtures/synthetic.ts";

const CHROME = Deno.env.get("CHROME_PATH") ?? "/usr/bin/google-chrome";

Deno.test({
  name: "e2e: load → Flyover → Pigeon flies to a Branch → panel shows the card",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    setLogLevel("error");
    const board = syntheticBoard();
    const svc = new WorldService({
      store: new Store(await Deno.makeTempDir()),
      fetchBoard: () => Promise.resolve(structuredClone(board)),
      fetchImage: () => Promise.resolve(gradientPng(64, 48)),
      fetchTimeoutMs: 3000,
      minRefetchS: 60,
    });
    await svc.init();
    await svc.refresh();
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      makeHandler(svc, loadAssets()),
    );
    const base = `http://127.0.0.1:${server.addr.port}`;
    const browser = await chromium.launch({
      executablePath: CHROME,
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
    });
    const errors: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, locale: "fr-FR" });
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(`${base}/?lowres`);
      await page.waitForFunction(
        () => {
          const h = (globalThis as any).__bastonks;
          return h?.ready || h?.error;
        },
        null,
        { timeout: 60_000 },
      );
      assertEquals(await page.evaluate(() => (globalThis as any).__bastonks.error), undefined);

      // Flyover: titles over the forest
      const s0 = await page.evaluate(() => (globalThis as any).__bastonks.state());
      assert(s0.flyover, "flyover should be playing");
      assert(s0.trees >= 100, `trees ${s0.trees}`);
      // the intro waits behind one large button on the loading screen
      assert((await page.textContent("#enter"))?.includes("Salomé Klein"));
      assertEquals(await page.evaluate(() => (globalThis as any).__bastonks.entered), false);
      await page.click("#enter");
      await page.waitForFunction(() => (globalThis as any).__bastonks.entered === true);
      await page.waitForSelector(".title-card.on", { timeout: 10_000 });
      const title = await page.textContent("#thesis-title");
      assert(title?.includes("Détection automatique des expressions émotionnelles"));
      assertEquals(await page.locator(".title-card blockquote").count(), 0); // the epigraph lives on the Path now
      await page.click("#skip");
      await page.waitForFunction(() => (globalThis as any).__bastonks.flyoverDone === true, null, {
        timeout: 10_000,
      });
      assert(await page.isVisible("#counter"));
      // the epigraph is traced in a ring on the ground where the pigeon starts, then stays
      await page.waitForFunction(() => (globalThis as any).__bastonks.state().epigraph > 0.5, null, {
        timeout: 20_000,
      });

      // The Pigeon flies to a Branch (real controls, driven by the autopilot) and inspects it
      await page.evaluate(() => (globalThis as any).__bastonks.autopilot(3));
      await page.waitForFunction(
        () => {
          const s = (globalThis as any).__bastonks.state();
          return s.panelOpen && s.mode === "perch";
        },
        null,
        {
          timeout: 150_000,
          polling: 500,
        },
      );
      const s1 = await page.evaluate(() => (globalThis as any).__bastonks.state());
      assertEquals(s1.mode, "perch");
      assert(s1.found >= 1);
      assert(await page.isVisible("#panel"));
      const panelTitle = await page.textContent("#panel h2");
      assertEquals(panelTitle, s1.panelTitle);
      const kicker = await page.textContent("#panel .kicker");
      assert(kicker?.startsWith("Semaine du"), kicker ?? "");
      // the counter shows what was found (the autopilot may perch on a neighbouring branch on its way)
      assert((await page.textContent("#counter"))?.startsWith(`${s1.found} / `));
      // links in card content are never clickable
      assertEquals(await page.locator("#panel a").count(), 0);
      // Shift: one branch down (or the ground from the lowest one); the panel stays open
      const before = s1.panelTitle;
      await page.keyboard.press("Shift");
      await page.waitForFunction(
        (t) => {
          const s = (globalThis as any).__bastonks.state();
          return s.mode === "ground" || (s.mode === "perch" && s.panelTitle !== t);
        },
        before,
        { timeout: 30_000, polling: 250 },
      );
      assert(
        (await page.evaluate(() => (globalThis as any).__bastonks.state())).panelOpen,
        "panel stays open",
      );
      assertEquals(errors, []);
    } finally {
      await browser.close();
      await server.shutdown();
    }
  },
});
