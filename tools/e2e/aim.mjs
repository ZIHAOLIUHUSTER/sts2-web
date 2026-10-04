// Touch → targeting-arrow coordinates, including CSS zoom and portrait rotation. Uses the dev server's modules.
// [ENGINE=webkit|chromium] [CHROME=<path>] [URL=<dev server>] node tools/e2e/aim.mjs <outDir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit } from 'playwright';
import { startRun, travel } from './start.mjs';

const engine = process.env.ENGINE ?? 'webkit';
const out = process.argv[2] ?? `/tmp/sts2aim-${engine}`;
fs.mkdirSync(out, { recursive: true });
const browser = await ({ chromium, webkit })[engine].launch(engine === 'chromium' ? { executablePath: process.env.CHROME } : {});
// Start at scale 1 so broken zoom coordinates cannot prevent the test from reaching combat.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, hasTouch: true, isMobile: true });
const errors = [], failures = [];
page.on('pageerror', (e) => errors.push(e.message));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} != ${expected}`);
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=CONTINUE1&unlock=all&tutorials=off&lang=eng');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  await travel(page);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)');
  await page.evaluate(async () => {
    // Reuse the loaded module URL, including Vite's timestamp, to inspect the live arrow rather than a second instance.
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/src\/cardnodes\.ts(?:\?|$)/.test(n));
    window.aimNodes = await import(url);
    // Touch coordinates are physical and bypass the app's MouseEvent rotation shim. WebKit rounds injected touches.
    window.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      window.aimTouch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    const marker = document.createElement('div');
    marker.id = 'aim-point';
    marker.style.cssText = 'position:absolute;left:1436px;top:396px;width:8px;height:8px;border:2px solid magenta;pointer-events:none';
    document.querySelector('.stage-root').append(marker);
    const outside = document.createElement('div');
    outside.id = 'aim-outside';
    outside.style.cssText = 'position:fixed;left:10px;top:20px;width:30px;height:40px;pointer-events:none';
    document.body.append(outside);
  });
  for (const [width, height, aspect, scale] of [
    [960, 540, 'SixteenByNine', .5],
    [1000, 600, 'SixteenByNine', 1000 / 1920], // letterboxing
    [1280, 720, 'SixteenByNine', 2 / 3],
    [1290, 540, 'Auto', .5], // expanded width
    [840, 630, 'Auto', .5], // expanded height
    [1920, 1080, 'SixteenByNine', 1],
  ]) for (const portrait of [false, true]) {
    const name = `${width}x${height}-${aspect}-${portrait ? 'portrait' : 'landscape'}`;
    try {
      await page.setViewportSize(portrait ? { width: height, height: width } : { width, height });
      await page.evaluate((aspect) => {
        window.G.SaveManager.Instance.SettingsSave.AspectRatioSetting = window.G.AspectRatioSetting[aspect];
        window.dispatchEvent(new Event('resize'));
      }, aspect);
      await page.waitForTimeout(200);
      const left = (width - 1920 * scale) / 2, top = (height - 1080 * scale) / 2;
      const x = left + 1440 * scale, y = top + 400 * scale;
      await page.touchscreen.tap(...(portrait ? [height - y, x] : [x, y]));
      const result = await page.evaluate(async () => {
        const { mouse, arrow, targetManager } = window.aimNodes;
        targetManager.StartTargeting(window.G.TargetType.AnyEnemy, { X: 960, Y: 950 }, 1, null);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
        return { touch: window.aimTouch, mouse: { ...mouse }, to: { x: arrow.to.X, y: arrow.to.Y },
          stage: rect('.stage-root'), marker: rect('#aim-point'), outside: rect('#aim-outside') };
      });
      await page.screenshot({ path: `${out}/${name}.png` });
      const finger = portrait ? { x: result.touch.y, y: height - result.touch.x } : result.touch;
      for (const p of [result.mouse, result.to]) { near(left + p.x * scale, finger.x, 'aim x'); near(top + p.y * scale, finger.y, 'aim y'); }
      for (const [key, value] of Object.entries({ x: left, y: top, width: 1920 * scale, height: 1080 * scale })) near(result.stage[key], value, `stage ${key}`);
      near(result.marker.x + result.marker.width / 2, x, 'marker x');
      near(result.marker.y + result.marker.height / 2, y, 'marker y');
      if (!portrait) for (const [key, value] of Object.entries({ x: 10, y: 20, width: 30, height: 40 })) near(result.outside[key], value, `outside ${key}`);
      console.log('OK', name);
    } catch (e) { failures.push(`${name}: ${e.message}`); console.log('FAIL', failures.at(-1)); }
    finally { await page.evaluate(() => window.aimNodes.targetManager.CancelTargeting()); }
  }
  assert.deepEqual(errors, [], 'uncaught page errors');
  assert.deepEqual(failures, [], 'aim regressions');
} finally { await browser.close(); }
