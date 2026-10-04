// Touch regressions: held status tips, cancelling a card, and dragging cards to play.
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
// In portrait the app rotates the 960 × 540 play area clockwise.
const screenPoint = (x, y) => portrait ? { x: 540 - y, y: x } : { x, y };
const errors = [], failures = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await page.context().newCDPSession(page);
let touching = false;
const touch = async (type, point) => {
  if (type === 'touchEnd' && !touching) return;
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
  touching = type === 'touchStart' || type === 'touchMove';
};
const state = () => page.evaluate(() => {
  const hand = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand;
  const me = window.G.RunManager.Instance.State.Players[0];
  return { playing: !!hand.currentPlay, cards: hand.ActiveHolders.length,
    energy: me.PlayerCombatState.Energy, block: me.Creature.Block };
});
const point = async (selector) => {
  const r = await page.locator(selector).first().boundingBox();
  assert.ok(r, selector);
  return { x: r.x + r.width / 2, y: Math.min(viewport.height - 15, r.y + r.height / 2) };
};
const card = (name) => page.evaluate((name) => {
  const hand = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand;
  const holder = hand.ActiveHolders.find((h) => h.CardNode.Model.Id.Entry === name.toUpperCase() || h.CardNode.Model.Id.Entry.startsWith(name.toUpperCase() + '_'));
  if (!holder) throw new Error(`Missing card: ${name}`);
  const r = document.querySelector('.stage-root').getBoundingClientRect();
  const x = r.left + holder.GlobalPosition.X * r.width / 1920;
  const y = Math.min(525, r.top + holder.GlobalPosition.Y * r.height / 1080);
  return innerHeight > innerWidth ? { x: innerWidth - y, y: x } : { x, y };
}, name);
const idle = () => page.waitForFunction(() => !window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand.currentPlay, null, { timeout: 2000 });
const pick = async (name) => {
  await touch('touchStart', await card(name));
  assert.equal((await state()).playing, true, `${name} must be picked up`);
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
  await check('tap-card', async () => {
    const before = await state();
    await page.touchscreen.tap(...Object.values(await card('Bash')));
    await idle();
    assert.deepEqual(await state(), before, 'tapping must put the card back without spending energy');
  });
  await check('return-card', async () => {
    const before = await state();
    await pick('Bash');
    await touch('touchMove', screenPoint(480, 290));
    await page.waitForTimeout(150);
    await touch('touchMove', screenPoint(480, 480));
    await touch('touchEnd');
    await idle();
    assert.deepEqual(await state(), before);
    await page.screenshot({ path: `${out}/returned-card.png` });
  });
  await check('empty-target', async () => {
    const before = await state();
    await pick('Bash');
    await touch('touchMove', screenPoint(480, 250));
    await page.waitForTimeout(150);
    await touch('touchEnd');
    await idle();
    assert.deepEqual(await state(), before);
  });
  await check('cancel-touch', async () => {
    const before = await state();
    await pick('Bash');
    await touch('touchMove', screenPoint(480, 250));
    await page.waitForTimeout(150);
    await touch('touchCancel');
    await idle();
    assert.deepEqual(await state(), before);
  });
  await check('mouse-click-mode', async () => {
    const p = await card('Bash');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(100);
    assert.equal((await state()).playing, true, 'desktop click-to-pick remains available');
    await page.mouse.click(5, 270, { button: 'right' });
    await idle();
  });
  await check('play-defend', async () => {
    const before = await state();
    await pick('Defend');
    await touch('touchMove', screenPoint(480, 250));
    await page.waitForTimeout(150);
    await touch('touchEnd');
    await idle();
    await page.waitForTimeout(300);
    const after = await state();
    assert.equal(after.cards, before.cards - 1);
    assert.equal(after.energy, before.energy - 1);
    assert.ok(after.block > before.block);
  });
  await check('play-attack', async () => {
    const before = await state();
    const hp = () => page.locator('.creature[data-side="enemy"] .hp-label').allTextContents();
    const oldHp = await hp();
    assert.ok(oldHp.length, 'enemy health must be visible');
    await pick('Strike');
    await touch('touchMove', screenPoint(480, 250));
    await page.waitForTimeout(150);
    await touch('touchMove', await point('.creature[data-side="enemy"] .cr-hitbox'));
    await page.waitForTimeout(150);
    await touch('touchEnd');
    await idle();
    await page.waitForTimeout(500);
    const after = await state();
    assert.equal(after.cards, before.cards - 1);
    assert.equal(after.energy, before.energy - 1);
    assert.notDeepEqual(await hp(), oldHp);
    await page.screenshot({ path: `${out}/played-attack.png` });
  });
  assert.deepEqual(errors, [], 'uncaught page errors');
  assert.deepEqual(failures, [], 'touch regressions');
} finally { await browser.close(); }
