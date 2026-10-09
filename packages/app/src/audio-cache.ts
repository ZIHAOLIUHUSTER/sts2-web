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
