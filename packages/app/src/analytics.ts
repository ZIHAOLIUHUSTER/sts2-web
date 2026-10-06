import { initTianjiTracker, reportWebsiteEvent } from 'tianji-client-sdk';
import { flushBatchQueue } from 'tianji-client-sdk/lib/tracker/pure';

// Keep local development, previews and e2e runs out of production analytics.
const enabled = !['127.0.0.1', 'localhost'].includes(location.hostname);

export function initAnalytics() {
  if (!enabled) return;
  void initTianjiTracker({
    url: 'https://app.tianji.dev',
    websiteId: 'cmupjzwk6wm425xc7qmgk89dy',
  }).catch((error) => console.warn('[analytics] initialization failed', error));
}

export function reportEvent(name: string, data?: Record<string, unknown>) {
  if (!enabled) return;
  void reportWebsiteEvent(name, data)
    .catch((error) => console.warn(`[analytics] ${name} failed`, error));
}

const reported = new Set<string>();
/** An error, once per message and at most five per page load. */
export function reportError(kind: string, error: unknown) {
  const e = error as { message?: unknown; stack?: unknown } | null | undefined;
  const message = String(e?.message ?? error).slice(0, 300);
  if (reported.size >= 5 || reported.has(message)) return;
  reported.add(message);
  reportEvent('js_error', { kind, message, stack: String(e?.stack ?? '').slice(0, 500) });
}

const ALIVE = 'sts2web.alive';
/**
 * A page the system kills for memory gets no pagehide and throws nothing (in-app browsers show a white page, Safari
 * reloads): while the game is visible a mark records what it was doing, and one left at the next start is reported.
 * Hidden pages clear the mark, so a background tab the system discards does not count.
 */
export function trackUncleanExits(state: () => Record<string, unknown>) {
  if (!enabled) return;
  try {
    const prev = localStorage.getItem(ALIVE);
    if (prev) reportEvent('unclean_exit', JSON.parse(prev));
  } catch { /* storage blocked or the mark unreadable */ }
  const mark = () => {
    try { localStorage.setItem(ALIVE, JSON.stringify({ ...state(), uptime: Math.round(performance.now() / 1000), build: __BUILD_ID__ })); } catch { /* storage full or blocked */ }
  };
  const clear = () => { try { localStorage.removeItem(ALIVE); } catch { /* storage blocked */ } };
  mark();
  setInterval(() => { if (!document.hidden) mark(); }, 5000);
  document.addEventListener('visibilitychange', () => (document.hidden ? clear() : mark()));
  window.addEventListener('pagehide', clear);
  window.addEventListener('pageshow', (e) => { if (e.persisted) mark(); });
}

/** Events are batched: send the queue before a reload drops it, waiting at most a second. */
export function flushAnalytics(): Promise<unknown> {
  if (!enabled) return Promise.resolve();
  return Promise.race([flushBatchQueue().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
}
