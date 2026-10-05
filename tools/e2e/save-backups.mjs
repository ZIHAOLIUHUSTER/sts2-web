// Portable backup, legacy migration, journal replay and cross-tab writer lock, with an isolated browser profile.
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

  await page.evaluate(() => { window.ui.menuStack = ['settings']; window.invalidate(); });
  const scroll = async () => {
    for (let i = 0; i < 28; i++) await page.locator('.settings-scroll').dispatchEvent('wheel', { deltaY: 160 });
    await page.waitForTimeout(1000);
  };
  await scroll();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('.st-button').filter({ hasText: '下载备份' }).click();
  const download = await downloadEvent;
  await download.saveAs(out + '/backup.json');
  const backup = JSON.parse(fs.readFileSync(out + '/backup.json', 'utf8'));
  assert.equal(backup.format, 'sts2-web-backup');
  for (const [p, s] of files.filter(([p]) => p.endsWith('current_run.save'))) assert.equal(backup.files.find(f => f.path === p).content, s);
  await page.screenshot({ path: out + '/backup-settings.png' });
  await page.locator('.st-button').filter({ hasText: '申请保护' }).click();
  await page.locator('.vpopup').waitFor();
  await page.screenshot({ path: out + '/storage-protection.png' });
  await page.locator('.vp-btn.yes').click();

  // Add a file that must disappear after a full snapshot restore.
  await page.evaluate(async () => { window.G.$.vfs.write('user://after-backup.save', '{}'); await window.G.$.vfs.flush(); });
  const choose = page.waitForEvent('filechooser');
  await page.locator('.st-button').filter({ hasText: /^恢复$/ }).click();
  const preRestore = page.waitForEvent('download');
  await (await choose).setFiles(out + '/backup.json');
  await (await preRestore).saveAs(out + '/before-restore.json');
  await page.locator('.vpopup').waitFor();
  await page.screenshot({ path: out + '/restore-confirm.png' });
  await Promise.all([page.waitForEvent('load'), page.locator('.vp-btn.yes').click()]);
  await page.waitForFunction(() => window.ui?.screen === 'menu');
  assert.equal(await page.evaluate(() => window.G.$.vfs.read('user://after-backup.save')), null);
  for (const [p, s] of files.filter(([p]) => p.endsWith('current_run.save'))) assert.equal(await page.evaluate(p => window.G.$.vfs.read(p), p), s);
  await page.locator('.mm-continue').click();
  await page.waitForFunction(() => window.ui?.screen === 'run' && window.G.RunManager.Instance.State?.CurrentRoom);
  await page.screenshot({ path: out + '/restored-run.png' });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('OK legacy migration, journal replay, writer lock, download, restore and old-run continuation');
} finally { await browser.close(); }
