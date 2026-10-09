import { describe, expect, it } from 'vitest';
import { AudioBufferCache, AudioDecodes, AudioPlaybackMemory } from '../../app/src/audio-cache';

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

describe('transient audio decoding and playback accounting', () => {
  it('shares a decode across cache pressure without retaining resolved music', async () => {
    const cache = new AudioBufferCache(16), decodes = new AudioDecodes();
    let resolve!: (buffer: AudioBuffer) => void, loads = 0;
    const load = () => { loads++; return new Promise<AudioBuffer>((done) => { resolve = done; }); };
    const first = cache.load('music', () => decodes.load('music', load));
    await Promise.resolve();
    cache.clear();
    const second = cache.load('music', () => decodes.load('music', load));
    expect(loads).toBe(1);
    expect(decodes.size).toBe(1);
    resolve(pcm(32));
    expect(await second).toBe(await first);
    expect(cache.size).toBe(0);
    expect(decodes.size).toBe(0);
    await decodes.load('music', async () => { loads++; return pcm(32); });
    expect(loads).toBe(2);
    expect(decodes.size).toBe(0);
  });

  it('releases rejected decodes so a later request can retry', async () => {
    const decodes = new AudioDecodes();
    await expect(decodes.load('missing', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(decodes.size).toBe(0);
    expect(await decodes.load('missing', async () => pcm(8))).toBeTruthy();
  });

  it('counts aliased playing PCM once and releases the last source idempotently', () => {
    const memory = new AudioPlaybackMemory(), shared = pcm(32);
    const first = memory.acquire(shared), second = memory.acquire(shared), other = memory.acquire(pcm(8));
    expect([memory.bytes, memory.buffers, memory.sources]).toEqual([40, 2, 3]);
    first(); first();
    expect([memory.bytes, memory.buffers, memory.sources]).toEqual([40, 2, 2]);
    second();
    expect([memory.bytes, memory.buffers, memory.sources]).toEqual([8, 1, 1]);
    other();
    expect([memory.bytes, memory.buffers, memory.sources]).toEqual([0, 0, 0]);
  });
});
