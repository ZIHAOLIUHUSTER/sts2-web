// Real winning-card cleanup plus curtain layering. Fresh browser profile; Vite dev endpoint required.
// CHROME=/usr/bin/chromium URL=http://127.0.0.1:47176/ node tools/e2e/combat-cleanup.mjs /tmp/combat-cleanup
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startRun } from './start.mjs';
const out = process.argv[2] ?? '/tmp/combat-cleanup'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const command = text => page.evaluate(t => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand(t).success, text);
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47176/') + '?seed=CONTINUE1&lang=zhs&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page); console.log('started');
  assert.equal(await command('room Monster'), true);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Normal; });
  // Keep a single enemy, reduce its HP with the normal damage command, then finish with an actual dragged card.
  console.log('combat ready');
  const enemyCount = await page.evaluate(() => window.ui.room.combatState.Enemies.length ?? window.ui.room.combatState.Enemies.Count);
  for (let i = 1; i < enemyCount; i++) assert.equal(await command('kill 1'), true);
  const hp = await page.evaluate(() => window.ui.room.combatState.Enemies[0].CurrentHp);
  if (hp > 1) assert.equal(await command(`damage ${hp - 1} 1`), true);
  await page.waitForTimeout(400);
  const play = await page.evaluate(() => {
    const h = window.ui.room.Ui.Hand.ActiveHolders.find(h => h.CardModel?.Type === window.G.CardType.Attack && h.CardModel?.TargetType === window.G.TargetType.AnyEnemy && h.CardModel?.CanPlay$0());
    if (!h) throw new Error('seed must deal a playable targeted attack');
    const stage = document.querySelector('.stage-root').getBoundingClientRect(), scale = stage.width / 1920;
    const p = h.GlobalPosition, enemy = document.querySelector('.creature[data-side="enemy"]:not(.dead) .cr-hitbox').getBoundingClientRect();
    window.__winningNode = h.CardNode;
    window.__finishedUi = window.ui.room.Ui;
    return { from: [stage.left + p.X * scale, stage.top + (p.Y - 60) * scale], to: [enemy.left + enemy.width / 2, enemy.top + enemy.height / 2] };
  });
  await page.mouse.move(...play.from); await page.mouse.down();
  await page.mouse.move(...play.to, { steps: 12 }); await page.waitForTimeout(100); await page.mouse.up();
  console.log('attack released');
  await page.waitForSelector('.rewards-screen .proceed-btn.shown', { timeout: 60000 });
  console.log('rewards ready');
  await page.waitForTimeout(500);
  const cleanup = await page.evaluate(() => ({
    won: !window.G.CombatManager.Instance.IsInProgress,
    cards: window.ui.room.Ui.PlayContainerCards.length,
    winningFreed: window.__winningNode.$freed,
    containerVisible: window.ui.room.Ui.PlayContainer.Visible,
  }));
  assert.equal(cleanup.won, true); assert.equal(cleanup.cards, 0); assert.equal(cleanup.winningFreed, true);
  assert.equal(cleanup.containerVisible, false);
  await page.screenshot({ path: `${out}/rewards-clean.png` });
  // A departing owner may never get pointerleave; ordinary and pinned sets must be removed.
  const curtain = await page.evaluate(async () => {
    const { setTip, pinTips } = await import('/src/ui/tooltip.tsx');
    const { transitionView } = await import('/src/ui/transition.tsx');
    setTip('old owner', 'departing', { kind: 'at', x: 900, y: 450 });
    pinTips([{ title: 'pinned', body: 'departing' }], { kind: 'at', x: 900, y: 450 });
    await transitionView.RoomFadeOut();
    await new Promise(r => requestAnimationFrame(r));
    const cleared = !document.querySelector('.tips-viewport');
    // A newly created scene tip must still stay behind the curtain during a fade.
    setTip('new scene', 'must be behind black', { kind: 'at', x: 900, y: 450 });
    await new Promise(r => requestAnimationFrame(r));
    const z = e => Number(getComputedStyle(document.querySelector(e)).zIndex);
    const above = z('.transition-viewport') > z('.tips-viewport');
    setTip(null); await transitionView.RoomFadeIn();
    return { cleared, above };
  });
  assert.equal(curtain.cleared, true); assert.equal(curtain.above, true);
  await page.click('.rewards-screen .proceed-btn.shown');
  await page.waitForFunction(() => window.ui.mapOpen);
  assert.equal(await command('room Monster'), true);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 60000 });
  const second = await page.evaluate(() => {
    const u = window.ui.room.Ui, h = u.Hand.ActiveHolders.find(h => h.CardModel?.Type === window.G.CardType.Skill && h.CardModel?.CanPlay$0());
    if (!h) throw new Error('second combat must deal a playable skill');
    const r = document.querySelector('.stage-root').getBoundingClientRect(), k = r.width / 1920, p = h.GlobalPosition;
    window.__secondCard = h.CardModel;
    return { fresh: u !== window.__finishedUi, visible: u.PlayContainer.Visible, from: [r.left + p.X * k, r.top + (p.Y - 60) * k], to: [r.left + p.X * k, r.top + 500 * k] };
  });
  assert.equal(second.fresh, true); assert.equal(second.visible, true);
  await page.mouse.move(...second.from); await page.mouse.down(); await page.mouse.move(...second.to, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(() => window.__secondCard.Pile?.Type === window.G.PileType.Discard, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.G.CombatManager.Instance.IsInProgress), true);
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ cleanup, curtain, second, errors }, null, 2));
  console.log('OK', JSON.stringify({ cleanup, curtain }));
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.log(await page.evaluate(() => ({ screen: window.ui?.screen, kind: window.ui?.room?.kind, errors: document.body.innerText.slice(-1200) })).catch(() => null));
  throw e;
} finally { await browser.close(); }
