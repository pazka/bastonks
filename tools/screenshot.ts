// deno-lint-ignore-file no-explicit-any
// Screenshots of the LIVE site for the owner's hub card (CI only, never on the box — Decision #17).
// Run: CHROME_PATH=/path/to/chrome deno run -A tools/screenshot.ts https://bastonks.hosh.it shots

import { chromium } from "playwright-core";

const [url = "https://bastonks.hosh.it", out = "shots"] = Deno.args;
const CHROME = Deno.env.get("CHROME_PATH") ?? "/usr/bin/google-chrome";
await Deno.mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 }, locale: "fr-FR" });
  await page.goto(url);
  await page.waitForFunction(() => {
    const h = (globalThis as any).__bastonks;
    return h?.ready || h?.error;
  }, null, { timeout: 120_000 });
  await page.waitForSelector(".title-card.on", { timeout: 30_000 });
  for (const s of [3, 6, 9]) {
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: `${out}/flyover-${s}s.jpg`, type: "jpeg", quality: 85 });
  }
  await page.click("#skip");
  await page.waitForFunction(() => (globalThis as any).__bastonks.flyoverDone === true, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: `${out}/pigeon.jpg`, type: "jpeg", quality: 85 });
  console.log("screenshots written to", out);
} finally {
  await browser.close();
}
