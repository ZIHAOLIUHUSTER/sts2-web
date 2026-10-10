// Fresh Android-like profiles: initial visuals must precede battle presentation.
// CHROME=<path> URL=<build-or-dev> node tools/e2e/combat-readiness.mjs /tmp/combat-readiness
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/combat-readiness'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const reports = [];
try {
  for (const scenario of ['ready', 'timeout', 'cancelled']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 10; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36' });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__apps = []; window.__draws = 0;
      window.__PIXI_APP_INIT__ = app => {
        window.__apps.push(app); const render = app.render.bind(app);
        app.render = () => { render(); if (document.querySelector('.combat .stage-host')?.contains(app.canvas)) window.__draws++; };
      };
    });
    await page.goto((process.env.URL ?? 'http://127.0.0.1:47175/') + '?seed=READY1&lang=zhs&unlock=all&tutorials=off');
    await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
    await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
    await startRun(page);
    await page.evaluate(() => {
      window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Normal;
      window.__starts = 0; const manager = window.G.CombatManager.Instance, start = manager.StartCombatInternal.bind(manager);
      manager.StartCombatInternal = () => { window.__starts++; return start(); };
    });
    let holding = true; const blocked = [];
    await page.route('**/*', route => {
      const url = route.request().url();
      if (holding && (/\/assets\/(scenes|spine)/.test(url) || /\.bin(?:\?|$)/.test(url))) blocked.push(route);
      else void route.continue();
    });
    await page.evaluate(() => { new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand('room Monster'); });
    await page.waitForFunction(() => window.ui.room?.visualStatus === 'pending' && document.querySelector('.combat'), null, { timeout: 60000 });
    await page.waitForTimeout(350);
    const pending = await page.evaluate(() => {
      window.__pendingRoom = window.ui.room;
      return { status: window.ui.room.visualStatus, visibility: getComputedStyle(document.querySelector('.combat')).visibility,
        hud: document.querySelectorAll('.combat-ui').length, creatures: document.querySelectorAll('.combat .creature').length,
        banners: document.querySelectorAll('.combat-banner').length, starts: window.__starts };
    });
    assert.equal(pending.status, 'pending'); assert.equal(pending.visibility, 'hidden');
    assert.equal(pending.hud, 0); assert.equal(pending.creatures, 0); assert.equal(pending.banners, 0); assert.equal(pending.starts, 0);
    assert.ok(blocked.length > 0, 'initial visual requests were actually delayed');
    const release = async () => { holding = false; await Promise.all(blocked.map(route => route.continue().catch(() => {}))); };
    if (scenario === 'ready') {
      await release();
      await page.waitForFunction(() => window.__pendingRoom.visualStatus === 'ready', null, { timeout: 10000 });
      await page.waitForSelector('.combat-ui', { timeout: 10000 });
      assert.ok(await page.evaluate(() => window.__draws > 0), 'combat rendered before becoming visible');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.combat')).visibility), 'visible');
    } else if (scenario === 'timeout') {
      await page.waitForFunction(() => window.__pendingRoom.visualStatus === 'timeout', null, { timeout: 12000 });
      await page.waitForSelector('.combat-ui');
      await release(); await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__pendingRoom.visualStatus), 'timeout', 'late assets do not resolve twice');
    } else {
      // Real room navigation must cancel the prior presentation before its assets finish.
      await page.evaluate(() => { new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand('room RestSite'); });
      await page.waitForFunction(() => window.__pendingRoom.visualStatus === 'cancelled', null, { timeout: 10000 });
      await release(); await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.__starts), 0, 'cancelled battle never starts after late load');
      assert.equal(await page.evaluate(() => window.ui.room?.kind), 'rest');
    }
    const final = await page.evaluate(() => ({ status: window.__pendingRoom.visualStatus, starts: window.__starts, draws: window.__draws }));
    assert.deepEqual(errors, []); reports.push({ scenario, requests: blocked.length, pending, final });
    await page.screenshot({ path: `${out}/${scenario}.png` }); await context.close();
  }
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(reports, null, 2)); console.log('OK', JSON.stringify(reports));
} finally { await browser.close(); }
