// APK-specific lazy GL allocation, real border pixels and overlay retirement. Isolated from saves.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47179/';
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.Sts2Android = {}; });
await page.route(url, r => r.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#24302b}canvas{width:100%;height:100%}</style><main></main><div id="fx"></div>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { h, render } = await import('/node_modules/.vite/deps/preact.js');
    const { HurtVignette } = await import('/src/ui/hurt-vignette.tsx');
    const { CardFxCanvas, globalVfxRoot } = await import('/src/render/cardfx.ts');
    const { Sprite, Texture } = await import('/node_modules/.vite/deps/pixi__js.js');
    const { G, $ } = await import('/src/game.ts');
    const { frameClockInfo } = await import('/src/render/frameclock.ts');
    const saved = G.SaveManager._mockInstance;
    G.SaveManager._mockInstance = { SettingsSave: { AspectRatioSetting: G.AspectRatioSetting.SixteenByNine, FpsLimit: 60 } };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async f => { for (let i = 0; i < 240; i++) { if (f()) return; await wait(25); } throw new Error('FX readiness timeout'); };
    const glCanvases = new Set();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (/^webgl/.test(type) && context) glCanvases.add(this);
      return context;
    };
    let fx;
    try {
      render(h(HurtVignette), document.querySelector('main'));
      fx = new CardFxCanvas('global', () => true);
      await fx.mount(document.querySelector('#fx'));
      await wait(200);
      const idle = { contexts: glCanvases.size, canvases: document.querySelectorAll('canvas').length, rootPublished: !!globalVfxRoot() };
      // First hit must survive shader/renderer initialization rather than being dropped.
      $.setEngineTimeScale(.1);
      $.ext('MegaCrit.Sts2.Core.Nodes.Vfx.PlayerHurtVignetteHelper').Play();
      await until(() => document.querySelector('.hurt-vignette')?.style.visibility === 'visible');
      const hurt = document.querySelector('.hurt-vignette');
      const probe = document.createElement('canvas'); probe.width = hurt.width; probe.height = hurt.height;
      const ctx = probe.getContext('2d');
      let red = 0, white = 0;
      const stopProbe = $.onFrame(() => {
        if (hurt.style.visibility !== 'visible') return;
        ctx.clearRect(0, 0, probe.width, probe.height); ctx.drawImage(hurt, 0, 0);
        const p = ctx.getImageData(0, 0, probe.width, probe.height).data;
        for (const [x,y] of [[.02,.02],[.98,.02],[.02,.5],[.98,.5]]) {
          const i=(Math.floor(y*probe.height)*probe.width+Math.floor(x*probe.width))*4;
          if(p[i+3]>10 && p[i]>p[i+1]+20 && p[i]>p[i+2]+20)red++;
          if(p[i]===255 && p[i+1]===255 && p[i+2]===255 && p[i+3]>250)white++;
        }
      });
      await wait(350); stopProbe();
      $.setEngineTimeScale(1);
      await until(() => hurt.style.visibility === 'hidden');
      const afterHurt = glCanvases.size;
      const sprite = new Sprite(Texture.WHITE); sprite.tint=0xff0000; sprite.width=100; sprite.height=100;
      globalVfxRoot().addChild(sprite);
      await until(() => document.querySelector('#fx canvas')?.style.visibility === 'visible');
      const overlay = document.querySelector('#fx canvas');
      // Count actual GPU draw calls on this context after the only object has retired.
      const gl=overlay.getContext('webgl2') ?? overlay.getContext('webgl');
      let draws=0;
      for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
        if(!gl[name])continue; const fn=gl[name].bind(gl); gl[name]=(...args)=>{draws++;return fn(...args);};
      }
      await wait(100); const activeDraws=draws;
      sprite.destroy();
      await until(() => overlay.style.visibility==='hidden');
      const settledDraws=draws; await wait(200);
      const idleDraws=draws-settledDraws;
      const contexts = glCanvases.size;
      fx.destroy(); fx=null; render(null,document.querySelector('main')); await wait(100);
      return { idle, afterHurt, contexts, red, white, activeDraws, idleDraws, clock: frameClockInfo(), detached: !hurt.isConnected && !overlay.isConnected };
    } finally { fx?.destroy(); $.setEngineTimeScale(1); G.SaveManager._mockInstance=saved; HTMLCanvasElement.prototype.getContext=getContext; }
  });
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.idle.contexts, 0); assert.equal(result.idle.canvases, 0); assert(result.idle.rootPublished);
  // Pixi may create its own compatibility-probe context on the first renderer; overlay adds exactly one after that.
  assert.equal(result.contexts, result.afterHurt + 1);
  assert(result.red > 0); assert.equal(result.white, 0); assert(result.activeDraws > 0); assert.equal(result.idleDraws, 0);
  assert(result.clock.enabled && result.clock.frames > 0);
  assert(result.detached); assert.deepEqual(errors, []);
} finally { await browser.close(); }
