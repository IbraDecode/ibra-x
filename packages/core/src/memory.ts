import { randomUUID } from "node:crypto"
import type { MemoryApi } from "@ibrax/sdk"
import type { Store } from "./db.ts"
import type { EventBus } from "./events.ts"

/** Implementasi memori jangka panjang di atas SQLite + FTS5. */
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
  }): Promise<{ id: string }> {
    const id = randomUUID()
    this.store.insertMemory({
      id,
      scope: input.scope,
      scopeId: input.scopeId,
      text: input.text.trim(),
      tags: input.tags ?? [],
      source: input.source,
      createdAt: Date.now(),
    })
    this.bus?.emit("memory.written", { id, scope: input.scope, text: input.text })
    return { id }
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
}
