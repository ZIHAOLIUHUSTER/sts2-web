// Android-path transition timing, not a device benchmark. Fresh saves; reports long tasks and rAF gaps separately.
// CHROME=<path> URL=<built preview> node tools/e2e/transition-timing.mjs /tmp/transition-timing
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/transition-timing'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 12; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', serviceWorkers: 'block' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__transitionTiming = { phase: 'menu', gaps: [], tasks: [] };
  try { new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__transitionTiming.tasks.push({ phase: window.__transitionTiming.phase, start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true }); } catch {}
  let last = 0;
  const frame = now => {
    if (last && !document.hidden && now - last > 50) window.__transitionTiming.gaps.push({ phase: window.__transitionTiming.phase, start: last, duration: now - last });
    last = now; requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => { last = 0; });
  requestAnimationFrame(frame);
});
const phases = [], cdp = await page.context().newCDPSession(page);
const mark = async name => {
  await page.evaluate(name => { window.__transitionTiming.phase = name; }, name);
  const metrics = await cdp.send('Performance.getMetrics');
  phases.push({ name, metrics: Object.fromEntries(metrics.metrics.filter(m => /TaskDuration|ScriptDuration|LayoutDuration|RecalcStyleDuration|JSHeapUsedSize/.test(m.name)).map(m => [m.name, m.value])) });
};
try {
  await cdp.send('Performance.enable');
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47174/') + '?seed=CONTINUE1&lang=zhs&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await mark('embark'); await startRun(page);
  await mark('combat-entry');
  await page.evaluate(() => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand('room Monster'));
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)', { timeout: 60000 });
  await mark('combat-idle'); await page.waitForTimeout(1500);
  await mark('victory-rewards');
  await page.evaluate(() => new window.G.DevConsole().$ctor_DevConsole(true).ProcessCommand('win'));
  await page.waitForSelector('.rewards-screen .proceed-btn.shown', { timeout: 60000 });
  await mark('rewards-map'); await page.click('.rewards-screen .proceed-btn.shown');
  await page.waitForFunction(() => window.ui.mapOpen); await page.waitForTimeout(1000);
  await mark('end');
  const result = await page.evaluate(() => ({ timing: window.__transitionTiming, renderer: window.__render?.() }));
  const report = { ...result, phases, errors, note: 'Cloud software rendering; rAF gaps are scheduling intervals, long tasks are main-thread work. Neither measures hardware display FPS or attributes resource loading by itself.' };
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('OK', JSON.stringify({ phases: phases.length, gaps: report.timing.gaps.length, longTasks: report.timing.tasks.length, renderer: result.renderer }));
} finally { await browser.close(); }
