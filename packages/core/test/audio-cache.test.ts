import { describe, expect, it } from 'vitest';
import { AudioBufferCache } from '../../app/src/audio-cache';

const pcm = (bytes: number) => ({ length: bytes / 4, numberOfChannels: 1 }) as AudioBuffer;

describe('decoded audio memory budget', () => {
  it('shares concurrent decoding and removes failed entries for retry', async () => {
    const cache = new AudioBufferCache(16);
    let done!: (buffer: AudioBuffer | null) => void, loads = 0;
    const load = () => { loads++; return new Promise<AudioBuffer | null>((resolve) => { done = resolve; }); };
    const first = cache.load('click', load);
    expect(cache.load('click', load)).toBe(first);
    expect(loads).toBe(1);
    done(null);
    expect(await first).toBeNull();
    expect(cache.size).toBe(0);
    expect(await cache.load('click', async () => pcm(8))).toBeTruthy();
    expect(cache.bytes).toBe(8);
  });

  it('evicts least recently used PCM without invalidating a playing buffer', async () => {
    const cache = new AudioBufferCache(16);
    const playing = await cache.load('first', async () => pcm(8));
    await cache.load('second', async () => pcm(8));
    await cache.load('first', async () => { throw new Error('cached'); });
    await cache.load('third', async () => pcm(8));
    expect(cache.bytes).toBe(16);
    expect(cache.size).toBe(2);
    let decoded = false;
    await cache.load('second', async () => { decoded = true; return pcm(8); });
    expect(decoded).toBe(true);
    expect(playing!.length).toBe(2);
    expect(cache.bytes).toBe(16);
  });

  it('serves oversized stems without retaining them and ignores abandoned decodes', async () => {
    const cache = new AudioBufferCache(16);
    expect(await cache.load('stem', async () => pcm(32))).toBeTruthy();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
    let done!: (buffer: AudioBuffer | null) => void;
    const pending = cache.load('abandoned', () => new Promise((resolve) => { done = resolve; }));
    cache.delete('abandoned');
    done(pcm(8));
    await pending;
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });
});
