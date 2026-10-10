// Real shader/component regression for idle white overlay at the unchanged default viewport.
// CHROME=/usr/bin/chromium URL=http://127.0.0.1:47178/ node tools/e2e/hurt-vignette.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route(url, r => r.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#24302b}.hurt-vignette-host{position:absolute;inset:0}canvas{width:100%;height:100%}</style><main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { h, render } = await import('/node_modules/.vite/deps/preact.js');
    const { HurtVignette } = await import('/src/ui/hurt-vignette.tsx');
    const { G, $ } = await import('/src/game.ts');
    const { view, fit } = await import('/src/view.ts');
    const saved = G.SaveManager._mockInstance;
    G.SaveManager._mockInstance = { SettingsSave: { AspectRatioSetting: G.AspectRatioSetting.SixteenByNine, FpsLimit: 60 } };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async f => { for (let i = 0; i < 200; i++) { if (f()) return; await wait(25); } throw new Error('vignette readiness timeout'); };
    render(h(HurtVignette), document.querySelector('main'));
    await until(() => document.querySelector('.hurt-vignette'));
    const canvas = document.querySelector('.hurt-vignette');
    const visibility = () => getComputedStyle(canvas).visibility;
    const sizes = [];
    try {
      for (const aspect of ['SixteenByNine', 'SixteenByTen']) {
        G.SaveManager.Instance.SettingsSave.AspectRatioSetting = G.AspectRatioSetting[aspect]; fit();
        await wait(100);
        const idle = visibility();
        const probe = document.createElement('canvas'); probe.width = canvas.width; probe.height = canvas.height;
        const ctx = probe.getContext('2d', { willReadFrequently: true });
        let visibleFrames = 0, redSamples = 0, whiteSamples = 0;
        $.setEngineTimeScale(.1); // Expand the one-second effect for reliable software-GPU sampling.
        $.ext('MegaCrit.Sts2.Core.Nodes.Vfx.PlayerHurtVignetteHelper').Play();
        const stop = $.onFrame(() => {
          if (visibility() !== 'visible') return;
          visibleFrames++;
          ctx.clearRect(0, 0, probe.width, probe.height); ctx.drawImage(canvas, 0, 0);
          const pixels = ctx.getImageData(0, 0, probe.width, probe.height).data;
          // Probe corners/edges: the active effect is a dark red border with transparent centre.
          for (const [x, y] of [[.02,.02],[.98,.02],[.02,.5],[.98,.5],[.02,.98],[.98,.98]]) {
            const i = (Math.floor(y * probe.height) * probe.width + Math.floor(x * probe.width)) * 4;
            if (pixels[i + 3] > 10 && pixels[i] > pixels[i + 1] + 20 && pixels[i] > pixels[i + 2] + 20) redSamples++;
            if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255 && pixels[i + 3] > 250) whiteSamples++;
          }
        });
        await until(() => visibility() === 'visible');
        await wait(350);
        $.setEngineTimeScale(1);
        await until(() => visibility() === 'hidden');
        stop();
        sizes.push({ aspect, logical: [view.w, view.h], idle, final: visibility(), visibleFrames, redSamples, whiteSamples });
      }
      render(null, document.querySelector('main')); await wait(100);
      return { sizes, unmounted: !canvas.isConnected && canvas.style.visibility === 'hidden' };
    } finally { $.setEngineTimeScale(1); G.SaveManager._mockInstance = saved; }
  });
  console.log(JSON.stringify(result, null, 2));
  for (const r of result.sizes) {
    assert.equal(r.idle, 'hidden', `${r.aspect}: idle canvas must never cover the room`);
    assert.equal(r.final, 'hidden', `${r.aspect}: finished effect must be hidden`);
    assert(r.visibleFrames >= 2 && r.redSamples >= 2, `${r.aspect}: active effect must render a real red border`);
    assert.equal(r.whiteSamples, 0, `${r.aspect}: effect cannot show an opaque white overlay`);
  }
  assert.deepEqual(result.sizes.map(r => r.logical), [[1920, 1080], [1920, 1200]]);
  assert(result.unmounted); assert.deepEqual(errors, []);
} finally { await browser.close(); }
