// A reparented card must have its full pose before the first browser paint, even with the frame driver stalled.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { initAndroid } from './start.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ serviceWorkers: 'block' });
await initAndroid(page);
const url = process.env.URL ?? 'http://127.0.0.1:47179/';
await page.route(url, r => r.fulfill({ contentType: 'text/html', body: '<main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { h, render } = await import('/node_modules/.vite/deps/preact.js');
    const { CardLayer } = await import('/src/ui/cardlayer.tsx');
    const loaded = path => performance.getEntriesByType('resource').map(e => e.name).filter(u => u.split('?')[0] === location.origin + path).at(-1) ?? path;
    const { $, G } = await import(loaded('/src/game.ts'));
    const { ContainerNode, CardNodeView } = await import(loaded('/src/cardnodes.ts'));
    $.setFrameDriver(() => () => {}); // Deliberately never deliver another animation frame.
    const hand = new ContainerNode(600, 800), play = new ContainerNode(100, 40);
    const card = new CardNodeView({ Id: { Entry: 'FIRST_PAINT' }, CanPlay$0: () => false, Type: G.CardType.Skill, Rarity: G.CardRarity.Common });
    card.Position = new $.Vector2(30, -50); card.Scale = new $.Vector2(.75, .8);
    card.Rotation = .2; card.Body.Scale = new $.Vector2(.9, .9); card.Modulate = new $.Color(.7, .7, .7, .6);
    hand.AddChild(card);
    const mount = () => render(h('div', {}, h(CardLayer, {root:hand}), h(CardLayer, {root:play})), document.querySelector('main'));
    const read = () => {
      const el = document.querySelector('.card-node'), body = el.querySelector('.card-body');
      return { transform:el.style.transform, opacity:el.style.opacity, body:body.style.transform, brightness:body.style.filter };
    };
    mount(); const initial = read();
    card.Reparent(play); mount(); const reparented = read();
    render(null, document.querySelector('main')); hand.QueueFree(); play.QueueFree();
    return {initial,reparented};
  });
  console.log(JSON.stringify(result));
  for (const pose of [result.initial,result.reparented]) {
    assert.match(pose.transform, /translate\(630px, 750px\)/);
    assert.match(pose.transform, /rotate\(0\.2rad\).*scale\(0\.75, 0\.8\)/);
    assert.equal(pose.opacity, '0.6'); assert.equal(pose.body, 'scale(0.9, 0.9)');
    assert.equal(pose.brightness, 'brightness(0.7)');
  }
} finally { await browser.close(); }
