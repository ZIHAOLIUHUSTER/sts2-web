/** APK-only process → Spine → particles/stage/render → DOM frame ordering. */
import { $ } from '../game';
import { androidApp } from './quality';
export const androidFrameClock = androidApp;
type Frame = (dt: number, now: number) => void;
const callbacks = new Map<Frame, number>();
let running = false, previous = 0, deadline = 0, fps = 60, frames = 0;
let ordered: [Frame, number][] = [];
const intervals = new Float64Array(240), work = new Float64Array(240);
let sampleCount = 0, sampleIndex = 0;
const summary = (samples: Float64Array) => {
  const values = Array.from(samples.subarray(0, sampleCount)).sort((a, b) => a - b);
  return { medianMs: values[Math.max(0, Math.ceil(values.length * .5) - 1)] ?? 0,
    p99Ms: values[Math.max(0, Math.ceil(values.length * .99) - 1)] ?? 0, maxMs: values.at(-1) ?? 0 };
};
export function setFrameLimit(limit: number) { fps = Math.max(0, limit); deadline = 0; }
export const frameClockInfo = () => ({ enabled: androidFrameClock, fps, frames, samples: sampleCount,
  interval: summary(intervals), jsWork: summary(work),
  missedBudget: Array.from(intervals.subarray(0, sampleCount)).filter(ms => ms > (fps ? 1000 / fps : 1000 / 60) * 1.5).length });
function tick(now: number) {
  requestAnimationFrame(tick);
  if (document.hidden) { previous = 0; deadline = 0; return; }
  const interval = fps > 0 ? 1000 / fps : 0;
  if (deadline && now + .1 < deadline) return;
  const hadPrevious = previous !== 0;
  const dt = previous ? Math.max(0, (now - previous) / 1000) : 1 / 60;
  previous = now;
  // Carry the remainder rather than making the next deadline relative to a late frame.
  if (interval) deadline = deadline ? deadline + Math.max(1, Math.floor((now - deadline) / interval) + 1) * interval : now + interval;
  else deadline = 0;
  frames++;
  const began = performance.now();
  for (const [fn] of ordered) {
    if (!callbacks.has(fn)) continue;
    try { fn(dt, now); } catch (error) { console.error('[Android frame]', error); }
  }
  if (hadPrevious) {
    const index = sampleIndex++ % intervals.length;
    intervals[index] = dt * 1000; work[index] = performance.now() - began;
    sampleCount = Math.min(sampleCount + 1, intervals.length);
  }
}
export function onAndroidFrame(fn: Frame, priority = 0) {
  callbacks.set(fn, priority);
  ordered = [...callbacks].sort((a, b) => a[1] - b[1]);
  if (!running) {
    running = true;
    document.addEventListener('visibilitychange', () => { previous = 0; deadline = 0; });
    requestAnimationFrame(tick);
  }
  return () => { callbacks.delete(fn); ordered = [...callbacks].sort((a, b) => a[1] - b[1]); };
}
if (androidFrameClock) $.setFrameDriver((frame: (dt: number) => void) => onAndroidFrame(frame, -100));
