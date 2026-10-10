// The APK host clock owns one frame; core tweens and renderer consumers share its cadence.
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function clock() {
  vi.resetModules();
  let queued: FrameRequestCallback[] = [];
  const visibility: (() => void)[] = [];
  const document = { hidden: false, addEventListener: (_name: string, fn: () => void) => visibility.push(fn) };
  vi.stubGlobal('window', { Sts2Android: {} });
  vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { queued.push(fn); return queued.length; });
  vi.stubGlobal('navigator', { userAgent: 'Android', platform: 'Linux', maxTouchPoints: 1 });
  const core = await import('../src/rt/tween');
  vi.doMock('../../app/src/game', () => ({ $: core }));
  const host = await import('../../app/src/render/frameclock');
  const step = (now: number) => { const batch = queued; queued = []; for (const fn of batch) fn(now); };
  return { host, core, step, document, visibility, pending: () => queued.length };
}
it('uses one scheduled frame and applies hit-stop once before renderer and DOM', async () => {
  const { host, core, step, pending } = await clock();
  const order: string[] = [], deltas: number[] = [];
  core.setEngineTimeScale(.25);
  core.onFrame(dt => { order.push('core'); deltas.push(dt); });
  host.onAndroidFrame(() => order.push('render'));
  host.onAndroidFrame(() => order.push('DOM'), 100);
  expect(pending()).toBe(1);
  step(100); step(100 + 1000 / 60);
  expect(order).toEqual(['core', 'render', 'DOM', 'core', 'render', 'DOM']);
  expect(deltas[1]).toBeCloseTo(1 / 240);
  core.setEngineTimeScale(0); step(100 + 2000 / 60);
  expect(deltas[2]).toBe(0);
  expect(order.slice(-2)).toEqual(['render', 'DOM']);
  expect(pending()).toBe(1);
});
it('bounds all consumers together at 30 / 60 FPS and leaves uncapped cadence alone', async () => {
  const { host, step } = await clock();
  let count = 0;
  host.onAndroidFrame(() => count++);
  for (const fps of [30, 60, 0]) {
    host.setFrameLimit(fps); count = 0;
    for (let i = 0; i < 120; i++) step(1000 + fps * 1000 + i * 1000 / 120);
    expect(count).toBe(fps || 120);
  }
});
it('pauses hidden frames and resumes without advancing by the time in background', async () => {
  const { host, core, step, document, visibility } = await clock();
  const deltas: number[] = [];
  core.onFrame(dt => deltas.push(dt));
  host.onAndroidFrame(() => {});
  step(100);
  document.hidden = true; visibility.forEach(f => f());
  step(5000); expect(deltas).toHaveLength(1);
  document.hidden = false; visibility.forEach(f => f());
  step(10000); expect(deltas[1]).toBeCloseTo(1 / 60);
});
it('leaves an ordinary Android browser on the existing core frame loop', async () => {
  vi.resetModules();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { userAgent: 'Android', platform: 'Linux', maxTouchPoints: 1 });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.push(fn); return callbacks.length; });
  const core = await import('../src/rt/tween');
  vi.doMock('../../app/src/game', () => ({ $: core }));
  const host = await import('../../app/src/render/frameclock');
  expect(host.androidFrameClock).toBe(false);
  const deltas: number[] = [];
  core.onFrame(dt => { deltas.push(dt); return false; });
  callbacks.shift()!(100);
  expect(deltas).toEqual([1 / 60]);
  expect(callbacks).toHaveLength(0);
});

it('keeps one scaled core delta when a callback changes TimeScale mid-frame', async () => {
  const { core, step } = await clock();
  const deltas: number[] = [];
  core.setEngineTimeScale(.5);
  core.onFrame(dt => { deltas.push(dt); core.setEngineTimeScale(0); return false; });
  core.onFrame(dt => { deltas.push(dt); return deltas.length < 3; });
  step(100);
  expect(deltas).toEqual([1 / 120, 1 / 120]);
  step(100 + 1000 / 60);
  expect(deltas[2]).toBe(0);
});
