/**
 * Pembatas laju sederhana berbasis sliding window. Tanpa dependensi, dengan
 * `now()` yang dapat disuntik untuk pengujian deterministik.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly now: () => number

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    now?: () => number,
  ) {
    this.now = now ?? (() => Date.now())
  }

  /** Mengembalikan true bila aksi diizinkan (dan mencatatnya). */
  allow(key: string): boolean {
    if (this.max <= 0) return true
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    return true
  }

  /** Menghapus riwayat satu kunci (mis. saat pengguna diblokir). */
  reset(key: string): void {
    this.hits.delete(key)
  }

  clear(): void {
    this.hits.clear()
  }
}

export interface QuietHours {
  enabled: boolean
  /** Format "HH:MM". */
  from: string
  to: string
}

function toMinutes(hhmm: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return undefined
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return undefined
  return h * 60 + m
}

/**
 * Apakah waktu tertentu berada dalam jam tenang. Mendukung rentang yang
 * melewati tengah malam (mis. 22:00 → 07:00).
 */
export function inQuietHours(range: QuietHours, date: Date = new Date()): boolean {
  if (!range.enabled) return false
  const from = toMinutes(range.from)
  const to = toMinutes(range.to)
  if (from === undefined || to === undefined) return false
  if (from === to) return false

  const current = date.getHours() * 60 + date.getMinutes()
  if (from < to) return current >= from && current < to
  // Rentang melewati tengah malam.
  return current >= from || current < to
}
