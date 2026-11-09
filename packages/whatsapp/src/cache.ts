/**
 * Cache in-memory minimal dengan TTL opsional — memenuhi antarmuka `CacheStore`
 * Baileys (get/set/del/flushAll). Dipakai untuk `msgRetryCounterCache` dan
 * `cachedGroupMetadata` tanpa menambah dependensi eksternal.
 */
export class MemoryCache {
  private readonly map = new Map<string, { value: unknown; expires?: number }>()

  constructor(private readonly defaultTtlMs?: number) {}

  get<T>(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expires !== undefined && entry.expires < Date.now()) {
      this.map.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs
    this.map.set(key, { value, expires: ttl ? Date.now() + ttl : undefined })
  }

  del(key: string): void {
    this.map.delete(key)
  }

  flushAll(): void {
    this.map.clear()
  }

  close(): void {
    this.map.clear()
  }

  /** Membuang entri kedaluwarsa (dipanggil berkala). */
  prune(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.map) {
      if (entry.expires !== undefined && entry.expires < now) {
        this.map.delete(key)
        removed++
      }
    }
    return removed
  }

  get size(): number {
    return this.map.size
  }
}
