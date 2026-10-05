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

/** Events are batched: send the queue before a reload drops it, waiting at most a second. */
export function flushAnalytics(): Promise<unknown> {
  if (!enabled) return Promise.resolve();
  return Promise.race([flushBatchQueue().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
}
