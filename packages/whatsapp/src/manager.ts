import type { Transport } from "@ibrax/core"
import type { IbraConfig } from "@ibrax/core"
import type { InboundMessage, Logger } from "@ibrax/sdk"
import { AccountRuntime, type AccountStatus } from "./account.ts"

export interface WhatsAppManagerOptions {
  config: IbraConfig
  dataDir: string
  logger: Logger
  onInbound: (msg: InboundMessage) => Promise<void> | void
  onQr?: (accountId: string, qr: string) => void
  onStatus?: (accountId: string, status: AccountStatus, reason?: string) => void
  printQr?: boolean
}

/**
 * Mengelola beberapa akun WhatsApp sekaligus. Setiap akun adalah satu sesi
 * Baileys independen dengan peran berbeda (observer/assistant/hybrid).
 */
export class WhatsAppManager implements Transport {
  private readonly runtimes = new Map<string, AccountRuntime>()
  private inboundHandler: (msg: InboundMessage) => Promise<void> | void

  constructor(private readonly opts: WhatsAppManagerOptions) {
    this.inboundHandler = opts.onInbound
  }

  /** Menetapkan ulang handler pesan masuk (untuk menghindari dependensi melingkar). */
  setInboundHandler(handler: (msg: InboundMessage) => Promise<void> | void): void {
    this.inboundHandler = handler
  }

  get accountIds(): string[] {
    return [...this.runtimes.keys()]
  }

  getRuntime(accountId: string): AccountRuntime | undefined {
    return this.runtimes.get(accountId)
  }

  async startAll(): Promise<void> {
    const accounts = this.opts.config.accounts.filter((a) => a.enabled)
    if (!accounts.length) {
      this.opts.logger.warn("tidak ada akun WhatsApp aktif di config")
      return
    }
    for (const account of accounts) {
      await this.startAccount(account.id)
    }
  }

  async startAccount(accountId: string): Promise<AccountRuntime> {
    const existing = this.runtimes.get(accountId)
    if (existing) return existing

    const runtime = new AccountRuntime({
      accountId,
      dataDir: this.opts.dataDir,
      logger: this.opts.logger.child({ account: accountId }),
      onInbound: this.inboundHandler,
      onQr: (qr) => this.opts.onQr?.(accountId, qr),
      onStatus: (status, reason) => this.opts.onStatus?.(accountId, status, reason),
      printQr: this.opts.printQr,
      logLevel: this.opts.config.logLevel === "debug" ? "debug" : "warn",
    })
    this.runtimes.set(accountId, runtime)
    await runtime.start()
    return runtime
  }

  async sendMessage(
    accountId: string,
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
    opts?: { replyTo?: string },
  ): Promise<{ messageId: string; messageIds?: string[] }> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) throw new Error(`Akun WhatsApp "${accountId}" tidak aktif`)
    return runtime.sendMessage(chatId, payload, opts)
  }

  async markRead(accountId: string, chatId: string, messageIds: string[]): Promise<void> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) return
    await runtime.markRead(chatId, messageIds)
  }

  async react(
    accountId: string,
    chatId: string,
    messageId: string,
    emoji: string,
    opts?: { fromMe?: boolean },
  ): Promise<void> {
    await this.require(accountId).react(chatId, messageId, emoji, opts)
  }

  async editMessage(accountId: string, chatId: string, messageId: string, text: string): Promise<void> {
    await this.require(accountId).editMessage(chatId, messageId, text)
  }

  async deleteMessage(accountId: string, chatId: string, messageId: string): Promise<void> {
    await this.require(accountId).deleteMessage(chatId, messageId)
  }

  async setPresence(accountId: string, chatId: string, state: "composing" | "paused" | "available"): Promise<void> {
    await this.require(accountId).setPresence(chatId, state)
  }

  async getGroupMetadata(
    accountId: string,
    chatId: string,
  ): Promise<{ id: string; name?: string; participants: string[] } | undefined> {
    return this.runtimes.get(accountId)?.getGroupMetadata(chatId)
  }

  async onWhatsApp(accountId: string, numbers: string[]): Promise<Array<{ jid: string; exists: boolean }>> {
    return this.runtimes.get(accountId)?.onWhatsApp(numbers) ?? []
  }

  async groupCreate(accountId: string, subject: string, participants: string[]): Promise<{ id: string }> {
    return this.require(accountId).groupCreate(subject, participants)
  }

  async groupParticipants(
    accountId: string,
    chatId: string,
    action: "add" | "remove" | "promote" | "demote",
    participants: string[],
  ): Promise<void> {
    await this.require(accountId).groupParticipants(chatId, action, participants)
  }

  async groupInviteCode(accountId: string, chatId: string): Promise<string | undefined> {
    return this.runtimes.get(accountId)?.groupInviteCode(chatId)
  }

  async groupSetting(
    accountId: string,
    chatId: string,
    setting: "announcement" | "not_announcement" | "locked" | "unlocked",
  ): Promise<void> {
    await this.require(accountId).groupSetting(chatId, setting)
  }

  async sendLocation(
    accountId: string,
    chatId: string,
    location: { latitude: number; longitude: number; name?: string; address?: string },
  ): Promise<void> {
    await this.require(accountId).sendLocation(chatId, location)
  }

  async sendPoll(
    accountId: string,
    chatId: string,
    poll: { name: string; options: string[]; selectableCount?: number },
  ): Promise<void> {
    await this.require(accountId).sendPoll(chatId, poll)
  }

  async profilePictureUrl(accountId: string, chatId: string): Promise<string | undefined> {
    return this.runtimes.get(accountId)?.profilePictureUrl(chatId)
  }

  async blockStatus(accountId: string, chatId: string, block: boolean): Promise<void> {
    await this.require(accountId).blockStatus(chatId, block)
  }

  private require(accountId: string): AccountRuntime {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) throw new Error(`Akun WhatsApp "${accountId}" tidak aktif`)
    return runtime
  }

  stopAll(): void {
    for (const runtime of this.runtimes.values()) runtime.stop()
    this.runtimes.clear()
  }
}
