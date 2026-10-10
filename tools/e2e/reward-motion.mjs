// Actual reward claim/exit and mode-aware banners; fresh profile, Vite dev endpoint required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
const out = process.argv[2] ?? '/tmp/reward-motion'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block' });
await page.addInitScript(() => {
  performance.setResourceTimingBufferSize(10000);
  // Vite may timestamp application imports after HMR. Reuse the exact loaded module, not a second canonical copy.
  window.__appModule = async path => {
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(url => url.split('?')[0] === location.origin + path);
    if (!urls.length) throw new Error(`application module not loaded: ${path}`);
    for (const url of urls.reverse()) {
      const module = await import(url);
      if (path === '/src/store.ts' && module.ui !== window.ui) continue;
      return module;
    }
    throw new Error(`module instance does not match application: ${path}`);
  };
});
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47178/') + '?seed=CONTINUE1&lang=zhs&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  const command = text => page.evaluate(t => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand(t).success, text);
  assert.equal(await command('room Monster'), true);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 60000 });
  assert.equal(await command('win'), true);
  await page.waitForSelector('.rewards-screen .proceed-btn.shown', { timeout: 60000 });
  await page.waitForTimeout(550);
  const before = await page.evaluate(() => {
    window.__rewards = window.ui.overlays.find(v => v.kind === 'rewards');
    if (!window.__rewards) window.__rewards = window.ui.overlays.at(-1);
    return { count: window.__rewards.buttons.length, index: window.__rewards.buttons.findIndex(r => r instanceof window.G.GoldReward) };
  });
  assert.ok(before.index >= 0, 'normal combat rewards include gold');
  // Observe the short presentation window from inside the page, independent of Playwright roundtrip latency.
  await page.evaluate(async () => {
    const { retiringOverlays, ui } = await window.__appModule('/src/store.ts');
    if (ui !== window.ui) throw new Error('observing a different overlay store');
    window.__motion = { claim: [], hide: [], exit: [] };
    window.__rewardWindow = document.querySelector('.rewards-screen .rw-window');
    window.__observeMotion = () => {
      const ghost = document.querySelector('.rw-list [data-retiring]');
      if (ghost) window.__motion.claim.push({ logical: window.__rewards.buttons.length, pointer: getComputedStyle(ghost).pointerEvents,
        moving: [...document.querySelectorAll('.rw-list > :not([data-retiring])')].some(e => e.getAnimations().length > 0) });
      if (window.ui.mapOpen) window.__motion.hide.push({ logical: window.ui.overlays.includes(window.__rewards), sameNode: document.querySelector('.rewards-screen .rw-window') === window.__rewardWindow, alpha: Number(getComputedStyle(window.__rewardWindow).opacity), modelAlpha: window.__rewards.fx.WinA, proceed: window.__rewards.proceedOn });
      const exit = document.querySelector('.retiring-overlay .rewards-screen');
      if (exit && retiringOverlays.has(window.__rewards)) window.__motion.exit.push({ logical: window.ui.overlays.includes(window.__rewards), retained: retiringOverlays.has(window.__rewards), sameNode: exit.querySelector('.rw-window') === window.__rewardWindow, alpha: Number(getComputedStyle(window.__rewardWindow).opacity), modelAlpha: window.__rewards.fx.WinA });
      window.__motionRaf = requestAnimationFrame(window.__observeMotion);
    };
    window.__observeMotion();
  });
  await page.locator('.rw-list > .reward-btn').nth(before.index).click();
  await page.waitForFunction(n => window.__rewards.buttons.length === n - 1, before.count);
  await page.waitForTimeout(220);
  // Stretch only the test process clock so cloud software-rendering long frames cannot consume the whole 250ms sample window.
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Normal; window.G.$.setEngineTimeScale(.1); });
  await page.click('.rewards-screen .proceed-btn.shown');
  await page.waitForFunction(() => window.ui.mapOpen, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__rewards.fx.WinA === 0, null, { timeout: 10000 });
  await page.evaluate(() => window.G.$.setEngineTimeScale(1));
  const hidden = await page.evaluate(() => ({ logical: window.ui.overlays.includes(window.__rewards), alpha: Number(getComputedStyle(window.__rewardWindow).opacity), modelAlpha: window.__rewards.fx.WinA, proceed: window.__rewards.proceedOn }));
  assert.deepEqual(hidden, { logical: true, alpha: 0, modelAlpha: 0, proceed: false }, 'Proceed hides rewards behind the map without removing their logical stack entry');
  await page.click('.tb-map'); await page.waitForFunction(() => !window.ui.mapOpen);
  await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => window.__rewards.fx.WinA), 1, 'closing map restores the retained reward window');
  assert.equal(await page.evaluate(() => document.querySelector('.rewards-screen .rw-window') === window.__rewardWindow), true, 'map hide/show preserves the window node');
  // Exercise the actual overlay removal API separately: normal Proceed intentionally only opens the map.
  await page.evaluate(() => { window.G.$.setEngineTimeScale(.1); window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Screens.Overlays.NOverlayStack').Instance.Remove(window.__rewards); });
  await page.waitForSelector('.retiring-overlay', { state: 'attached', timeout: 10000 });
  await page.waitForSelector('.retiring-overlay', { state: 'detached', timeout: 10000 });
  await page.evaluate(() => window.G.$.setEngineTimeScale(1));
  const motion = await page.evaluate(() => { cancelAnimationFrame(window.__motionRaf); return window.__motion; });
  fs.writeFileSync(`${out}/sampled-motion.json`, JSON.stringify(motion, null, 2));
  assert.ok(motion.claim.length > 0, 'claimed row survives long enough for exit animation');
  assert.ok(motion.claim.every(f => f.logical === before.count - 1 && f.pointer === 'none'), 'claimed row removed logically and cannot receive input');
  assert.ok(motion.claim.some(f => f.moving), 'remaining rows animate toward their new layout');
  assert.ok(motion.hide.some(f => f.logical && f.sameNode && !f.proceed && f.alpha > 0 && f.alpha < 1), 'actual Proceed performs a visible hide fade while retaining logical rewards');
  assert.ok(motion.exit.length >= 2, 'reward window remains rendered during exit');
  assert.ok(motion.exit.every(f => !f.logical && f.retained && f.sameNode), 'reward stack closes immediately; only presentation retires');
  assert.ok(motion.exit.some(f => f.alpha > 0 && f.alpha < 1), 'retained window visibly fades');
  assert.equal(await page.locator('.retiring-overlay').count(), 0, 'retired presentation released');
  const banner = async mode => {
    await page.evaluate(async mode => {
      const { spawnCombatBanner, clearCombatBanners } = await window.__appModule('/src/ui/banners.tsx');
      clearCombatBanners(); window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType[mode];
      spawnCombatBanner('player', 2);
    }, mode);
    if (mode === 'Instant') { await page.waitForTimeout(40); return 0; }
    await page.waitForSelector('.cbn-player'); const started = Date.now();
    await page.waitForSelector('.cbn-player', { state: 'detached', timeout: 6000 }); return Date.now() - started;
  };
  // The map is closed above; the combat banner component is mounted.
  const normal = await banner('Normal'), fast = await banner('Fast'), instant = await banner('Instant');
  assert.ok(normal > 1800 && normal < 3200); assert.ok(fast > 750 && fast < normal * .8);
  assert.equal(await page.locator('.combat-banner').count(), 0, 'Instant mode has no stale banners');
  await page.evaluate(async () => {
    const { spawnCombatBanner } = await window.__appModule('/src/ui/banners.tsx');
    window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Normal; spawnCombatBanner('player', 3);
  });
  await page.waitForTimeout(1600);
  await page.evaluate(async () => { (await window.__appModule('/src/ui/banners.tsx')).spawnCombatBanner('enemy'); });
  await page.waitForSelector('.cbn-enemy'); assert.equal(await page.locator('.cbn-player').count(), 0, 'new turn cancels old banner outro');
  await page.evaluate(async () => { (await window.__appModule('/src/ui/banners.tsx')).clearCombatBanners(); });
  await page.waitForTimeout(100); assert.equal(await page.locator('.combat-banner').count(), 0);
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ lifecycleSampleTimeScale: .1, bannerTimeScale: 1, claimFrames: motion.claim.length, hideFrames: motion.hide.length, exitFrames: motion.exit.length, normal, fast, instant, errors }, null, 2));
  console.log('OK reward motion', JSON.stringify({ lifecycleSampleTimeScale: .1, bannerTimeScale: 1, claimFrames: motion.claim.length, hideFrames: motion.hide.length, exitFrames: motion.exit.length, normal, fast, instant }));
} catch (e) { await page.screenshot({ path: `${out}/failure.png` }).catch(() => {}); throw e; }
finally { await page.evaluate(() => window.G?.$?.setEngineTimeScale(1)).catch(() => {}); await browser.close(); }
