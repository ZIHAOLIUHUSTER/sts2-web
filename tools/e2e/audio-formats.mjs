// Real decoding/playback with native Ogg, no Ogg support, and a misleading capability result.
// Usage: CHROME=<headless shell path> [URL=<dev or preview server>] node tools/e2e/audio-formats.mjs
// Or BROWSER=webkit for installed Playwright WebKit (desktop, not a real iPhone).
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const browser = await (process.env.BROWSER === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: process.env.CHROME }));
try {
  for (const mode of ['native', 'unsupported', 'decode-failure']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
    const requests = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (/\/assets\/audio\/.*\.(ogg|mp3|wav)$/.test(path)) requests.push(path);
    });
    await page.addInitScript((mode) => {
      const probe = window.audioProbe = { decoded: [], started: [], rejected: 0 };
      const formats = new WeakMap();
      const canPlay = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type) {
        return type.includes('ogg') && mode !== 'native' ? (mode === 'unsupported' ? '' : 'probably') : canPlay.call(this, type);
      };
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = async function (data) {
        const magic = String.fromCharCode(...new Uint8Array(data, 0, 4));
        const format = magic === 'OggS' ? 'ogg' : magic === 'RIFF' ? 'wav' : 'mp3';
        if (format === 'ogg' && mode !== 'native') {
          probe.rejected++;
          throw new DOMException('Simulated unavailable Ogg decoder', 'EncodingError');
        }
        const buffer = await decode.call(this, data);
        // A source with non-silent PCM must actually start; a successful request alone is insufficient.
        const samples = buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < samples.length; i += 64) peak = Math.max(peak, Math.abs(samples[i]));
        const info = { format, duration: buffer.duration, peak };
        formats.set(buffer, info);
        probe.decoded.push(info);
        return buffer;
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        start.apply(this, args);
        const info = formats.get(this.buffer);
        if (info) probe.started.push(info);
      };
    }, mode);
    try {
      await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?tutorials=off');
      await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
      await page.click('.mm-settings');
      const format = mode === 'native' && await page.evaluate(() => !!document.createElement('audio').canPlayType('audio/ogg; codecs="opus"')) ? 'ogg' : 'mp3';
      await page.waitForFunction((format) => window.__audio?.().ctx === 'running'
        && [true, false].every((music) => window.audioProbe.started.some((s) => s.format === format && s.peak > 0.001 && (s.duration > 5) === music)), format, { timeout: 15000 });
      const probe = await page.evaluate(() => window.audioProbe);
      if (mode === 'unsupported') assert.equal(requests.filter((p) => p.endsWith('.ogg')).length, 0, 'unsupported browsers should fetch MP3 directly');
      if (mode === 'decode-failure') assert.ok(probe.rejected > 0, 'must exercise a failed Ogg decode');
      if (format === 'ogg') assert.equal(requests.filter((p) => p.endsWith('.mp3')).length, 0, 'Ogg browsers should not fetch compatibility copies');
      await page.evaluate(() => {
        window.audioProbe.started = [];
        const debug = window.G.$.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance;
        debug.Play('battle_start_1.mp3');
        debug.Play('ui_click.wav');
      });
      await page.waitForFunction(() => ['mp3', 'wav'].every((format) => window.audioProbe.started.some((s) => s.format === format && s.peak > 0.001)), null, { timeout: 10000 });
      assert.ok(requests.some((p) => p.endsWith('/debug/battle_start_1.mp3')));
      assert.ok(requests.some((p) => p.endsWith('/debug/ui_click.wav')));
      console.log(`OK ${mode}: music and UI sound started as ${format}; ${probe.rejected} rejected Ogg decodes`);
    } catch (e) {
      console.error(`FAIL ${mode}`, await page.evaluate(() => window.audioProbe), requests);
      throw e;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
