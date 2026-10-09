// Check real SDF glow pixels and allocation reuse in an isolated browser; Vite dev required.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47178/';
await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    await (await import('/src/assets.ts')).loadAssetIndex();
    const { highlightImage } = await import('/src/render/highlight.ts');
    const color = [0, .957, .988, .98];
    let canvas;
    for (let i = 0; i < 200 && !canvas; i++) {
      canvas = highlightImage(.15, color, 0, 1);
      if (!canvas) await new Promise(r => setTimeout(r, 25));
    }
    if (!canvas) throw new Error('real highlight SDF did not load');
    const context = canvas.getContext('2d');
    let allocations = 0;
    const create = context.createImageData.bind(context);
    context.createImageData = (...args) => { allocations++; return create(...args); };
    for (let i = 1; i <= 60; i++) highlightImage(.15, color, i, 1 + i / 60);
    const reused = highlightImage(.03, color, 61, 2).getContext('2d').getImageData(0, 0, 256, 256).data;
    // A fresh module generates a new canvas/buffer for exactly the same visual state.
    const fresh = await import('/src/render/highlight.ts?fresh-buffer-check');
    let reference;
    for (let i = 0; i < 200 && !reference; i++) {
      reference = fresh.highlightImage(.03, color, 61, 2);
      if (!reference) await new Promise(r => setTimeout(r, 25));
    }
    if (!reference) throw new Error('reference SDF did not load');
    const pixels = reference.getContext('2d').getImageData(0, 0, 256, 256).data;
    return { allocations, equalPixels: reused.every((value, i) => value === pixels[i]), visible: pixels.some(value => value > 0) };
  });
  assert.equal(result.allocations, 0, 'pooled glow must not allocate pixel buffers each frame');
  assert.equal(result.equalPixels, true, 'shrinking glow must match fresh pixels without stale alpha');
  assert.equal(result.visible, true, 'test must exercise visible real glow');
  console.log('OK', result);
} finally { await browser.close(); }
