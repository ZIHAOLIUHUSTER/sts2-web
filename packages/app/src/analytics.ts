import { initTianjiTracker, reportWebsiteEvent } from 'tianji-client-sdk';

// Keep local development, previews and e2e runs out of production analytics.
const enabled = !['127.0.0.1', 'localhost'].includes(location.hostname);

export function initAnalytics() {
  if (!enabled) return;
  void initTianjiTracker({
    url: 'https://app.tianji.dev',
    websiteId: 'cmupjzwk6wm425xc7qmgk89dy',
  }).catch((error) => console.warn('[analytics] initialization failed', error));
}

export function reportRunEnd(result: 'victory' | 'defeat') {
  if (!enabled) return;
  void reportWebsiteEvent('run_end', { result })
    .catch((error) => console.warn('[analytics] run_end failed', error));
}
