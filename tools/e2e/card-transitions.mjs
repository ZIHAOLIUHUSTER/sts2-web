// Success/reparent, selected cards, replay feedback and shuffle phase regression. Isolated Vite browser.
// CHROME=/usr/bin/chromium URL=http://127.0.0.1:47178/ node tools/e2e/card-transitions.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { G, $, N } = await import('/src/game.ts');
    const { HandView, CardNodeView, ContainerNode, ShuffleFlyVfx, CardFlyVfx, CardFlyPowerVfx } = await import('/src/cardnodes.ts');
    const roomClass = N('Rooms.NCombatRoom'), oldRoom = roomClass.Instance, oldCm = G.CombatManager.Instance;
    const gameClass = N('NGame'), oldMainThread = gameClass.IsMainThread;
    gameClass.IsMainThread = () => true;
    G.CombatManager.Instance = { IsInProgress: false, IsPlayPhase: false, PlayerActionsDisabled: false };
    const hand = new HandView(), play = new ContainerNode(23, 14), queue = new ContainerNode(-18, 10);
    const callbacks = [];
    queue.RemoveCardFromQueueForExecution = () => callbacks.push('queue-remove');
    roomClass.Instance = { Ui: { Hand: hand, PlayQueue: queue, PlayContainer: play }, GetCreatureNode: () => null };
    const vector = (x, y) => new $.Vector2(x, y);
    const model = () => ({ CanPlay$0: () => false });
    const difference = (a, b) => Math.max(...Object.keys(a).map(key => Math.abs(a[key] - b[key])));
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      const card = new CardNodeView(model()), holder = hand.Add(card);
      holder.Position = vector(-200, -230); holder.Scale = vector(.75, .72); holder.Rotation = .15;
      card.Scale = vector(.96, .94); card.Rotation = -.02;
      const before = card.xf();
      const previous = new $.WebTween();
      previous.TweenProperty(card, 'position', vector(1600, 150), .25);
      previous.Parallel().TweenProperty(card, 'scale', vector(.8, .8), .25);
      previous.Chain().TweenCallback(() => callbacks.push('old-tween-finished'));
      card.PlayPileTween = previous;
      G.CardPileCmd.MoveCardNodeToNewPileBeforeTween(card, G.PileType.Play);
      const after = card.xf();
      const manual = { delta: difference(before, after), parent: card.$parent === play, removed: hand.Holders.length === 0 };
      await wait(230);
      manual.settledRotation = card.Rotation;
      card.Reparent(queue);
      const queuedBefore = card.xf();
      G.CardPileCmd.MoveCardNodeToNewPileBeforeTween(card, G.PileType.Play);
      const queued = { delta: difference(queuedBefore, card.xf()), parent: card.$parent === play };
      const beforeReturn = card.xf();
      const returnedHolder = hand.Add(card);
      const returned = { delta: difference(beforeReturn, card.xf()) };
      const selectedBefore = card.xf();
      const selected = hand.SelectedHandCardContainer.Add(returnedHolder);
      hand.RemoveCardHolder(returnedHolder);
      const selection = { delta: difference(selectedBefore, card.xf()) };
      const focusBefore = selected.xf(); selected.focus(true);
      selection.focusDelta = difference(focusBefore, selected.xf());
      const rowBefore = selected.xf();
      const second = hand.Add(new CardNodeView(model()));
      hand.SelectedHandCardContainer.Add(second); hand.RemoveCardHolder(second);
      selection.rowDelta = difference(rowBefore, selected.xf());
      await wait(250);
      selection.settled = { x: selected.Position.X, rotation: card.Rotation, scale: card.Scale.X };
      const samples = [];
      const stop = $.onFrame(() => { samples.push(card.Body.Scale.X); });
      card.PlayRandomizeCostAnim(); await wait(210);
      const costPulse = { peak: Math.max(...samples), end: card.Body.Scale.X };
      samples.length = 0;
      const replayResult = card.AnimMultiCardPlay(); await wait(210);
      const replayPulse = { peak: Math.max(...samples), end: card.Body.Scale.X, nonBlocking: replayResult === $.Task.CompletedTask };
      stop();
      const silhouette = new ShuffleFlyVfx(vector(20, 900), vector(1800, 900), 'missing', { InvokeCardAddFinished() { callbacks.push('shuffle-arrived'); } });
      let currentScale = silhouette.Scale, firstShrink = null;
      Object.defineProperty(silhouette, 'Scale', { get: () => currentScale, set(value) {
        if (firstShrink === null && value.X < 1) firstShrink = { from: currentScale.X, to: value.X };
        currentScale = value;
      } });
      const vfxRoot = new ContainerNode(); vfxRoot.AddChild(silhouette);
      for (let i = 0; i < 100 && firstShrink === null; i++) await wait(25);
      silhouette.QueueFree(); ShuffleFlyVfx.all.delete(silhouette);
      // Drive the actual VFX frame callbacks deterministically, including their asynchronous frame waits.
      let advance;
      $.setFrameDriver(callback => { advance = callback; return () => {}; });
      const step = async dt => { advance(dt); await Promise.resolve(); await Promise.resolve(); };
      const discardCard = new CardNodeView(model());
      discardCard.Body.Scale = vector(1.06, 1.04);
      const discard = new CardFlyVfx(discardCard, vector(1800, 900), false, 'ironclad');
      discard.$entered();
      await step(.001);
      const discardFirstScale = { x: discardCard.Body.Scale.X, y: discardCard.Body.Scale.Y };
      discardCard.QueueFree();
      const powerCard = new CardNodeView({ Owner: { Creature: {}, Character: { TrailPath: 'ironclad' } } });
      const power = new CardFlyPowerVfx(powerCard);
      power.curve = { total: 300, sample: () => ({ x: 0, y: 0, rot: 0 }) };
      let finishTrail;
      power.trail = { track() {}, FadeOut: () => new Promise(resolve => { finishTrail = resolve; }) };
      const powerTask = power.PlayAnim(), powerScales = [];
      for (let i = 0; i < 50; i++) { await step(.01); powerScales.push(powerCard.Scale.X); }
      finishTrail(); await powerTask;
      $.setFrameDriver(null);
      for (const trail of (await import('/src/cardnodes.ts')).TrailVfx.all) trail.free();
      return { manual, queued, returned, selection, callbacks, costPulse, replayPulse, firstShrink, discardFirstScale, powerScales };
    } finally { hand.QueueFree(); play.QueueFree(); queue.QueueFree(); roomClass.Instance = oldRoom; G.CombatManager.Instance = oldCm; gameClass.IsMainThread = oldMainThread; }
  });
  console.log(JSON.stringify(result, null, 2));
  for (const key of ['manual', 'queued', 'returned']) assert(result[key].delta < 1e-8, `${key} must preserve visible transform`);
  assert(result.manual.parent && result.manual.removed && result.queued.parent);
  assert(Math.abs(result.manual.settledRotation) < 1e-8, 'preserved tilt must settle smoothly to the play pose');
  assert.deepEqual(result.callbacks.slice(0, 2), ['old-tween-finished', 'queue-remove'], 'original callbacks/order must survive');
  assert(result.selection.delta < 1e-8 && result.selection.focusDelta < 1e-8 && result.selection.rowDelta < 1e-8);
  assert(Math.abs(result.selection.settled.x + 150) < .001);
  assert(Math.abs(result.selection.settled.rotation) < .001);
  for (const pulse of [result.costPulse, result.replayPulse]) { assert(pulse.peak > 1.01); assert.equal(pulse.end, 1); }
  assert(result.replayPulse.nonBlocking, 'feedback must not change rule timing');
  assert(result.firstShrink && result.firstShrink.from === 1 && result.firstShrink.to > .6, 'shuffle phase must not snap 1→0.1');
  assert(result.discardFirstScale.x > 1.05 && result.discardFirstScale.y > 1.03, 'discard must continue the visible feedback scale');
  assert.equal(result.powerScales.at(-1), 0, 'completed power shrink must remain zero during its trail fade');
  assert(result.powerScales.every((scale, i, all) => i === 0 || scale <= all[i - 1] + 1e-8), 'short power flights must not rebound from competing scale tweens');
  const finalShrink = result.powerScales.findIndex(scale => scale === 0);
  assert(finalShrink > 0 && Math.abs(result.powerScales[finalShrink - 1] - .1) < 1e-6, 'short power flights must reach .1 before their final shrink, rather than pop from a large card');
} finally { await browser.close(); }
