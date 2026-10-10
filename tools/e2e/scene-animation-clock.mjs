// Isolated real scene renderer: original Spine mix and elapsed flipbook engine time.
// Uses a deterministic rAF clock, real asset textures/Spine, and a fresh browser without game saves.
// CHROME=<path> URL=<Vite dev> node tools/e2e/scene-animation-clock.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47175/';
await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const callbacks = new Map(); let id = 0, now = 1000, hidden = false;
    window.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = token => callbacks.delete(token);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const step = delta => { now += delta; const scheduled = [...callbacks.values()]; callbacks.clear(); scheduled.forEach(callback => callback(now)); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const { loadAssetIndex } = await import('/src/assets.ts');
    const { loadScene, buildScene, sceneReady, sceneTexture, playSpriteVfx } = await import('/src/render/scene.ts');
    const { $ } = await import('/src/game.ts');
    const { Container } = await import('/node_modules/.vite/deps/pixi__js.js');
    await loadAssetIndex();
    const source = await loadScene('scenes/merchant/characters/defect_merchant.tscn');
    const item = source.items.find(item => item.k === 'spine');
    const scene = buildScene({ ...source, items: [item] }); await sceneReady(scene);
    const sp = scene.children[0].children.find(child => child.skeleton);
    const names = sp.skeleton.data.animations.map(animation => animation.name);
    const next = names.find(name => name !== sp.state.getCurrent(0)?.animation?.name);
    if (!next) throw new Error('real scene needs two animation states');
    sp.update(1 / 60); // A never-applied initial track is legitimately replaced without mixing.
    const mix = sp.state.setAnimation(0, next, false).mixDuration;
    const appliedMix = sp.state.data.defaultMix;
    const block = await loadScene('scenes/vfx/vfx_block.tscn');
    const sequence = block.items.find(item => item.anim?.frames);
    const textures = await Promise.all(sequence.anim.frames.map(path => sceneTexture(path)));
    const parent = new Container();
    const begin = async () => {
      await playSpriteVfx(parent, 'vfx/vfx_block', 0, 0);
      for (let i = 0; i < 100; i++) {
        const root = parent.children.at(-1), holder = root?.children.find(child => child.children?.[0]?.texture === textures[0]);
        if (holder) return { root, sprite: holder.children[0] };
        await wait(20);
      }
      throw new Error('real flipbook did not load');
    };
    const index = sprite => textures.indexOf(sprite.texture);
    const first = await begin(); step(0); step(100);
    const normal = index(first.sprite); step(200); const skipped = index(first.sprite); step(100);
    const completed = first.root.destroyed;
    $.setEngineTimeScale(0.1);
    const slow = await begin(); step(0); step(100); const slowStart = index(slow.sprite);
    step(600); const slowed = index(slow.sprite);
    hidden = true; document.dispatchEvent(new Event('visibilitychange')); step(1000); const background = index(slow.sprite);
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); step(1000); const resumed = index(slow.sprite);
    $.setEngineTimeScale(1); step(100); const continued = index(slow.sprite);
    scene.destroy({ children: true }); parent.destroy({ children: true }); step(0);
    return { expectedMix: item.spine.mix, appliedMix, transitionMix: mix,
      normal, skipped, completed, slowStart, slowed, background, resumed, continued };
  });
  assert.equal(result.expectedMix, 0.1); assert.equal(result.appliedMix, result.expectedMix); assert.equal(result.transitionMix, result.expectedMix);
  assert.equal(result.normal, 1); assert.equal(result.skipped, 4); assert.equal(result.completed, true);
  assert.equal(result.slowStart, 0); assert.equal(result.slowed, 1); assert.equal(result.background, result.slowed);
  assert.equal(result.resumed, result.slowed); assert.ok(result.continued > result.resumed);
  console.log('OK scene mix + flipbook clock', JSON.stringify(result));
} finally { await browser.close(); }
