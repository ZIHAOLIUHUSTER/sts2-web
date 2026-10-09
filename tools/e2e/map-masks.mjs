// Map mask regression: real UI and assets, including the prefixed CSS required by WebView < 120.
// CHROME=<path> URL=<server> node tools/e2e/map-masks.mjs <outDir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
// Read Chromium's 8-bit RGB/RGBA PNG screenshots without adding an image dependency.
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
const out = process.argv[2] ?? '/tmp/sts2-map-masks';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const [width, height] = (process.env.VIEW ?? '1280x800').split('x').map(Number);
const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
// Model an older WebView: ignore standard inline maskImage writes. The WebKit write must still render.
await page.addInitScript(() => {
  // CSSStyleDeclaration has exotic named setters: overriding its prototype setter does not
  // reliably intercept writes in production Chromium. Proxy the element's style getter instead.
  const proto = HTMLElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'style');
  if (!descriptor?.get) throw new Error('style descriptor unavailable');
  const proxies = new WeakMap();
  window.blockedStandardMasks = 0;
  Object.defineProperty(proto, 'style', { ...descriptor, get() {
    const style = descriptor.get.call(this);
    if (!proxies.has(style)) proxies.set(style, new Proxy(style, {
      set(target, key, value) {
        if (key === 'maskImage') { window.blockedStandardMasks++; return true; }
        return Reflect.set(target, key, value, target);
      },
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }));
    return proxies.get(style);
  } });
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=CONTINUE1&unlock=all&tutorials=off&lang=zhs');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  await page.waitForTimeout(800);
  const masks = await page.evaluate(async () => {
    const els = [...document.querySelectorAll('.mp-outline,.mp-anc-outline,.mp-anc-img,.mp-boss-outline,.mp-boss-img,.md-icon')];
    return Promise.all(els.map(async el => {
      const style = getComputedStyle(el);
      const image = style.getPropertyValue('-webkit-mask-image');
      const src = image.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
      if (!src) return { cls: el.className, error: 'missing mask URL' };
      const img = new Image(); img.src = src; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let visible = 0, transparent = 0;
      for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) visible++; else transparent++; }
      return { cls: el.className, size: style.getPropertyValue('-webkit-mask-size'), repeat: style.getPropertyValue('-webkit-mask-repeat'), position: style.getPropertyValue('-webkit-mask-position'), visible, transparent };
    }));
  });
  assert.ok(masks.length > 10, 'exercise the complete map');
  assert.ok(await page.evaluate(() => window.blockedStandardMasks) > 10, 'standard mask writes were disabled; only the WebKit prefix can render');
  for (const mask of masks) {
    assert.ok(!mask.error, JSON.stringify(mask));
    assert.equal(mask.size, 'contain', `${mask.cls}: WebKit size`);
    assert.equal(mask.repeat, 'no-repeat', `${mask.cls}: WebKit repeat`);
    assert.equal(mask.position, '50% 50%', `${mask.cls}: WebKit position`);
    assert.ok(mask.visible > 0 && mask.transparent > 0, `${mask.cls}: real image must have visible art and transparent edges`);
  }
  assert.equal(masks.filter(m => m.cls === 'md-icon').length, 3);
  assert.ok(masks.some(m => m.cls === 'mp-anc-img'), 'ancient/start mask');
  assert.ok(masks.some(m => m.cls === 'mp-boss-img'), 'boss mask');
  // Render each mask alone over white. A missing mask produces a solid magenta square,
  // while a missing image produces no magenta. Check real compositor pixels for both failures.
  for (const selector of ['.mp-anc-img', '.mp-boss-img', '.md-draw .md-icon', '.md-erase .md-icon', '.md-clear .md-icon', '.mp-outline']) {
    await page.evaluate(selector => {
      const el = document.querySelector(selector), computed = getComputedStyle(el);
      const box = document.createElement('div'); box.id = 'mask-pixel-fixture';
      Object.assign(box.style, { position: 'fixed', left: '0', top: '0', width: '128px', height: '128px', background: '#fff', zIndex: '2147483647' });
      const art = document.createElement('div');
      Object.assign(art.style, { width: '128px', height: '128px', background: '#f0f', WebkitMaskImage: computed.getPropertyValue('-webkit-mask-image'), WebkitMaskSize: 'contain', WebkitMaskPosition: 'center', WebkitMaskRepeat: 'no-repeat' });
      box.append(art); document.body.append(box);
    }, selector);
    await page.waitForTimeout(50);
    const name = selector.replace(/[^a-z]/g, '');
    const png = await page.locator('#mask-pixel-fixture').screenshot({ path: `${out}/${name}-prefix-only.png` });
    const pixels = pixelCounts(png);
    assert.ok(pixels.white > pixels.total * .05, `${selector}: actual transparent area, not a solid rectangle`);
    assert.ok(pixels.magenta > pixels.total * .01, `${selector}: actual visible artwork`);
    await page.evaluate(() => document.getElementById('mask-pixel-fixture').remove());
  }
  await page.screenshot({ path: `${out}/map-start.png` });
  // ScrollHelper treats a whole-number delta as one notch, irrespective of its magnitude.
  await page.evaluate(() => {
    const map = document.querySelector('.map-screen');
    for (let i = 0; i < 40; i++) map.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100, deltaMode: 1 }));
  });
  // Await rubber-band settling rather than a wall-clock delay on software-rendered test hosts.
  await page.waitForFunction(() => {
    const el = document.querySelector('.mp-boss');
    const stage = document.querySelector('.stage-root').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= stage.top + 80 && r.bottom < stage.bottom;
  }, null, { timeout: 30000 });
  await page.screenshot({ path: `${out}/map-boss.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ masks: masks.length, tools: 3, ancient: true, boss: true, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
