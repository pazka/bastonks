// Visual regression harness for bastonks (hosh-management AGENTS.md §3): takes a screenshot of every use
// case of visual/cases.mjs at 1400, 1024 and 390 px, then compares each with its baseline in
// visual/baseline/ and writes a diff picture for every difference. Node built-ins + the machine's Chrome.
// Same harness as pazka/plats visual/ (the 3D canvas is hidden before each shot: see cases.mjs).
//
//   node visual/shoot.mjs <base url> [--update]
//     OUT=visual/out (shots + diffs + report.json)   CHROME=/path/to/chrome (default google-chrome)
//     --update: copy the new shots over the baselines (QA only, in a PR that says the change is wanted).
//     VISUAL_PRINT_NEW=1: also print every failing shot in the log (visual/from-log.mjs takes them back).
//
// Determinism: animations and transitions off, caret hidden, scrollbars hidden, sRGB, a fixed viewport,
// UTC time zone, French locale, the WebGL canvas hidden, content moved by timers masked (cases.mjs). The baseline is only meaningful for the Chrome
// that made it: report.json records the Chrome version, and a version change is reported as such.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { launch } from "./cdp.mjs";
import { CASES, WIDTHS } from "./cases.mjs";

const base = (process.argv[2] || "http://127.0.0.1:18310").replace(/\/$/, "");
const update = process.argv.includes("--update");
const OUT = process.env.OUT || "visual/out";
const BASE_DIR = new URL("./baseline/", import.meta.url).pathname;
// per-pixel tolerance (max channel difference, anti-aliasing) and share of differing pixels allowed
const CHANNEL_TOL = Number(process.env.VISUAL_CHANNEL_TOL || 24);
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO || 0.001);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "diff"), { recursive: true });

const FREEZE = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
  #scene { visibility: hidden !important; }`;

// desktop and laptop shots: a browser with a mouse; phone shots: a touch browser without one
const desktop = await launch({ mouse: true });
const phone = await launch({ mouse: false });
const browser = desktop; // comparisons and the version
const report = { chrome: browser.version, base, shots: [], failures: [] };
console.log(`Chrome: ${browser.version}`);

async function shoot(c, width) {
  const mobile = width < 600;
  const p = await (mobile ? phone : desktop).page();
  await p.send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
  if (mobile) await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  // the app's CSP (style-src 'self') would block the harness's own <style> (freeze, hidden canvas, masks):
  // bypassed in this test browser only, the page itself is unchanged
  await p.send("Page.setBypassCSP", { enabled: true });
  await p.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
  await p.send("Emulation.setLocaleOverride", { locale: "fr-FR" });
  await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  if (c.failWorld) {
    // the world cannot be loaded: /api/world answers 503 (nothing else is intercepted)
    p.on("Fetch.requestPaused", (e) => p.send("Fetch.fulfillRequest", { requestId: e.requestId, responseCode: 503, body: "" }).catch(() => {}));
    await p.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/world*" }] });
  }
  await p.goto(base + "/");
  if (c.steps) await c.steps(p, base);
  const css = FREEZE + (c.mask || []).map((s) => `${s} { visibility: hidden !important; }`).join("\n");
  await p.evaluate(`(() => {
    const s = document.createElement("style"); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s);
    if (getComputedStyle(document.querySelector("#scene")).visibility !== "hidden") throw new Error("harness style not applied (CSP?)");
    if (document.activeElement && document.activeElement !== document.body && !document.querySelector("dialog[open]")) document.activeElement.blur();
    return true;
  })()`);
  await p.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
  const { data } = await p.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const errors = [...p.errors];
  await p.close();
  return { png: Buffer.from(data, "base64"), errors };
}

/** Compares two PNGs in Chrome (canvas): differing pixels, and a diff picture (red where they differ). */
async function compare(a, b) {
  const p = await browser.page();
  const r = await p.evaluate(`(async () => {
    const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/png;base64," + b64; });
    const [x, y] = await Promise.all([load(${JSON.stringify(a.toString("base64"))}), load(${JSON.stringify(b.toString("base64"))})]);
    if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
    const w = x.width, h = x.height;
    const get = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const da = get(x), db = get(y);
    const out = new OffscreenCanvas(w, h); const g = out.getContext("2d"); const od = g.createImageData(w, h);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > ${CHANNEL_TOL}) { diff++; od.data[i] = 255; od.data[i + 1] = 0; od.data[i + 2] = 0; od.data[i + 3] = 255; }
      else { const v = (da[i] + da[i + 1] + da[i + 2]) / 3; od.data[i] = od.data[i + 1] = od.data[i + 2] = 255 - (255 - v) * 0.25; od.data[i + 3] = 255; }
    }
    g.putImageData(od, 0, 0);
    const blob = await out.convertToBlob({ type: "image/png" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { diff, total: w * h, png: btoa(s) };
  })()`);
  await p.close();
  return r;
}

function printShot(name, png) {
  const b64 = png.toString("base64");
  const n = Math.ceil(b64.length / 8000);
  const sum = createHash("sha256").update(png).digest("hex");
  for (let i = 0; i < n; i++) console.log(`VISUAL-PNG ${name} ${i + 1}/${n} ${sum} ${b64.slice(i * 8000, (i + 1) * 8000)}`);
}

for (const c of CASES) {
  for (const width of WIDTHS) {
    {
      const name = `${c.id}-${width}.png`;
      let shot;
      try {
        shot = await shoot(c, width);
      } catch (e) {
        report.failures.push({ name, reason: `could not take the shot: ${e.message}` });
        console.log(`FAIL  ${name}  (${e.message})`);
        continue;
      }
      writeFileSync(join(OUT, name), shot.png);
      const entry = { name, errors: shot.errors };
      if (shot.errors.length) {
        report.failures.push({ name, reason: `page error: ${shot.errors[0]}` });
      }
      const basePath = join(BASE_DIR, name);
      if (update) {
        copyFileSync(join(OUT, name), basePath);
        entry.result = "baseline updated";
      } else if (!existsSync(basePath)) {
        entry.result = "no baseline";
        report.failures.push({ name, reason: "no baseline (visual/baseline/" + name + ")" });
      } else {
        const r = await compare(readFileSync(basePath), shot.png);
        if (r.size) {
          entry.result = `size ${r.size[0]}x${r.size[1]} -> ${r.size[2]}x${r.size[3]}`;
          report.failures.push({ name, reason: `page size changed: ${entry.result}` });
        } else {
          entry.ratio = r.diff / r.total;
          entry.result = r.diff ? `${r.diff} px differ (${(entry.ratio * 100).toFixed(3)} %)` : "identical";
          if (r.diff) writeFileSync(join(OUT, "diff", name), Buffer.from(r.png, "base64"));
          if (entry.ratio > MAX_RATIO) report.failures.push({ name, reason: entry.result });
        }
      }
      report.shots.push(entry);
      // VISUAL_PRINT_NEW=1 (CI): a shot without a matching baseline is also printed in the log, so an agent
      // that cannot download artifacts can take it as the new baseline (visual/from-log.mjs).
      if (process.env.VISUAL_PRINT_NEW && report.failures.some((f) => f.name === name)) printShot(name, shot.png);
      console.log(`${report.failures.some((f) => f.name === name) ? "FAIL" : "ok  "}  ${name}  ${entry.result}`);
    }
  }
}

if (!update) {
  // a baseline nobody shoots any more is a use case that silently left the harness
  const shot = new Set(report.shots.map((s) => s.name));
  for (const f of readdirSync(BASE_DIR).filter((f) => f.endsWith(".png"))) {
    if (!shot.has(f)) report.failures.push({ name: f, reason: "baseline without a use case (removed from cases.mjs?)" });
  }
  const prev = existsSync(join(BASE_DIR, "chrome.txt")) ? readFileSync(join(BASE_DIR, "chrome.txt"), "utf8").trim() : "";
  if (prev && prev !== browser.version) {
    console.log(`note: baselines were made with ${prev}, this run uses ${browser.version}`);
    report.baselineChrome = prev;
  }
} else {
  writeFileSync(join(BASE_DIR, "chrome.txt"), browser.version + "\n");
}

desktop.close();
phone.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.shots.length} shots, ${report.failures.length} failure(s)`);
for (const f of report.failures) console.log(`  - ${f.name}: ${f.reason}`);
process.exit(report.failures.length ? 1 : 0);
