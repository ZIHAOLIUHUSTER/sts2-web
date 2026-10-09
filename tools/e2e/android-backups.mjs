// Native bridge contract through real settings UI and unchanged backup codec; no Android device required.
// Does not test the actual SAF picker/provider: validate that on a device separately.
// CHROME=<headless shell> node tools/e2e/android-backups.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const fixture = 'packages/core/test/fixtures/saves-v0.98.3/regent/f25';
const files = fs.readdirSync(fixture, { recursive: true }).filter(p => fs.statSync(path.join(fixture, p)).isFile())
  .map(p => ['user://' + p, fs.readFileSync(path.join(fixture, p), 'utf8')]);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(files => {
    if (!localStorage.getItem('native-backup-seeded')) {
      for (const [p, s] of files) localStorage.setItem('sts2fs:' + p, s);
      localStorage.setItem('native-backup-seeded', '1');
    }
    const listeners = new Set();
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type === 'sts2-backup-result') listeners.add(listener);
      return add(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (type === 'sts2-backup-result') listeners.delete(listener);
      return remove(type, listener, options);
    };
    window.mockSts2Android = { calls: [], throwOnExport: false, listeners };
    window.Sts2Android = { exportBackup(name, text) {
      if (window.mockSts2Android.throwOnExport) throw new Error('mock bridge unavailable');
      window.mockSts2Android.calls.push({ name, text });
    } };
  }, files);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?lang=zhs');
  await page.waitForFunction(() => window.ui?.screen === 'menu');
  await page.evaluate(() => { window.ui.menuStack = ['settings']; window.invalidate(); });
  for (let i = 0; i < 28; i++) await page.locator('.settings-scroll').dispatchEvent('wheel', { deltaY: 160 });
  const exportButton = page.locator('.st-button').filter({ hasText: '下载备份' });
  const resetToast = () => page.evaluate(() => { window.ui.toast = ''; window.invalidate(); });
  const complete = async result => {
    await page.evaluate(result => window.dispatchEvent(new CustomEvent('sts2-backup-result', { detail: result })), result);
    await page.waitForFunction(() => window.mockSts2Android.listeners.size === 0);
  };
  const requestExport = async count => {
    await resetToast();
    await exportButton.click();
    await page.waitForFunction(count => window.mockSts2Android.calls.length === count, count);
    assert.equal(await page.evaluate(() => window.mockSts2Android.listeners.size), 1);
    assert.equal(await page.evaluate(() => window.ui.toast), '');
  };
  await requestExport(1);
  const backup = await page.evaluate(async () => {
    const call = window.mockSts2Android.calls[0];
    return { ...call, decoded: await window.G.decodeBackup(call.text) };
  });
  assert.match(backup.name, /^sts2-backup-.*\.json$/);
  for (const [p, s] of files.filter(([p]) => p.endsWith('current_run.save')))
    assert.equal(backup.decoded.find(([name]) => name === p)?.[1], s);
  await complete('');
  await page.waitForFunction(() => window.ui.toast.includes('备份已下载'));
  console.log('OK native export success and original save bytes');
  await requestExport(2);
  await complete('cancelled');
  assert.equal(await page.evaluate(() => window.ui.toast), '');
  await requestExport(3);
  await complete('write failed');
  await page.waitForFunction(() => window.ui.toast.includes('备份或恢复失败'));
  await page.evaluate(() => { window.mockSts2Android.throwOnExport = true; });
  await resetToast();
  await exportButton.click();
  await page.waitForFunction(() => window.ui.toast.includes('备份或恢复失败'));
  assert.equal(await page.evaluate(() => window.mockSts2Android.listeners.size), 0);
  console.log('OK cancelled/failed export and listener cleanup');
  await page.evaluate(async () => {
    window.mockSts2Android.throwOnExport = false;
    window.G.$.vfs.write('user://native-restore-sentinel.save', '{}');
    await window.G.$.vfs.flush();
  });
  const importBackup = async count => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.st-button').filter({ hasText: /^恢复$/ }).click();
    await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup.text) });
    await page.waitForFunction(count => window.mockSts2Android.calls.length === count, count);
    assert.equal(await page.locator('.vpopup').count(), 0, 'must await native export before restore confirmation');
    assert.equal(await page.evaluate(() => window.G.$.vfs.read('user://native-restore-sentinel.save')), '{}');
  };
  await resetToast();
  await importBackup(4);
  await complete('cancelled');
  assert.equal(await page.locator('.vpopup').count(), 0);
  assert.equal(await page.evaluate(() => window.G.$.vfs.read('user://native-restore-sentinel.save')), '{}');
  console.log('OK cancelled pre-restore backup leaves old files intact');
  await importBackup(5);
  await complete('');
  await page.locator('.vpopup').waitFor();
  assert.equal(await page.evaluate(() => window.G.$.vfs.read('user://native-restore-sentinel.save')), '{}');
  await Promise.all([page.waitForEvent('load'), page.locator('.vp-btn.yes').click()]);
  await page.waitForFunction(() => window.ui?.screen === 'menu');
  assert.equal(await page.evaluate(() => window.G.$.vfs.read('user://native-restore-sentinel.save')), null);
  for (const [p, s] of files.filter(([p]) => p.endsWith('current_run.save')))
    assert.equal(await page.evaluate(p => window.G.$.vfs.read(p), p), s);
  await page.locator('.mm-continue').click();
  await page.waitForFunction(() => window.ui?.screen === 'run' && window.G.RunManager.Instance.State?.CurrentRoom);
  assert.deepEqual(errors, []);
  console.log('OK native mock: original backup codec, successful/cancelled/failed export, listener cleanup, export-before-restore, old-save continuation');
} finally { await browser.close(); }
