// Capture every composited transition frame, not just settled screenshots. Fresh saves only.
// CHROME=<path> URL=<server> [VIEW=1280x800] node tools/e2e/transition-flash.mjs /tmp/transitions
import { chromium } from 'playwright';
import { startRun, setAspect } from './start.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
function pixelCounts(png) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : 3;
  assert.equal(png[24], 8); assert.ok([2, 6].includes(png[25]));
  const chunks = [];
  for (let i = 8; i < png.length;) {
    const n = png.readUInt32BE(i);
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') chunks.push(png.subarray(i + 8, i + 8 + n));
    i += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let at = 0, white = 0, magenta = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pixels[i] = (raw[at++] + prediction) & 255;
    }
  }
  for (let i = 0; i < pixels.length; i += channels) {
    if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) white++;
    if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 255) magenta++;
  }
  return { white, magenta, total: width * height };
}
const out = process.argv[2] ?? '/tmp/sts2-transitions'; fs.mkdirSync(out, { recursive: true });
const [width, height] = (process.env.VIEW ?? '1280x800').split('x').map(Number);
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--max-active-webgl-contexts=8'] });
const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, serviceWorkers: 'block' });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/Too many active WebGL contexts/.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => {
  const original = HTMLCanvasElement.prototype.getContext; window.__mapGl = [];
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const gl = original.apply(this, args);
    if (gl && /^webgl/.test(args[0]) && !window.__mapGl.some((r) => r.gl === gl)) {
      const record = { gl, canvas: this, restores: 0, draws: 0 }; window.__mapGl.push(record);
      this.addEventListener('webglcontextrestored', () => record.restores++);
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        if (!gl[name]) continue;
        const originalDraw = gl[name].bind(gl);
        gl[name] = (...a) => { record.draws++; return originalDraw(...a); };
      }
    }
    return gl;
  };
});
const cdp = await page.context().newCDPSession(page);
let label = '', frames = [], flashes = [];
cdp.on('Page.screencastFrame', (e) => {
  const png = Buffer.from(e.data, 'base64'), counts = pixelCounts(png);
  const frame = { label, whiteRatio: counts.white / counts.total };
  frames.push(frame);
  if (frame.whiteRatio > 0.08) { flashes.push(frame); fs.writeFileSync(`${out}/flash-${frames.length}.png`, png); }
  void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId });
});
const capture = (name) => { label = name; return cdp.send('Page.startScreencast', { format: 'png', maxWidth: 640, maxHeight: 400, everyNthFrame: 1 }); };
const stop = () => cdp.send('Page.stopScreencast');
const command = (text) => page.evaluate((t) => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand(t).success, text);
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47175/') + '?seed=CONTINUE1&lang=zhs&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await setAspect(page);
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page); console.log('run started');
  assert.equal(await command('room Monster'), true);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 60000 });
  // Normal mode retains the actual battle/reward transition animations.
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Normal; });
  console.log('combat ready'); await capture('combat-map-toggle');
  for (let i = 0; i < 6; i++) {
    await page.click('.tb-map'); await page.waitForFunction(() => window.ui.mapOpen); await page.waitForTimeout(650);
    await page.click('.tb-map'); await page.waitForFunction(() => !window.ui.mapOpen); await page.waitForTimeout(650);
  }
  await stop();
  const detached = () => page.evaluate(() => {
    const r = window.__mapGl.find((r) => r.canvas.className.includes('map-fx'));
    return { connected: r.canvas.isConnected, draws: r.draws };
  });
  const beforeIdle = await detached(); await page.waitForTimeout(200);
  const afterIdle = await detached();
  assert.equal(afterIdle.connected, false, 'closed map canvas is detached');
  assert.equal(afterIdle.draws, beforeIdle.draws, 'resident but detached map performs no GPU draws');
  assert.equal(await command('win'), true);
  await page.waitForSelector('.rewards-screen .proceed-btn.shown', { timeout: 60000 });
  console.log('rewards ready'); await capture('battle-rewards-map');
  await page.click('.rewards-screen .proceed-btn.shown');
  await page.waitForFunction(() => window.ui.mapOpen, null, { timeout: 30000 });
  await page.waitForTimeout(1400); await stop();
  await page.screenshot({ path: `${out}/after-battle-map.png` });
  const map = await page.evaluate(() => {
    const r = window.__mapGl.find((r) => r.canvas.className.includes('map-fx'));
    return { exists: !!r, connected: r?.canvas.isConnected, lost: r?.gl.isContextLost(), restores: r?.restores };
  });
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ map, errors, flashes, frames }, null, 2));
  assert.ok(frames.filter((f) => f.label === 'combat-map-toggle').length >= 12, 'sampled toggle transition frames');
  assert.ok(frames.some((f) => f.label === 'battle-rewards-map'), 'sampled the real battle-completion transition');
  assert.equal(map.restores, 0, 'frequent map visits preserve its GPU context');
  assert.equal(map.connected, true); assert.equal(map.lost, false);
  assert.deepEqual(flashes, [], 'no large white composited frames during either transition');
  assert.deepEqual(errors, []);
  console.log('OK transition frames:', JSON.stringify({ frames: frames.length, maxWhiteRatio: Math.max(...frames.map((f) => f.whiteRatio)), map }));
} finally { await browser.close(); }
