/** Byte- and entry-bounded LRU for disposable decoded image/preview data. */
export class ImageCache<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>();
  private bytes = 0;
  constructor(private maxBytes: number, private maxEntries: number) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, bytes: number): void {
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes || this.maxEntries < 1) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as K;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
  }
}
