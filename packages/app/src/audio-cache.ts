/** Bound retained PCM, not compressed download sizes. Playing sources own their buffers independently. */
export class AudioBufferCache {
  private entries = new Map<string, { promise: Promise<AudioBuffer | null>; bytes: number }>();
  bytes = 0;
  constructor(readonly limit: number) {}
  get size() { return this.entries.size; }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
  load(key: string, loader: () => Promise<AudioBuffer | null>) {
    const old = this.entries.get(key);
    if (old) { this.entries.delete(key); this.entries.set(key, old); return old.promise; }
    const entry = { promise: null! as Promise<AudioBuffer | null>, bytes: 0 };
    entry.promise = loader().then((buffer) => {
      if (this.entries.get(key) !== entry) return buffer;
      if (!buffer) { this.delete(key); return null; }
      entry.bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      this.bytes += entry.bytes;
      // Eviction only drops the cache reference; pending playback and active sources retain theirs.
      for (const candidate of this.entries.keys()) {
        if (this.bytes <= this.limit) break;
        if (this.entries.get(candidate)!.bytes) this.delete(candidate);
      }
      return buffer;
    }, (error) => { if (this.entries.get(key) === entry) this.delete(key); throw error; });
    this.entries.set(key, entry);
    return entry.promise;
  }
}

/** Share only work still in progress. Resolved PCM is owned by the cache and sources, never this map. */
export class AudioDecodes {
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  get size() { return this.pending.size; }
  load(key: string, loader: () => Promise<AudioBuffer | null>) {
    const old = this.pending.get(key);
    if (old) return old;
    const promise = Promise.resolve().then(loader).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
}

/** Count unique PCM used by sources without adding any strong references to AudioBuffers. */
export class AudioPlaybackMemory {
  private ids = new WeakMap<AudioBuffer, number>();
  private playing = new Map<number, { bytes: number; sources: number }>();
  private nextId = 0;
  bytes = 0;
  sources = 0;
  get buffers() { return this.playing.size; }
  acquire(buffer: AudioBuffer) {
    let id = this.ids.get(buffer);
    if (id === undefined) { id = this.nextId++; this.ids.set(buffer, id); }
    let entry = this.playing.get(id);
    if (!entry) {
      entry = { bytes: buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, sources: 0 };
      this.playing.set(id, entry); this.bytes += entry.bytes;
    }
    entry.sources++; this.sources++;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.sources--;
      const current = this.playing.get(id!);
      if (current && --current.sources === 0) { this.bytes -= current.bytes; this.playing.delete(id!); }
    };
  }
}
