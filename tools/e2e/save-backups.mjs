// Legacy migration, journal replay and cross-tab writer lock, with an isolated browser profile.
// CHROME=<headless shell> node tools/e2e/save-backups.mjs [outDir]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { viewport, setAspect } from './start.mjs';
const out = process.argv[2] ?? '/tmp/sts2-backups';
fs.mkdirSync(out, { recursive: true });
const fixture = 'packages/core/test/fixtures/saves-v0.98.3/regent/f25';
const files = fs.readdirSync(fixture, { recursive: true }).filter(p => fs.statSync(path.join(fixture, p)).isFile()).map(p => ['user://' + p, fs.readFileSync(path.join(fixture, p), 'utf8')]);
const url = (process.env.URL ?? 'http://127.0.0.1:47173/') + '?lang=zhs';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.addInitScript(files => {
    if (localStorage.getItem('backup-test-seeded')) return;
    for (const [p, s] of files) localStorage.setItem('sts2fs:' + p, s);
    localStorage.setItem('sts2fs-j:user://journal-test.save', '{"journal":true}');
    localStorage.setItem('backup-test-seeded', '1');
  }, files);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.ui?.screen === 'menu');
  await setAspect(page);
  assert.equal(await page.evaluate(() => window.G.$.vfs.read('user://journal-test.save')), '{"journal":true}');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('sts2fs:') || k.startsWith('sts2fs-j:'))), false);
  for (const [p, s] of files.filter(([p]) => p.endsWith('current_run.save'))) assert.equal(await page.evaluate(p => window.G.$.vfs.read(p), p), s);

  const second = await context.newPage();
  await second.goto(url);
  await second.getByText('重新载入游戏', { exact: true }).waitFor();
  assert.equal(await second.evaluate(() => !!window.G), false);
  await second.screenshot({ path: out + '/second-tab.png' });
  await second.close();

  console.log('OK legacy migration, journal replay and writer lock');
} finally { await browser.close(); }
