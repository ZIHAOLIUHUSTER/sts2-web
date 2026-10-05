// Regression: changing rooms must not evict the main canvas with an 8-context WebGL budget.
// CHROME=<path> [URL=<server>] node tools/e2e/webgl-contexts.mjs [outDir]
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const out = process.argv[2] ?? '/tmp/sts2webgl';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--max-active-webgl-contexts=8'], executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
page.on('console', (m) => { if (/Too many active WebGL contexts/.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => {
  window.__webgl = [];
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const gl = getContext.call(this, type, ...args);
    if (/webgl/.test(type) && gl && !window.__webgl.some((c) => c.gl === gl)) {
      const record = { gl, draws: 0, restores: 0 };
      window.__webgl.push(record);
      this.addEventListener('webglcontextrestored', () => record.restores++);
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (!gl[name]) continue;
        const draw = gl[name].bind(gl);
        gl[name] = (...args) => { record.draws++; return draw(...args); };
      }
    }
    return gl;
  };
});
const state = () => page.evaluate(() => {
  const contexts = window.__webgl.map(({ gl, draws, restores }) => ({
    name: gl.canvas.className, connected: gl.canvas.isConnected, lost: gl.isContextLost(), draws, restores,
  }));
  return { contexts, main: contexts.find((c) => c.name === 'view-canvas'), active: contexts.filter((c) => !c.lost).length };
});

try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=WHITEPROBE&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu');
  await startRun(page);
  for (const [i, room] of ['Monster', 'Shop', 'RestSite', 'Monster', 'Shop', 'RestSite'].entries()) {
    const result = await page.evaluate((r) => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand('room ' + r).success, room);
    assert.equal(result, true, 'enter ' + room);
    await page.waitForTimeout(3500); // wait for room transitions and asynchronous scene assets
    if (room === 'Shop') {
      await page.click('.merchant-btn');
      await page.waitForSelector('.shop-inv.open');
      await page.waitForTimeout(700);
    }
    const current = await state();
    await page.screenshot({ path: `${out}/${i}-${room}.png` });
    console.log(room, JSON.stringify(current));
    assert.equal(current.main?.connected, true, room + ': main canvas is mounted');
    assert.equal(current.main.lost, false, room + ': main canvas lost its WebGL context');
    for (const c of current.contexts.filter((c) => c.connected)) assert.equal(c.lost, false, room + ': ' + c.name);
    await page.waitForTimeout(200);
    const next = await state();
    assert.ok(next.main.draws > current.main.draws, room + ': main canvas keeps drawing');
    if (room === 'Shop') {
      assert.ok(next.contexts.find((c) => c.name.includes('shop-hand')).draws > current.contexts.find((c) => c.name.includes('shop-hand')).draws, 'shop canvas keeps drawing');
    }
  }
  const final = await state();
  assert.ok(final.contexts.some((c) => c.name.includes('shop-hand') && c.restores > 0), 'shop canvas restores on return');
  assert.ok(final.contexts.some((c) => c.name.includes('card-fx') && c.restores > 0), 'effects canvas restores on return');
  await page.locator('.rest-btn').first().click();
  await page.waitForSelector('.proceed-btn.shown');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/6-rested.png` });
  assert.equal((await state()).main.lost, false, 'campfire action preserves the main canvas');
  assert.deepEqual(errors, [], 'no browser errors or context-budget evictions');
  console.log('PASS: room changes preserve drawing and restore auxiliary canvases');
} finally {
  await browser.close();
}
