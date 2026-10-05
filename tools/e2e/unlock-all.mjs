// Settings → Unlock Everything on a fresh profile: confirm, check epochs, ascensions and compendium discoveries,
// reload, check it survived, then check a run's settings do not offer it.
// Usage: CHROME=<path> [URL=<dev server>] node tools/e2e/unlock-all.mjs <outDir>   (exit 1 on failure)
import { chromium } from 'playwright';
import { startRun, viewport } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2unlock';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = async (msg) => { console.log('FAIL', msg, errors); await page.screenshot({ path: `${out}/fail.png` }); await browser.close(); process.exit(1); };
const state = () => page.evaluate(() => {
  const G = window.G, sm = G.SaveManager.Instance, p = sm.Progress, n = (x) => Array.from(x).length;
  return {
    characters: n(sm.GenerateUnlockStateFromProgress().Characters),
    epochs: Array.from(p.Epochs).filter((e) => e.State === G.EpochState.Revealed).length,
    ascension: Math.min(...Array.from(G.ModelDb.AllCharacters, (c) => p.GetOrCreateCharacterStats(c.Id).MaxAscension)),
    cards: n(p.DiscoveredCards), relics: n(p.DiscoveredRelics), potions: n(p.DiscoveredPotions), events: n(p.DiscoveredEvents),
    fought: Array.from(p.EnemyStats.Values).filter((e) => e.TotalWins > 0).length,
    runs: p.NumberOfRuns,
  };
});
const unlockRow = page.locator('.settings-row', { hasText: /Unlock Everything|全解锁/ });
/** A held click: NButtons act on release, and an instant tap can hide a button that goes away on press. */
const press = async (loc) => {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
};

await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=UNLOCKALL1&tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
const all = await page.evaluate(() => {
  const G = window.G, n = (x) => Array.from(x).length;
  return {
    characters: n(G.ModelDb.AllCharacters), epochs: n(G.EpochModel.AllEpochIds),
    cards: n(G.ModelDb.AllCards), relics: n(G.ModelDb.AllRelics), potions: n(G.ModelDb.AllPotions), events: n(G.ModelDb.AllEvents),
    fought: n(G.ModelDb.Monsters),
  };
});
const before = await state();
if (before.characters >= all.characters) await fail('the fresh profile has nothing locked');

await page.evaluate(() => { window.ui.menuStack = ['settings']; window.invalidate(); });
await page.waitForSelector('.settings-screen .st-button');
// the row is under the fold: once the menu's fade from black no longer covers the screen, wheel down to the panel's end
// (it springs back from past it)
await page.waitForFunction(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.settings-screen'));
await page.mouse.move(viewport.width / 2, viewport.height / 2);
for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 100);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/settings.png` });
await press(unlockRow.locator('.st-button'));
await page.waitForSelector('.vpopup');
await page.screenshot({ path: `${out}/confirm.png` });
if (JSON.stringify(await state()) !== JSON.stringify(before)) await fail('unlocked before the confirmation');
await press(page.locator('.vp-btn.yes'));
await page.waitForSelector('.vpopup', { state: 'detached' });
const after = await state();
await page.screenshot({ path: `${out}/unlocked.png` });
console.log('all', JSON.stringify(all), 'before', JSON.stringify(before), 'after', JSON.stringify(after));
if (after.characters !== all.characters || after.epochs !== all.epochs || after.ascension !== 10) await fail('not everything is unlocked');
for (const key of ['cards', 'relics', 'potions', 'events', 'fought']) if (after[key] !== all[key]) await fail(`${key} are not all discovered`);
if (after.runs !== before.runs) await fail('the unlock changed the completed run count');

// the progress save must survive a reload (IndexedDB, written asynchronously)
await page.waitForTimeout(500);
await page.reload();
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
if (await page.evaluate(() => window.G.$.vfs.backend) !== 'indexeddb') await fail('saves are not in IndexedDB');
if (JSON.stringify(await state()) !== JSON.stringify(after)) await fail('the unlock did not survive a reload');

// in a run the row is gone: the run's unlock state was fixed when it started
await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
await startRun(page, { char: all.characters });
await page.click('.tb-settings');
await page.waitForSelector('.pause-menu');
await page.click('.pause-btn >> nth=1'); // Settings
await page.waitForSelector('.settings-screen .st-button');
if (await unlockRow.count()) await fail('a run\'s settings still offer the unlock');
if (errors.length) await fail('page errors');
console.log('OK');
await browser.close();
