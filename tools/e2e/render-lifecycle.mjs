// Targeted real-Pixi lifecycle check; run against Vite dev, in an isolated browser context.
// CHROME=/usr/bin/chromium URL=http://127.0.0.1:47175/ node tools/e2e/render-lifecycle.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
await page.route(url, (r) => r.fulfill({ contentType: 'text/html', body: '<main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { getApp, CombatStage, applyFpsLimit } = await import('/src/render/stage.ts');
    const { G } = await import('/src/game.ts');
    const { Ticker } = await import('/node_modules/.vite/deps/pixi__js.js');
    const app = await getApp();
    const previousMock = G.SaveManager._mockInstance;
    G.SaveManager._mockInstance = { SettingsSave: { FpsLimit: 60 } };
    const manager = G.SaveManager.Instance;
    const limits = [24, 30, 60, 120, 0].map(limit => {
      manager.SettingsSave.FpsLimit = limit; applyFpsLimit();
      return { requested: limit, applied: app.ticker.maxFPS, shared: Ticker.shared.maxFPS };
    });
    G.SaveManager._mockInstance = previousMock;
    app.ticker.maxFPS = 20;
    let renders = 0, syncs = 0;
    const actualRender = app.render.bind(app);
    app.render = () => { renders++; actualRender(); };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await wait(180);
    const detached = renders;
    const stage = new CombatStage({});
    stage.sync = () => { syncs++; };
    await stage.mount(document.querySelector('main'));
    await wait(550);
    const mounted = { renders, syncs, timing: window.__render().frameTime };
    const hidden = (value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const cycles = [];
    // Preserve all four initially running/stopped ticker states, including repeated hidden events.
    for (const own of [false, true]) for (const shared of [false, true]) {
      own ? app.ticker.start() : app.ticker.stop();
      shared ? Ticker.shared.start() : Ticker.shared.stop();
      hidden(true); hidden(true);
      const at = syncs;
      await wait(120);
      const suspended = !app.ticker.started && !Ticker.shared.started && syncs === at;
      hidden(false); hidden(false);
      cycles.push({ suspended, resumed: app.ticker.started === own && Ticker.shared.started === shared });
    }
    Ticker.shared.stop();
    Ticker.shared.autoStart = true;
    hidden(true);
    let lateFrames = 0;
    const lateTick = () => { lateFrames++; };
    Ticker.shared.add(lateTick);
    await wait(120);
    const lateSuspended = !Ticker.shared.started && lateFrames === 0;
    hidden(false);
    await wait(120);
    const lateResumed = Ticker.shared.started && lateFrames > 0;
    Ticker.shared.remove(lateTick);
    app.ticker.start();
    stage.destroy();
    const at = { renders, syncs };
    await wait(150);
    const destroyed = { renders: renders - at.renders, syncs: syncs - at.syncs };
    const late = new CombatStage({});
    late.destroy();
    await late.mount(document.querySelector('main'));
    return { limits, renderer: window.__render(), detached, mounted, cycles, lateSuspended, lateResumed, destroyed, lateConnected: app.canvas.isConnected };
  });
  assert.equal(result.detached, 0, 'an unmounted main canvas issues no GPU draws');
  assert.ok(result.limits.every(x => Math.abs(x.applied - x.requested) < .001 && Math.abs(x.shared - x.requested) < .001), 'every FPS setting is applied, even with software rendering; no hidden 30 FPS clamp');
  assert.ok(result.mounted.renders >= 4 && result.mounted.renders <= 14, 'mounted canvas respects 20 FPS');
  assert.equal(result.mounted.syncs, result.mounted.renders, 'combat synchronization follows displayed frames');
  assert.ok(result.mounted.timing.samples > 0 && result.mounted.timing.medianMs > 0, 'draw interval diagnostics capture rendered frames');
  assert.ok(result.mounted.timing.p99Ms >= result.mounted.timing.medianMs && result.mounted.timing.maxMs >= result.mounted.timing.p99Ms, 'frame-time percentiles are ordered');
  assert.ok(result.cycles.every((c) => c.suspended && c.resumed), 'repeated background events preserve both tickers');
  assert.ok(result.lateSuspended && result.lateResumed, 'a Spine loading while hidden waits for foreground');
  assert.deepEqual(result.destroyed, { renders: 0, syncs: 0 }, 'destroyed combat leaves no sync or main GPU draws');
  assert.equal(result.lateConnected, false, 'an asynchronous mount cannot revive a destroyed stage');
  console.log('OK render lifecycle:', JSON.stringify(result));
} finally { await browser.close(); }
