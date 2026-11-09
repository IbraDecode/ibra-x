import { createHmac } from "node:crypto"
import type { Logger } from "@ibrax/sdk"
import type { EventBus, IbraEvents } from "./events.ts"
import type { WebhookConfig } from "./config.ts"

const ALL_EVENTS: Array<keyof IbraEvents> = [
  "inbound.message",
  "outbound.message",
  "agent.step",
  "agent.tool",
  "agent.finished",
  "account.status",
  "memory.written",
  "error",
]

/** Event default bila `events` tidak ditentukan. */
export const DEFAULT_WEBHOOK_EVENTS = [
  "inbound.message",
  "outbound.message",
  "agent.finished",
  "memory.written",
  "account.status",
  "error",
]

/** Menandatangani body dengan HMAC-SHA256 (format `sha256=<hex>`). */
export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

export interface WebhookDispatcherOptions {
  logger: Logger
  /** Untuk pengujian: suntikkan implementasi fetch. */
  fetchImpl?: typeof fetch
  /** Jumlah percobaan (default 2). */
  attempts?: number
}

/**
 * Mengirim event Ibra X sebagai HTTP POST ke webhook yang dikonfigurasi.
 * Payload JSON: `{ event, at, data }`. Bila `secret` diisi, header
 * `x-ibra-signature` berisi HMAC-SHA256 body.
 */
export class WebhookDispatcher {
  private readonly unsubs: Array<() => void> = []
  private readonly fetchImpl: typeof fetch
  private readonly attempts: number

  constructor(private readonly bus: EventBus, private readonly opts: WebhookDispatcherOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.attempts = opts.attempts ?? 2
  }

  /** Mulai berlangganan event dan mengirimkannya ke webhook. */
  start(webhooks: WebhookConfig[]): void {
    for (const webhook of webhooks) {
      const allowed = new Set(webhook.events?.length ? webhook.events : DEFAULT_WEBHOOK_EVENTS)
      for (const event of ALL_EVENTS) {
        if (!allowed.has(event)) continue
        const unsub = this.bus.on(event, (payload) => {
          void this.deliver(webhook, event, payload)
        })
        this.unsubs.push(unsub)
      }
    }
    if (webhooks.length) this.opts.logger.info({ webhooks: webhooks.length }, "webhook keluar aktif")
  }

  stop(): void {
    for (const unsub of this.unsubs) unsub()
    this.unsubs.length = 0
  }

  /** Mengirim satu event ke satu webhook (dapat dipanggil langsung untuk pengujian). */
  async deliver(webhook: WebhookConfig, event: string, payload: unknown): Promise<boolean> {
    const body = JSON.stringify({ event, at: Date.now(), data: payload })
    const headers: Record<string, string> = { "content-type": "application/json", ...(webhook.headers ?? {}) }
    if (webhook.secret) headers["x-ibra-signature"] = signPayload(webhook.secret, body)

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await this.fetchImpl(webhook.url, { method: "POST", headers, body })
        if (res.ok) return true
        this.opts.logger.warn({ url: webhook.url, event, status: res.status, attempt }, "webhook gagal")
      } catch (error) {
        this.opts.logger.warn({ error, url: webhook.url, event, attempt }, "webhook error")
      }
    }
    return false
  }
}
