// Touch regression: held status tips.
// CHROME=<path> [URL=<server>] [PORTRAIT=1] node tools/e2e/touch.mjs <outDir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startRun, travel } from './start.mjs';

const out = process.argv[2] ?? '/tmp/sts2touch';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const portrait = process.env.PORTRAIT === '1';
const viewport = portrait ? { width: 540, height: 960 } : { width: 960, height: 540 };
// The shared run-start helper uses landscape coordinates; rotate once combat is ready.
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, hasTouch: true, isMobile: true });
const errors = [], failures = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await page.context().newCDPSession(page);
let touching = false;
const touch = async (type, point) => {
  if (type === 'touchEnd' && !touching) return;
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
  touching = type === 'touchStart' || type === 'touchMove';
};
const point = async (selector) => {
  const r = await page.locator(selector).first().boundingBox();
  assert.ok(r, selector);
  return { x: r.x + r.width / 2, y: Math.min(viewport.height - 15, r.y + r.height / 2) };
};
const check = async (name, run) => {
  try { await run(); console.log('OK', name); }
  catch (e) { failures.push(name); console.log('FAIL', name, e.message); await page.screenshot({ path: `${out}/${name}-fail.png` }); }
  finally {
    await touch('touchEnd');
    // Restore input after a failing regression so subsequent checks are independent.
    await page.mouse.click(5, 270, { button: 'right' });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(350);
  }
};
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=CONTINUE1&unlock=all&tutorials=off&lang=eng');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  await travel(page);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)');
  await page.keyboard.press('Backquote');
  await page.locator('.dc-line input').fill('power STRENGTH_POWER 2 0');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.creature[data-side="ally"] .power');
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  if (portrait) { await page.setViewportSize(viewport); await page.waitForTimeout(350); }

  await check('held-buff', async () => {
    await touch('touchStart', await point('.creature[data-side="ally"] .power'));
    await page.waitForTimeout(700);
    assert.ok(await page.locator('.hover-tip:visible').count(), 'holding a buff must show its description');
    await page.screenshot({ path: `${out}/held-buff.png` });
    await touch('touchEnd');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.hover-tip:visible').count(), 0, 'release must hide the description');
  });
  assert.deepEqual(errors, [], 'uncaught page errors');
  assert.deepEqual(failures, [], 'touch regressions');
} finally { await browser.close(); }
