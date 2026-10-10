// Actual APK renderer and Spine cadence with a bridge mock; isolated fresh saves.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startRun, initAndroid } from './start.mjs';
const out = process.argv[2] ?? '/tmp/android-render'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (Linux; Android 10; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36' });
await initAndroid(page); const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47179/') + '?seed=CLOCK07&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  await page.evaluate(() => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand('room Monster'));
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const moduleUrl = path => performance.getEntriesByType('resource').map(e => e.name).filter(u => u.split('?')[0] === location.origin + path).at(-1) ?? path;
    const stage = await import(moduleUrl('/src/render/stage.ts'));
    const app = await stage.getApp();
    if (!app.canvas.isConnected) throw new Error('wrong stage singleton');
    const walk = root => root.skeleton ? root : root.children?.map(walk).find(Boolean);
    const sp = walk(app.stage); if (!sp) throw new Error('no real Spine actor');
    const core = window.G.$;
    const frame = () => new Promise(resolve => { core.onFrame(() => { resolve(); return false; }); });
    const sample = async scale => {
      core.setEngineTimeScale(scale);
      await frame();
      const entry = sp.state.getCurrent(0), before = entry.trackTime, start = window.__render().clock.frames;
      const animationSpeed = sp.state.timeScale * entry.timeScale;
      let dtSum = 0, count = 0;
      await new Promise(resolve => core.onFrame(dt => { dtSum += dt; if (++count >= 5) { resolve(); return false; } }));
      // The process callback runs before Spine; include its final matching renderer update.
      await new Promise(resolve => queueMicrotask(resolve));
      if (sp.state.getCurrent(0) !== entry) throw new Error('animation changed during cadence sample');
      return { scale, count, animationSpeed, clockFrames: window.__render().clock.frames - start, dtSum, spineTime: entry.trackTime - before };
    };
    const normal = await sample(1), slow = await sample(.25); core.setEngineTimeScale(1);
    window.G.SaveManager.Instance.SettingsSave.FpsLimit = 30; stage.applyFpsLimit(); const capped = window.__render();
    window.G.SaveManager.Instance.SettingsSave.FpsLimit = 60; stage.applyFpsLimit();
    const diag = await import(moduleUrl('/src/diagnostics.ts'));
    await diag.exportPerformanceReport(); const exported = window.__exportedDiagnostic;
    const report = JSON.parse(exported.json);
    return { normal, slow, capped, exportedName: exported.name, report,
      hurtAbsent: !document.querySelector('.hurt-vignette'), errors: [] };
  });
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(result, null, 2));
  for (const sample of [result.normal, result.slow]) {
    assert.equal(sample.count, 5); assert.equal(sample.clockFrames, 5);
    assert.ok(Math.abs(sample.spineTime - sample.dtSum * sample.animationSpeed) < .03, 'actual Spine and core share scaled time, preserving actor animation speed');
  }
  assert.equal(result.capped.appliedFPS, 30); assert.equal(result.capped.clock.fps, 30);
  assert.equal(result.report.frameClock.enabled, true); assert.equal(result.report.native.webView, 'browser-test');
  assert.match(result.exportedName, /^sts2-performance-/); assert.equal(result.hurtAbsent, true);
  assert.deepEqual(errors, []); fs.writeFileSync(`${out}/report.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `${out}/combat.png` }); console.log('OK APK clock, Spine, lazy hurt and diagnostic export', JSON.stringify({normal:result.normal,slow:result.slow}));
} finally { await browser.close(); }
