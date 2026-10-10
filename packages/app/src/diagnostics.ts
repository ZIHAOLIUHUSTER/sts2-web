/** APK performance export: measurements only, without saves, run contents or network uploads. */
import { androidApp } from './render/quality';
import { frameClockInfo } from './render/frameclock';
import { exportAndroidBackup } from './android';

const longTasks: { atMs: number; durationMs: number }[] = [];
if (androidApp && typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      longTasks.push({ atMs: entry.startTime, durationMs: entry.duration });
      if (longTasks.length > 120) longTasks.shift();
    }
  });
  observer.observe({ entryTypes: ['longtask'] });
}

export function performanceReport() {
  const w = window as Window & { Sts2Android?: { getDiagnostics?: () => string }; __render?: () => unknown };
  let native: unknown = null;
  try { native = JSON.parse(w.Sts2Android?.getDiagnostics?.() ?? 'null'); } catch { /* Older test APKs have no diagnostics API. */ }
  return {
    capturedAt: new Date().toISOString(), userAgent: navigator.userAgent,
    native, frameClock: frameClockInfo(), rendering: w.__render?.() ?? null,
    recentLongTasks: longTasks.filter(task => performance.now() - task.atMs <= 60000),
    measurementNotes: 'Draw intervals and JavaScript work are not GPU execution time. Android Window frame metrics are not game FPS. Long tasks cover the last minute (at most 120). No saves are included.',
  };
}

export async function exportPerformanceReport() {
  const name = `sts2-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const result = exportAndroidBackup(name, JSON.stringify(performanceReport(), null, 2));
  if (!result) throw new Error('Android document picker unavailable');
  await result;
}
