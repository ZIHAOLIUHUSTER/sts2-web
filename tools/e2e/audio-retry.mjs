// Audio sample retry limits and recovery through the real audio engine, in an isolated browser context.
// Usage: CHROME=<headless shell path> [URL=<dev server>] node tools/e2e/audio-retry.mjs
// Or BROWSER=webkit. Imports audio.ts directly, so this check requires the dev server.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const browser = await (process.env.BROWSER === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: process.env.CHROME }));
const sample = 'sfx/sts2_sfx_ui_click_layer1_rr1_v1_unm.ogg';
const cases = [
  { name: '503 recovery', failures: [503, 503], count: 3 },
  { name: 'network recovery with MP3', failures: ['abort', 'abort'], count: 3, mp3: true },
  { name: '408 recovery', failures: [408], count: 2 },
  { name: '429 recovery', failures: [429], count: 2 },
  { name: '503 exhaustion', failures: [503, 503, 503], count: 3, exhausted: true },
  { name: '404 is not retried', failures: [404], count: 1, exhausted: true },
  { name: 'decode failures are not retried', failures: ['invalid', 'invalid'], count: 2, exhausted: true },
  { name: 'prefetch exhaustion', failures: [503, 503, 503], count: 3, exhausted: true, prefetch: true },
];
try {
  for (const test of cases) {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    const requests = [], warnings = [];
    page.on('console', (msg) => { if (msg.text().includes('[audio] Failed to load')) warnings.push(msg.text()); });
    await page.route('**/assets/audio/**/*.{ogg,mp3}', async (route) => {
      requests.push({ url: route.request().url(), time: Date.now() });
      const failure = test.failures[requests.length - 1];
      if (failure === 'abort') await route.abort('failed');
      else if (failure === 'invalid') await route.fulfill({ status: 200, body: 'invalid audio' });
      else if (failure) await route.fulfill({ status: failure, body: 'temporary audio failure' });
      else await route.continue();
    });
    // Load only the audio engine; no game startup, saves or other sample requests.
    const url = process.env.URL ?? 'http://127.0.0.1:47173/';
    await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: '<button>Unlock audio</button>' }));
    try {
      await page.goto(url);
      await page.evaluate(async ({ sample, mp3, prefetch }) => {
        window.audio = await import('/src/audio.ts');
        window.started = 0;
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          start.apply(this, args);
          if (this.buffer?.getChannelData(0).some((v) => Math.abs(v) > 0.001)) window.started++;
        };
        HTMLMediaElement.prototype.canPlayType = () => mp3 ? '' : 'probably';
        await window.audio.loadAudioIndex();
        const action = [{ f: sample, loop: 1 }];
        window.audio.useEventDb({ params: {}, nested: {}, events: {
          'event:/retry/music': { bus: 'music', action },
          'event:/retry/sfx': { bus: 'sfx', action },
          'event:/retry/prefetch': { bus: 'music', len: 48000 * 20, async: [[action[0], 48000 * 8, 48000 * 10]] },
        } });
        window.playTest = () => {
          window.audio.playMusic(prefetch ? 'event:/retry/prefetch' : 'event:/retry/music');
          if (!prefetch) window.audio.playOneShot('event:/retry/sfx');
        };
      }, { sample, mp3: test.mp3, prefetch: test.prefetch });
      await page.click('button');
      await page.evaluate(() => window.playTest());
      if (test.exhausted) {
        for (let i = 0; !warnings.length && i < 100; i++) await page.waitForTimeout(50);
        assert.equal(warnings.length, 1, 'one shared failed load should be reported');
        // Observe beyond both backoff intervals: a failed prefetch must not restart on every scheduler tick.
        await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => window.started), 0, 'failed samples must not play');
      } else {
        await page.waitForFunction(() => window.started === 2, null, { timeout: 10000 });
      }
      assert.equal(requests.length, test.count, 'concurrent users share one bounded load');
      if (test.count === 3) {
        assert.ok(requests[1].time - requests[0].time >= 450, 'first retry waits about 500ms');
        assert.ok(requests[2].time - requests[1].time >= 900, 'second retry waits about 1000ms');
      }
      if (!test.name.startsWith('decode')) assert.ok(requests.every((r) => r.url.endsWith(test.mp3 ? '.mp3' : '.ogg')), 'network errors must not change the selected codec');
      if (test.exhausted) {
        // The server has recovered. Restarting playback must fetch again, without a page reload.
        await page.evaluate(() => {
          window.audio.stopMusic();
          window.audio.playMusic('event:/retry/music');
        });
        await page.waitForFunction(() => window.started > 0, null, { timeout: 10000 });
        assert.equal(requests.length, test.count + 1, 'failed cache entry must be evicted');
      }
      console.log(`OK ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`, { requests, warnings }, await page.evaluate(() => window.audio?.audioState()));
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
