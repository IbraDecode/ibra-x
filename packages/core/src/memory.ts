import { randomUUID } from "node:crypto"
import type { MemoryApi } from "@ibrax/sdk"
import type { MemoryRow, Store } from "./db.ts"
import type { EventBus } from "./events.ts"

/**
 * Memori jangka panjang di atas SQLite + FTS5.
 *
 * Karena seluruh akun WhatsApp berbagi satu store, memori otomatis **bersama
 * antar-nomor**. Setiap fakta menyimpan provenance (akun mana, kapan), dan
 * fakta yang dipelajari ulang akan digabung (dedup) alih-alih diduplikasi.
 */
export class MemoryService implements MemoryApi {
  constructor(
    private readonly store: Store,
    private readonly bus?: EventBus,
  ) {}

  async remember(input: {
    scope: "global" | "contact" | "chat"
    scopeId?: string
    text: string
    tags?: string[]
    source?: string
    sourceAccountId?: string
  }): Promise<{ id: string; merged: boolean }> {
    const text = input.text.trim()
    const now = Date.now()

    // Dedup: fakta yang sama (scope + scopeId + teks) digabung, bukan diduplikasi.
    const existing = this.store.findMemoryByText(input.scope, input.scopeId, text)
    if (existing) {
      this.store.appendMemoryProvenance(existing.id, { accountId: input.sourceAccountId, at: now })
      return { id: existing.id, merged: true }
    }

    const id = randomUUID()
    this.store.insertMemory({
      id,
      scope: input.scope,
      scopeId: input.scopeId,
      text,
      tags: input.tags ?? [],
      source: input.source,
      accountId: input.sourceAccountId,
      provenance: [{ accountId: input.sourceAccountId, at: now }],
      createdAt: now,
    })
    this.bus?.emit("memory.written", { id, scope: input.scope, text })
    return { id, merged: false }
  }

  async search(
    query: string,
    opts: { scope?: "global" | "contact" | "chat"; scopeId?: string; limit?: number } = {},
  ): Promise<Array<{ id: string; scope: string; scopeId?: string; text: string; tags: string[]; createdAt: number }>> {
    return this.store.searchMemory(query, opts)
  }

  async forget(id: string): Promise<void> {
    this.store.deleteMemory(id)
  }

  /** Ekspor seluruh memori (untuk backup/pindah mesin). */
  export(): MemoryRow[] {
    return this.store.allMemory()
  }

  /** Sidik jari stabil isi memori untuk deteksi perubahan/tamper. */
  fingerprint(): string {
    return this.store.memoryFingerprint()
  }

  count(): number {
    return this.store.countMemory()
  }
}
