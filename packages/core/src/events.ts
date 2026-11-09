import type { InboundMessage } from "@ibrax/sdk"

/** Jenis event yang dipancarkan runtime. */
export interface IbraEvents {
  "inbound.message": InboundMessage
  "outbound.message": { accountId: string; chatId: string; text: string; messageId?: string }
  "agent.step": { sessionId: string; step: number; kind: "llm" | "tool"; detail?: string }
  "agent.tool": { sessionId: string; tool: string; risk: string; ok: boolean; ms: number }
  "agent.finished": {
    sessionId: string
    reason: string
    text?: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }
  "account.status": { accountId: string; status: "idle" | "connecting" | "open" | "close"; reason?: string }
  "memory.written": { id: string; scope: string; text: string }
  "poll.vote": { accountId: string; chatId: string; pollId: string; votes: Array<{ name: string; voters: string[] }> }
  "message.revoked": { accountId: string; chatId: string; targetId: string; text: string }
  error: { scope: string; error: unknown }
}

type Handler<K extends keyof IbraEvents> = (payload: IbraEvents[K]) => void

/** Event bus ringan dan bertipe. */
export class EventBus {
  private handlers = new Map<string, Set<Function>>()

  on<K extends keyof IbraEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(event) ?? new Set()
    set.add(handler)
    this.handlers.set(event, set)
    return () => set.delete(handler)
  }

  emit<K extends keyof IbraEvents>(event: K, payload: IbraEvents[K]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        ;(handler as Handler<K>)(payload)
      } catch {
        // Jangan biarkan handler yang gagal menghentikan handler lain.
      }
    }
  }

  removeAll(): void {
    this.handlers.clear()
  }
}
