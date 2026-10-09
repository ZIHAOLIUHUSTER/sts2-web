// Diagnostic, not a phone benchmark. Fresh browser profile; never touches an installed APK's saves.
// CHROME=<chromium> URL=http://127.0.0.1:47174/ [SAMPLE_MS=3000] node tools/e2e/mobile-performance.mjs /tmp/mobile-perf
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startRun, travel, viewport, setAspect } from './start.mjs';

const out = process.argv[2] ?? '/tmp/sts2-mobile-performance';
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync('assets/manifest.json', 'utf8'));
const images = new Map(manifest.textures.filter((t) => !t.error).map((t) => [t.out, t]));
const atlasPages = fs.readdirSync('assets/atlases').filter((p) => p.endsWith('.json')).map((p) => {
  const j = JSON.parse(fs.readFileSync(path.join('assets/atlases', p), 'utf8'));
  return { out: 'atlases/' + j.meta.image, w: j.meta.size.w, h: j.meta.size.h };
});
for (const p of atlasPages) images.set(p.out, p);
const bytes = (t) => t.w * t.h * 4;
const inventory = {
  note: 'RGBA base-level estimate if every asset loaded; NOT resident memory. Excludes Spine pages, mips and browser copies.',
  standaloneCount: manifest.textures.filter((t) => !t.error).length,
  standaloneRgbaBytes: manifest.textures.filter((t) => !t.error).reduce((n, t) => n + bytes(t), 0),
  atlasCount: atlasPages.length, atlasRgbaBytes: atlasPages.reduce((n, t) => n + bytes(t), 0),
  largest: [...images.values()].sort((a, b) => bytes(b) - bytes(a)).slice(0, 20),
};
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', serviceWorkers: 'block' });
const cdp = await page.context().newCDPSession(page);
const errors = [], requested = new Set();
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  const p = new URL(r.url()).pathname.split('/assets/')[1];
  if (p) requested.add(decodeURIComponent(p));
});
// Approximate currently allocated WebGL texture base levels. No readback; preserve upload arguments and results.
await page.addInitScript(() => {
  const contexts = [], patched = new WeakSet();
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const gl = original.apply(this, args);
    if (!gl || !/^webgl/.test(args[0]) || patched.has(gl)) return gl;
    patched.add(gl);
    const textures = new Map(), bound = new Map();
    const record = { gl, canvas: this, textures };
    contexts.push(record);
    const bind = gl.bindTexture;
    gl.bindTexture = function (target, tex) { bound.set(target, tex); return bind.apply(this, arguments); };
    const upload = gl.texImage2D;
    gl.texImage2D = function (...a) {
      const result = upload.apply(this, a);
      const source = a.length === 6 ? a[5] : null;
      const w = source ? source.videoWidth || source.naturalWidth || source.width : a[3];
      const h = source ? source.videoHeight || source.naturalHeight || source.height : a[4];
      const target = a[0] >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && a[0] <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? gl.TEXTURE_CUBE_MAP : a[0];
      if (a[1] === 0 && bound.get(target) && w && h) textures.set(bound.get(target), { width: w, height: h, rgbaBytes: w * h * 4 });
      return result;
    };
    if (gl.texStorage2D) {
      const storage = gl.texStorage2D;
      gl.texStorage2D = function (...a) {
        const result = storage.apply(this, a);
        if (bound.get(a[0])) textures.set(bound.get(a[0]), { width: a[3], height: a[4], rgbaBytes: a[3] * a[4] * 4 });
        return result;
      };
    }
    const remove = gl.deleteTexture;
    gl.deleteTexture = function (tex) { textures.delete(tex); return remove.apply(this, arguments); };
    return gl;
  };
  window.__performanceTextures = () => contexts.filter((c) => !c.gl.isContextLost()).map((c) => {
    const info = c.gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: info ? c.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : c.gl.getParameter(c.gl.RENDERER),
      canvas: [c.canvas.width, c.canvas.height], mounted: c.canvas.isConnected,
      textureCount: c.textures.size, rgbaBaseBytes: [...c.textures.values()].reduce((n, t) => n + t.rgbaBytes, 0) };
  });
});
const snapshots = [];
async function sample(name) {
  await page.waitForTimeout(1000);
  const frame = await page.evaluate(async (ms) => {
    const values = []; let last = performance.now(); const start = last;
    await new Promise((resolve) => { const tick = (now) => {
      values.push(now - last); last = now;
      if (now - start >= ms) resolve(); else requestAnimationFrame(tick);
    }; requestAnimationFrame(tick); });
    values.sort((a, b) => a - b);
    return { durationMs: last - start, count: values.length, medianMs: values[Math.floor(values.length / 2)],
      p95Ms: values[Math.floor(values.length * 0.95)], over50Ms: values.filter((n) => n > 50).length };
  }, Number(process.env.SAMPLE_MS ?? 3000));
  const beforeGc = await cdp.send('Runtime.getHeapUsage');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const game = await page.evaluate(() => ({ screen: window.ui?.screen, mapOpen: window.ui?.mapOpen,
    audio: window.__audio?.(), gpu: window.__performanceTextures(), memory: navigator.deviceMemory, cores: navigator.hardwareConcurrency }));
  const fetched = [...requested].flatMap((p) => images.has(p) ? [{ path: p, ...images.get(p) }] : []);
  const snapshot = { name, heapBeforeGc: beforeGc, heapAfterGc: heap, dom, frame, game,
    requestedImageCount: fetched.length, requestedImageRgbaBytes: fetched.reduce((n, t) => n + bytes(t), 0),
    note: 'Requested image bytes are cumulative resource working-set estimates, not measured resident/GPU memory; JS heap excludes audio and graphics.' };
  snapshots.push(snapshot);
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ inventory, snapshots, errors }, null, 2));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify({ heapMiB: heap.usedSize / 1048576, requestedImageMiB: snapshot.requestedImageRgbaBytes / 1048576,
    audioMiB: (game.audio?.cache?.bytes ?? 0) / 1048576, gpu: game.gpu, frame }));
}
try {
  await cdp.send('Performance.enable');
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47174/') + '?seed=CONTINUE1&lang=zhs&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await setAspect(page);
  await sample('menu');
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  await sample('first-map');
  await travel(page);
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 30000 });
  await sample('combat');
  for (let i = 1; i <= 3; i++) {
    await page.click('.tb-map');
    await page.waitForFunction(() => window.ui.mapOpen);
    await sample(`map-${i}`);
    await page.click('.tb-map');
    await page.waitForFunction(() => !window.ui.mapOpen);
    await sample(`combat-${i}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
