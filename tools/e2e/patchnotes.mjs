// Port notes in Chinese / English, language changes, and paging into the unchanged original notes.
// Usage: CHROME=<path> [VIEW=2580x1080 ASPECT=Auto] node tools/e2e/patchnotes.mjs <outDir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { viewport, setAspect } from './start.mjs';

const out = process.argv[2] ?? '/tmp/sts2patchnotes';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport }); // isolated profile; never touches player saves
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const content = page.locator('.pn-text');
const expectText = (text) => page.waitForFunction((s) => document.querySelector('.pn-text')?.textContent.includes(s), text);
const expectDate = (date) => page.waitForFunction((s) => document.querySelector('.pn-date')?.textContent === s, date);
const shot = async (name) => {
  await page.waitForTimeout(1200); // let the menu logo fade and the notes finish opening
  await page.screenshot({ path: `${out}/${name}.png` });
};
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?lang=zhs');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await setAspect(page);
  await page.click('.ea-proceed');
  await page.waitForSelector('.ea-panel', { state: 'detached' });
  await page.click('.pn-button');
  await expectText('移植版更新');
  await expectDate('2026年10月4日');
  assert.equal(await page.locator('.pn-next').count(), 0, 'newest page has no newer arrow');
  await shot('zhs');
  for (const day of [3, 2, 1]) {
    await page.click('.pn-prev');
    await expectDate(`2026年10月${day}日`);
    await expectText('移植版更新');
    if (day === 3) await shot('zhs-long');
  }
  await page.keyboard.press('ArrowLeft');
  await expectDate('February 26, 2026');
  await expectText("It's the last weekly patch before Slay the Spire 2's Early Access launch!!");
  assert.ok(!(await content.innerText()).includes('移植版更新'), 'original page has no port heading');
  const original = await content.innerHTML();
  await shot('original');
  await page.keyboard.press('ArrowRight');
  await expectDate('2026年10月1日');
  for (const day of [2, 3, 4]) {
    await page.click('.pn-next');
    await expectDate(`2026年10月${day}日`);
  }
  // Change the language through settings, then reopen the same page without reloading.
  for (const [language, code] of [['English', 'eng'], ['Français', 'fra'], ['中文', 'zhs']]) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pn-screen', { state: 'detached' });
    await page.click('.mm-settings');
    await page.click('.std-face');
    await page.locator('.std-item').getByText(language, { exact: true }).click();
    await page.waitForFunction((l) => window.G.LocManager.Instance.Language === l, code);
    await page.click('.settings-screen .back-btn');
    await page.click('.pn-button');
    await expectText(code === 'zhs' ? '移植版更新' : 'Web Port Updates');
    await expectDate(code === 'zhs' ? '2026年10月4日' : 'October 4, 2026');
    await shot(code);
    if (code === 'eng') {
      for (const day of [3, 2, 1]) {
        await page.keyboard.press('ArrowLeft');
        await expectDate(`October ${day}, 2026`);
        await expectText('Web Port Updates');
        if (day === 3) await shot('eng-long');
      }
      await page.click('.pn-prev');
      await expectDate('February 26, 2026');
      assert.equal(await content.innerHTML(), original, 'original notes stay identical across languages');
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await expectDate('October 4, 2026');
    }
  }
  assert.deepEqual(errors, []);
  console.log('OK: port notes, original boundary, language switching and English fallback');
} catch (e) {
  await page.screenshot({ path: `${out}/fail.png` });
  throw e;
} finally {
  await browser.close();
}
