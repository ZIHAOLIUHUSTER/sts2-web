// Actual hand/touch state transitions, isolated from saves; run against Vite dev.
// CHROME=/usr/bin/chromium URL=http://127.0.0.1:47175/ node tools/e2e/card-continuity.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { HandView, CardNodeView, mouse, ContainerNode } = await import('/src/cardnodes.ts');
    const { G, $ } = await import('/src/game.ts');
    const originalManager = G.CombatManager.Instance;
    G.CombatManager.Instance = { IsInProgress: true, IsPlayPhase: false, PlayerActionsDisabled: false };
    const hand = new HandView();
    const model = { TargetType: G.TargetType.Self, CanPlay$0: () => false };
    const holder = hand.Add(new CardNodeView(model));
    const vector = (x, y) => new $.Vector2(x, y);
    const pose = () => holder.xf();
    const reset = () => {
      holder.Position = vector(0, -50); holder.Scale = vector(.8, .8); holder.RotationDegrees = 8;
    };
    try {
      reset();
      const beforeFocus = pose();
      holder.focus(true);
      const afterFocus = pose();
      holder.step(1 / 60);
      const hoverFirstFrame = pose();
      // Every component advances by the same fraction, without hard jumps.
      const progress = {
        y: (hoverFirstFrame.y - beforeFocus.y) / (holder.targetPos.Y + 1080 - beforeFocus.y),
        scale: (hoverFirstFrame.sx - .8) / .2,
        rotation: (hoverFirstFrame.rot - beforeFocus.rot) / -beforeFocus.rot,
      };
      const atRefreshRates = [30, 60, 120].map(fps => {
        reset();
        hand.RefreshLayout();
        for (let i = 0; i < fps / 10; i++) holder.step(1 / fps);
        return { fps, pose: pose() };
      });
      reset();
      mouse.x = pose().x; mouse.y = pose().y;
      const beforeDrag = pose();
      hand.press(holder, true);
      const afterDrag = pose();
      const touchPlay = !!hand.currentPlay;
      holder.step(1 / 60);
      const beforeCancel = pose();
      hand.currentPlay.CancelPlayCard();
      const afterCancel = pose();
      holder.focus(false);
      const beforeRelayout = pose();
      hand.RefreshLayout();
      const afterRelayout = pose();
      for (let i = 0; i < 60; i++) holder.step(1 / 60);
      const returned = { pose: pose(), target: holder.targetPos, scale: holder.targetScale };
      const ui = { PlayContainer: new ContainerNode() };
      const dead = new CardNodeView(model); dead.QueueFree();
      const { CombatUiView } = await import('/src/cardnodes.ts');
      CombatUiView.prototype.AddToPlayContainer.call(ui, dead);
      return { beforeFocus, afterFocus, hoverFirstFrame, progress, atRefreshRates, beforeDrag, afterDrag,
        touchPlay, beforeCancel, afterCancel, beforeRelayout, afterRelayout, returned, resurrected: ui.PlayContainer.$kids.length };
    } finally {
      hand.QueueFree();
      G.CombatManager.Instance = originalManager;
    }
  });
  for (const [a, b] of [['beforeFocus', 'afterFocus'], ['beforeDrag', 'afterDrag'], ['beforeCancel', 'afterCancel'], ['beforeRelayout', 'afterRelayout']]) {
    assert.deepEqual(result[a], result[b], `${a} → ${b} must preserve the visible pose`);
  }
  assert.equal(result.touchPlay, true, 'must exercise the actual touch card-play path');
  const p = Object.values(result.progress);
  assert(p.every(value => value > 0 && value < 1), 'first frame must interpolate');
  assert(Math.max(...p) - Math.min(...p) < 1e-8, 'scale, position and angle must share progress');
  const reference = result.atRefreshRates[0].pose;
  for (const sample of result.atRefreshRates) for (const key of Object.keys(reference)) {
    assert(Math.abs(sample.pose[key] - reference[key]) < 1e-8, `${key} depends on refresh rate`);
  }
  assert.equal(result.returned.pose.sx, result.returned.scale.X);
  assert.equal(result.resurrected, 0, 'freed card must not reappear through a late callback');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
