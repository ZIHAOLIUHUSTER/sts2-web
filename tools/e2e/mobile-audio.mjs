// Mobile-only audio formats, alias deduplication, memory pressure and background timeline isolation.
// CHROME=<browser> [URL=<dev server>] node tools/e2e/mobile-audio.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Mobile', serviceWorkers: 'block' });
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
const sample = 'sfx/test.ogg', alias = 'sfx/alias.ogg', requests = [];
// A four-second mono PCM WAV served at the sample URL exercises actual Web Audio decoding.
const pcm = Buffer.alloc(44 + 48000 * 4 * 2);
pcm.write('RIFF'); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(48000, 24); pcm.writeUInt32LE(96000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40);
await page.route(url, (r) => r.fulfill({ contentType: 'text/html', body: '<button>Audio</button>' }));
await page.route('**/assets/audio/index.json', (r) => r.fulfill({ json: { files: [sample], aliases: { [alias]: sample }, formats: ['ogg'] } }));
await page.route('**/assets/audio/**/*.{ogg,mp3}', (r) => { requests.push(r.request().url()); return r.fulfill({ body: pcm, contentType: 'audio/wav' }); });
try {
  await page.goto(url);
  await page.evaluate(async ({ sample, alias }) => {
    HTMLMediaElement.prototype.canPlayType = () => ''; // Ogg-only APK must still try its supplied format.
    window.audio = await import('/src/audio.ts');
    await window.audio.loadAudioIndex();
    window.audio.useEventDb({ params: {}, nested: {}, events: {
      'event:/test': { bus: 'sfx', action: [{ f: sample, loop: 1 }, { f: alias, loop: 1 }] },
    } });
  }, { sample, alias });
  await page.click('button');
  await page.evaluate(() => window.audio.playLoop('event:/test', false));
  await page.waitForFunction(() => window.audio.audioState().sounding.length === 2);
  const before = await page.evaluate(() => window.audio.audioState());
  assert.equal(requests.length, 1, 'aliases share one decode');
  assert.ok(requests.every((r) => r.endsWith('.ogg')), 'Ogg-only package never requests MP3');
  assert.equal(before.cache.entries, 1);
  assert.ok(Math.abs(before.cache.bytes - before.sampleRate * 4 * 4) <= 4, 'cache counts resampled PCM at the AudioContext rate');
  assert.equal(before.cache.limit, 48 * 1024 * 1024);
  assert.equal(before.activePCM.sources, 2);
  assert.equal(before.activePCM.buffers, 1, 'aliased active sources share one PCM allocation');
  assert.equal(before.activePCM.bytes, before.cache.bytes, 'active PCM is measured without multiplying aliases');
  assert.equal(before.pendingDecodes, 0, 'finished decodes retain no in-flight entries');
  await page.evaluate(() => window.dispatchEvent(new Event('sts2-memory-pressure')));
  const cleared = await page.evaluate(() => window.audio.audioState());
  assert.equal(cleared.cache.bytes, 0);
  assert.equal(cleared.sounding.length, 2, 'memory pressure preserves playing sources');
  assert.deepEqual(cleared.activePCM, before.activePCM, 'dropping the cache does not drop playing PCM');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.audio.audioState().ctx === 'suspended');
  const frozen = await page.evaluate(() => window.audio.audioState().time);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.audio.audioState().time), frozen);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.audio.audioState().ctx === 'running');
  await page.waitForFunction((t) => window.audio.audioState().time > t, frozen);
  await page.evaluate(() => window.audio.stopLoop('event:/test'));
  await page.waitForFunction(() => window.audio.audioState().activePCM.sources === 0);
  assert.deepEqual(await page.evaluate(() => window.audio.audioState().activePCM), { bytes: 0, buffers: 0, sources: 0 }, 'ended sources release all counted PCM');
  console.log(`OK mobile audio: one decode for two aliases, ${before.cache.bytes} PCM bytes released while playing, background clock frozen and resumed`);
} finally { await browser.close(); }
