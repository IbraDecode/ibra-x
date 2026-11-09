import type { EventBus } from "./events.ts"

/** Ringkasan metrik runtime. */
export interface MetricsSnapshot {
  startedAt: number
  uptimeMs: number
  inboundMessages: number
  outboundMessages: number
  llmCalls: number
  agentRuns: number
  agentErrors: number
  toolCalls: number
  toolErrors: number
  subagentRuns: number
  pollVotes: number
  memoryWrites: number
  inputTokens: number
  outputTokens: number
  errors: number
}

/**
 * MetricsRegistry — agregasi metrik ringan dari event bus (tanpa dependensi).
 * Memberi gambar cepat kesehatan runtime untuk dashboard/CLI/endpoint.
 */
export class MetricsRegistry {
  private readonly startedAt = Date.now()
  private readonly counters: Record<string, number> = {}
  private unsubscribe: Array<() => void> = []

  constructor(bus?: EventBus) {
    if (bus) this.attach(bus)
  }

  /** Menyambungkan agregasi ke event bus. */
  attach(bus: EventBus): void {
    this.detach()
    this.unsubscribe = [
      bus.on("inbound.message", () => this.inc("inboundMessages")),
      bus.on("outbound.message", () => this.inc("outboundMessages")),
      bus.on("agent.step", (e) => {
        if (e.kind === "llm") this.inc("llmCalls")
      }),
      bus.on("agent.finished", (e) => {
        if (e.sessionId.startsWith("sub:")) this.inc("subagentRuns")
        else this.inc("agentRuns")
        if (e.reason === "error") this.inc("agentErrors")
        if (e.usage?.inputTokens) this.inc("inputTokens", e.usage.inputTokens)
        if (e.usage?.outputTokens) this.inc("outputTokens", e.usage.outputTokens)
      }),
      bus.on("agent.tool", (e) => {
        this.inc("toolCalls")
        if (!e.ok) this.inc("toolErrors")
      }),
      bus.on("poll.vote", () => this.inc("pollVotes")),
      bus.on("memory.written", () => this.inc("memoryWrites")),
      bus.on("error", () => this.inc("errors")),
    ]
  }

  detach(): void {
    for (const unsub of this.unsubscribe) unsub()
    this.unsubscribe = []
  }

  /** Menambah sebuah counter. */
  inc(key: string, by = 1): void {
    this.counters[key] = (this.counters[key] ?? 0) + by
  }

  get(key: string): number {
    return this.counters[key] ?? 0
  }

  snapshot(): MetricsSnapshot {
    const c = this.counters
    return {
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      inboundMessages: c.inboundMessages ?? 0,
      outboundMessages: c.outboundMessages ?? 0,
      llmCalls: c.llmCalls ?? 0,
      agentRuns: c.agentRuns ?? 0,
      agentErrors: c.agentErrors ?? 0,
      toolCalls: c.toolCalls ?? 0,
      toolErrors: c.toolErrors ?? 0,
      subagentRuns: c.subagentRuns ?? 0,
      pollVotes: c.pollVotes ?? 0,
      memoryWrites: c.memoryWrites ?? 0,
      inputTokens: c.inputTokens ?? 0,
      outputTokens: c.outputTokens ?? 0,
      errors: c.errors ?? 0,
    }
  }

  reset(): void {
    for (const key of Object.keys(this.counters)) this.counters[key] = 0
  }
}
