import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type {
  HandoffApi,
  InboundMessage,
  Logger,
  RuntimeApi,
  SkillStore,
  SpeechApi,
  SubagentApi,
  ToolContext,
  WhatsAppOps,
} from "@ibrax/sdk"
import { Agent, type AgentRunResult } from "./agent.ts"
import type { AccountConfig, IbraConfig } from "./config.ts"
import type { Store } from "./db.ts"
import type { EventBus } from "./events.ts"
import type { ImageDescriber, Speaker, Transcriber } from "./media.ts"
import { MemoryService } from "./memory.ts"
import { Policy } from "./policy.ts"
import { SlidingWindowLimiter, inQuietHours } from "./rate-limit.ts"
import { SessionManager } from "./session.ts"
import type { SkillRegistry } from "./skills.ts"
import type { Provider } from "@ibrax/sdk"

/** Kontrak transport yang diimplementasikan paket `@ibrax/whatsapp`. */
export interface Transport {
  sendMessage(
    accountId: string,
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
    opts?: { replyTo?: string },
  ): Promise<{ messageId: string; messageIds?: string[] }>
  markRead(accountId: string, chatId: string, messageIds: string[]): Promise<void>
  react(accountId: string, chatId: string, messageId: string, emoji: string, opts?: { fromMe?: boolean }): Promise<void>
  editMessage(accountId: string, chatId: string, messageId: string, text: string): Promise<void>
  deleteMessage(accountId: string, chatId: string, messageId: string, opts?: { forEveryone?: boolean }): Promise<void>
  setPresence(accountId: string, chatId: string, state: "composing" | "paused" | "available"): Promise<void>
  getGroupMetadata(
    accountId: string,
    chatId: string,
  ): Promise<{ id: string; name?: string; participants: string[] } | undefined>
  onWhatsApp(accountId: string, numbers: string[]): Promise<Array<{ jid: string; exists: boolean }>>
  groupCreate(accountId: string, subject: string, participants: string[]): Promise<{ id: string }>
  groupParticipants(
    accountId: string,
    chatId: string,
    action: "add" | "remove" | "promote" | "demote",
    participants: string[],
  ): Promise<void>
  groupInviteCode(accountId: string, chatId: string): Promise<string | undefined>
  groupSetting(
    accountId: string,
    chatId: string,
    setting: "announcement" | "not_announcement" | "locked" | "unlocked",
  ): Promise<void>
  sendLocation(
    accountId: string,
    chatId: string,
    location: { latitude: number; longitude: number; name?: string; address?: string },
  ): Promise<void>
  sendPoll(
    accountId: string,
    chatId: string,
    poll: { name: string; options: string[]; selectableCount?: number },
  ): Promise<void>
  profilePictureUrl(accountId: string, chatId: string): Promise<string | undefined>
  blockStatus(accountId: string, chatId: string, block: boolean): Promise<void>
  chatModify(
    accountId: string,
    chatId: string,
    action: "archive" | "unarchive" | "pin" | "unpin" | "mute" | "unmute" | "markUnread",
  ): Promise<void>
  sendContact(accountId: string, chatId: string, contact: { displayName: string; vcard: string }): Promise<void>
}

export interface RuntimeOptions {
  config: IbraConfig
  store: Store
  bus: EventBus
  logger: Logger
  provider: Provider
  registry: SkillRegistry
  transport?: Transport
  /** Bila true, aksi `ask` dijalankan otomatis (dipakai CLI --yes / mode auto). */
  autoApprove?: boolean
  /** Transkripsi audio otomatis untuk pesan suara masuk. */
  transcriber?: Transcriber
  /** Deskripsi gambar otomatis untuk pesan gambar masuk. */
  imageDescriber?: ImageDescriber
  /** Sintesis suara untuk balasan voice note. */
  speaker?: Speaker
  /** Direktori media (tempat menyimpan hasil TTS). */
  mediaDir?: string
}

/**
 * Runtime menyatukan seluruh komponen: menyimpan pesan masuk, menjalankan
 * agen, dan mengirim balasan lewat transport. Ia juga mengimplementasikan
 * `RuntimeApi` yang dipakai tool.
 */
export class Runtime implements RuntimeApi {
  readonly store: Store
  readonly bus: EventBus
  readonly logger: Logger
  readonly policy: Policy
  readonly session: SessionManager
  readonly memory: MemoryService
  readonly registry: SkillRegistry
  readonly agent: Agent

  /** Delegasi ke subagen berkonteks terisolasi. */
  readonly subagent: SubagentApi = {
    run: async (_task, opts) => {
      const maxDepth = this.config.maxSubagentDepth
      if (this.subagentDepth >= maxDepth) {
        throw new Error(`Batas kedalaman subagen tercapai (${maxDepth}).`)
      }
      this.subagentDepth++
      const childSession = `sub:${randomUUID()}`
      try {
        this.bus.emit("agent.step", { sessionId: childSession, step: 0, kind: "llm", detail: "subagent" })
        const result = await this.agent.run({
          accountId: this.currentAccountId,
          chatId: childSession,
          chatKind: "dm",
          role: opts?.role ?? "hybrid",
          senderId: "subagent",
          sessionId: childSession,
          model: opts?.model,
        })
        return { text: result.text, reason: result.reason, steps: result.steps }
      } finally {
        this.subagentDepth--
      }
    },
  }

  private subagentDepth = 0

  /** Handoff ke manusia: menahan balasan otomatis per chat (persisten via kv). */
  readonly handoff: HandoffApi = {
    enable: async (chatId, reason, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      this.store.kvSet(`handoff:${accountId}:${chatId}`, { reason, at: Date.now() })
      this.store.audit({ actor: accountId, action: "handoff.enable", detail: { chatId, reason } })
      const owner = this.config.ownerNumbers[0]
      if (owner) {
        try {
          await this.sendMessage(
            `${owner.replace(/[^0-9]/g, "")}@s.whatsapp.net`,
            { text: `🙋 Handoff: chat ${chatId} butuh manusia${reason ? ` (${reason})` : ""}.` },
            { accountId },
          )
        } catch {
          // Diamkan kegagalan notifikasi owner.
        }
      }
    },
    disable: async (chatId, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      this.store.kvDelete(`handoff:${accountId}:${chatId}`)
      this.store.audit({ actor: accountId, action: "handoff.disable", detail: { chatId } })
    },
    isActive: (chatId) => this.store.kvGet(`handoff:${this.currentAccountId}:${chatId}`) !== undefined,
    list: (opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      const prefix = `handoff:${accountId}:`
      return this.store.kvList(prefix).map((entry) => {
        const value = (entry.value ?? {}) as { reason?: string; at?: number }
        return { chatId: entry.key.slice(prefix.length), reason: value.reason, at: value.at ?? 0 }
      })
    },
  }

  /** Sintesis suara (bila speaker dikonfigurasi). Mengembalikan path berkas audio. */
  get speech(): SpeechApi | undefined {
    if (!this.speaker || !this.mediaDir) return undefined
    const speaker = this.speaker
    const dir = resolve(this.mediaDir)
    return {
      synthesize: async (text: string) => {
        const buffer = await speaker.synthesize(text)
        await mkdir(dir, { recursive: true })
        const path = join(dir, `tts-${randomUUID()}.mp3`)
        await writeFile(path, buffer)
        return path
      },
    }
  }

  /** Operasi WhatsApp lanjutan yang dapat dipanggil tool. */
  readonly whatsapp: WhatsAppOps = {
    react: async (chatId, messageId, emoji, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.react(accountId, chatId, messageId, emoji, { fromMe: opts?.fromMe })
      this.store.audit({ actor: accountId, action: "wa.react", detail: { chatId, messageId, emoji } })
    },
    editMessage: async (chatId, messageId, text, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.editMessage(accountId, chatId, messageId, text)
    },
    deleteMessage: async (chatId, messageId, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.deleteMessage(accountId, chatId, messageId, { forEveryone: opts?.forEveryone })
      this.store.audit({ actor: accountId, action: "wa.delete", detail: { chatId, messageId } })
    },
    setPresence: async (chatId, state, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.setPresence(accountId, chatId, state)
    },
    listChats: async (opts) =>
      this.store.listChats(opts?.accountId).map((c) => ({ id: c.id, kind: c.kind, name: c.name ?? undefined })),
    getGroupInfo: async (chatId, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      return this.transport?.getGroupMetadata(accountId, chatId)
    },
    onWhatsApp: async (numbers, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      return this.transport?.onWhatsApp(accountId, numbers) ?? []
    },
    groupCreate: async (subject, participants, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      if (!this.transport) throw new Error("Transport tidak tersedia")
      const res = await this.transport.groupCreate(accountId, subject, participants)
      this.store.audit({ actor: accountId, action: "wa.groupCreate", detail: { subject } })
      return res
    },
    groupParticipants: async (chatId, action, participants, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.groupParticipants(accountId, chatId, action, participants)
      this.store.audit({ actor: accountId, action: `wa.group.${action}`, detail: { chatId, participants } })
    },
    groupInviteCode: async (chatId, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      return this.transport?.groupInviteCode(accountId, chatId)
    },
    groupSetting: async (chatId, setting, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.groupSetting(accountId, chatId, setting)
      this.store.audit({ actor: accountId, action: "wa.groupSetting", detail: { chatId, setting } })
    },
    sendLocation: async (chatId, location, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.sendLocation(accountId, chatId, location)
    },
    sendPoll: async (chatId, poll, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.sendPoll(accountId, chatId, poll)
    },
    profilePictureUrl: async (chatId, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      return this.transport?.profilePictureUrl(accountId, chatId)
    },
    blockStatus: async (chatId, block, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.blockStatus(accountId, chatId, block)
      this.store.audit({ actor: accountId, action: block ? "wa.block" : "wa.unblock", detail: { chatId } })
    },
    chatModify: async (chatId, action, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.chatModify(accountId, chatId, action)
      this.store.audit({ actor: accountId, action: `wa.chat.${action}`, detail: { chatId } })
    },
    sendContact: async (chatId, contact, opts) => {
      const accountId = opts?.accountId ?? this.currentAccountId
      await this.transport?.sendContact(accountId, chatId, contact)
    },
  }

  private readonly config: IbraConfig
  private readonly transport?: Transport
  private readonly transcriber?: Transcriber
  private readonly imageDescriber?: ImageDescriber
  private readonly speaker?: Speaker
  private readonly mediaDir?: string
  private readonly senderLimiter: SlidingWindowLimiter
  private readonly chatLimiter: SlidingWindowLimiter
  private currentAccountId: string
  private processing = false

  constructor(opts: RuntimeOptions) {
    this.config = opts.config
    this.store = opts.store
    this.bus = opts.bus
    this.logger = opts.logger
    this.policy = new Policy(opts.config)
    this.session = new SessionManager(opts.store, opts.config)
    this.memory = new MemoryService(opts.store, opts.bus)
    this.registry = opts.registry
    this.transport = opts.transport
    this.transcriber = opts.transcriber
    this.imageDescriber = opts.imageDescriber
    this.speaker = opts.speaker
    this.mediaDir = opts.mediaDir
    this.senderLimiter = new SlidingWindowLimiter(60_000, opts.config.limits.perSenderPerMinute)
    this.chatLimiter = new SlidingWindowLimiter(60_000, opts.config.limits.perChatPerMinute)
    this.currentAccountId = opts.config.accounts[0]?.id ?? "default"

    this.agent = new Agent({
      config: opts.config,
      provider: opts.provider,
      registry: opts.registry,
      policy: this.policy,
      session: this.session,
      bus: opts.bus,
      logger: opts.logger.child({ comp: "agent" }),
      autoApprove: opts.autoApprove,
      makeToolContext: (info) => this.makeToolContext(info),
    })
  }

  get accountId(): string {
    return this.currentAccountId
  }

  accountConfig(accountId: string): AccountConfig {
    return (
      this.config.accounts.find((a) => a.id === accountId) ?? {
        id: accountId,
        role: "hybrid",
        enabled: true,
        respondTo: "allowlist",
        mentionOnly: false,
      }
    )
  }

  // --- RuntimeApi ----------------------------------------------------------

  async sendMessage(
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
    opts?: { replyTo?: string; accountId?: string },
  ): Promise<{ messageId: string; messageIds?: string[] }> {
    const accountId = opts?.accountId ?? this.currentAccountId
    const text = "text" in payload ? payload.text : (payload.caption ?? "[media]")

    if (!this.transport) {
      const id = randomUUID()
      this.bus.emit("outbound.message", { accountId, chatId, text, messageId: id })
      this.recordOutgoing(accountId, chatId, id, text)
      return { messageId: id }
    }

    const res = await this.transport.sendMessage(accountId, chatId, payload, { replyTo: opts?.replyTo })
    this.bus.emit("outbound.message", { accountId, chatId, text, messageId: res.messageId })
    this.recordOutgoing(accountId, chatId, res.messageId, text)
    this.store.audit({ actor: accountId, action: "sendMessage", detail: { chatId, kind: "text" } })
    return res
  }

  async getChatHistory(
    chatId: string,
    opts?: { limit?: number },
  ): Promise<Array<{ id: string; fromMe: boolean; senderId: string; text: string; timestamp: number }>> {
    return this.store
      .getHistory(chatId, opts?.limit ?? 50)
      .map((m) => ({ id: m.id, fromMe: m.fromMe, senderId: m.senderId, text: m.text, timestamp: m.timestamp }))
  }

  async markRead(chatId: string, messageIds: string[]): Promise<void> {
    await this.transport?.markRead(this.currentAccountId, chatId, messageIds)
  }

  // --- Tool context --------------------------------------------------------

  private makeToolContext(info: {
    sessionId: string
    accountId: string
    chatId?: string
    senderId?: string
    skillId: string
    signal?: AbortSignal
  }): ToolContext {
    return {
      logger: this.logger.child({ skill: info.skillId, session: info.sessionId }),
      runtime: this,
      store: this.skillStore(info.skillId),
      sessionId: info.sessionId,
      accountId: info.accountId,
      chatId: info.chatId,
      senderId: info.senderId,
      signal: info.signal,
      // MVP: permintaan persetujuan menjadi tugas terparkir (tidak memblokir).
      requestApproval: async (reason: string) => {
        this.store.audit({ actor: info.accountId, action: "approval.request", detail: { reason, tool: info.skillId } })
        return { approved: false }
      },
    }
  }

  skillStore(skillId: string): SkillStore {
    const prefix = `skill:${skillId}:`
    return {
      get: async <T>(key: string) => this.store.kvGet<T>(prefix + key),
      set: async (key, value) => this.store.kvSet(prefix + key, value),
      delete: async (key) => this.store.kvDelete(prefix + key),
      list: async (k = "") => this.store.kvList(prefix + k),
    }
  }

  private recordOutgoing(accountId: string, chatId: string, id: string, text: string): void {
    this.store.insertMessage({
      id,
      accountId,
      chatId,
      senderId: accountId,
      fromMe: true,
      text,
      timestamp: Date.now(),
    })
  }

  // --- Pemrosesan pesan masuk ---------------------------------------------

  /** Titik masuk dari transport. Idempoten: pesan duplikat diabaikan. */
  async handleInbound(msg: InboundMessage): Promise<void> {
    this.store.upsertAccount({ id: msg.accountId, role: this.accountConfig(msg.accountId).role })
    const isNew = this.store.enqueueInbox(msg.accountId, msg)
    if (!isNew) {
      this.logger.debug({ id: msg.id }, "pesan duplikat diabaikan")
      return
    }
    await this.processInboxOnce(1)
  }

  /** Mengambil pesan pending dari antrean dan memprosesnya sampai habis (drain). */
  async processInboxOnce(limit = 10): Promise<number> {
    if (this.processing) return 0
    this.processing = true
    let processed = 0
    try {
      // Drain: terus ambil batch sampai antrean kosong, sehingga pesan yang
      // datang saat pemrosesan tidak "kelaparan" (starvation).
      for (;;) {
        const rows = this.store.takePendingInbox(limit)
        if (!rows.length) break
        for (const row of rows) {
          this.store.setInboxState(row.id, "processing")
          try {
            const msg = JSON.parse(row.payload) as InboundMessage
            await this.processMessage(msg)
            this.store.setInboxState(row.id, "done")
            processed++
          } catch (error) {
            this.logger.error({ error, inbox: row.id }, "gagal memproses pesan, dikembalikan ke antrean")
            this.store.setInboxState(row.id, "pending")
          }
        }
      }
    } finally {
      this.processing = false
    }
    return processed
  }

  private async processMessage(msg: InboundMessage): Promise<void> {
    this.currentAccountId = msg.accountId
    const account = this.accountConfig(msg.accountId)
    const sessionId = this.session.sessionId(msg.accountId, msg.chatId)

    this.store.upsertChat({
      id: msg.chatId,
      accountId: msg.accountId,
      kind: msg.chatKind,
      name: undefined,
    })

    // Transkripsi pesan suara otomatis agar agen "memahami" audio.
    if (this.transcriber && msg.media?.localPath && msg.media.kind === "audio") {
      try {
        const transcript = await this.transcriber.transcribe(msg.media.localPath, msg.media.mime)
        if (transcript) {
          msg.text = `${msg.text ? `${msg.text}\n` : ""}[transkripsi suara] ${transcript}`
          this.store.audit({ actor: msg.accountId, action: "media.transcribe", detail: { id: msg.id } })
        }
      } catch (error) {
        this.logger.warn({ error, id: msg.id }, "transkripsi gagal")
      }
    }

    // Deskripsi gambar otomatis agar agen "melihat" gambar.
    if (
      this.imageDescriber &&
      msg.media?.localPath &&
      (msg.media.kind === "image" || msg.media.kind === "sticker")
    ) {
      try {
        const description = await this.imageDescriber.describe(msg.media.localPath, msg.media.mime)
        if (description) {
          msg.text = `${msg.text ? `${msg.text}\n` : ""}[gambar] ${description}`
          this.store.audit({ actor: msg.accountId, action: "media.describe", detail: { id: msg.id } })
        }
      } catch (error) {
        this.logger.warn({ error, id: msg.id }, "deskripsi gambar gagal")
      }
    }

    this.store.insertMessage({
      id: msg.id,
      accountId: msg.accountId,
      chatId: msg.chatId,
      senderId: msg.senderId,
      fromMe: msg.fromMe,
      text: msg.text ?? "",
      timestamp: msg.timestamp,
      mediaJson: msg.media ? JSON.stringify(msg.media) : undefined,
    })

    // Pesan dari diri sendiri: simpan sebagai konteks, jangan balas (cegah echo loop).
    if (msg.fromMe) return

    const decision = this.policy.canTrigger(msg.senderId, { respondTo: account.respondTo })
    if (decision.effect !== "allow") {
      this.logger.debug({ sender: msg.senderId, reason: decision.reason }, "pengirim tidak diizinkan memicu agen")
      return
    }

    // Jam tenang: agen tidak membalas otomatis.
    if (inQuietHours(this.config.quietHours)) {
      this.store.audit({ actor: msg.accountId, action: "skip.quietHours", detail: { chatId: msg.chatId } })
      this.logger.debug({ chat: msg.chatId }, "jam tenang: agen tidak dijalankan")
      return
    }

    // Batas laju per pengirim dan per chat.
    if (!this.senderLimiter.allow(msg.senderId) || !this.chatLimiter.allow(msg.chatId)) {
      this.store.audit({
        actor: msg.accountId,
        action: "skip.rateLimit",
        detail: { chatId: msg.chatId, sender: msg.senderId },
      })
      this.logger.warn({ chat: msg.chatId, sender: msg.senderId }, "batas laju terlampaui: pesan dilewati")
      return
    }

    if (account.mentionOnly && msg.chatKind === "group") {
      const targets = new Set([...this.config.allowlist, ...this.config.ownerNumbers].map((s) => s.replace(/[^0-9]/g, "")))
      const mentioned = (msg.mentions ?? []).some((m) => targets.has(m.replace(/[^0-9]/g, "")))
      if (!mentioned) {
        this.logger.debug({ chat: msg.chatId }, "grup: agen tidak disebut, dilewati")
        return
      }
    }

    // Handoff: bila chat dalam mode manusia, tahan balasan otomatis.
    if (this.handoff.isActive(msg.chatId)) {
      this.store.audit({ actor: msg.accountId, action: "skip.handoff", detail: { chatId: msg.chatId } })
      this.logger.debug({ chat: msg.chatId }, "handoff aktif: agen tidak dijalankan")
      return
    }

    // Hook deterministik milik skill (mis. auto-reply) sebelum memanggil LLM.
    if (await this.runInboundHooks(msg, account)) return

    this.logger.info({ account: msg.accountId, chat: msg.chatId, sender: msg.senderId }, "menjalankan agen")
    const result: AgentRunResult = await this.agent.run({
      accountId: msg.accountId,
      chatId: msg.chatId,
      chatKind: msg.chatKind,
      role: account.role,
      senderId: msg.senderId,
      sessionId,
      model: account.model,
    })

    await this.deliverReply(msg, account, result)
  }

  private async deliverReply(msg: InboundMessage, account: AccountConfig, result: AgentRunResult): Promise<void> {
    const text = result.text?.trim()
    if (!text) return
    await this.deliverText(msg, account, text, result.reason)
  }

  private async deliverText(msg: InboundMessage, account: AccountConfig, text: string, reason: string): Promise<void> {
    const isObserver = account.role === "observer"
    const canSend = !isObserver && this.policy.canSendAutomatically()

    if (canSend) {
      try {
        await this.transport?.setPresence(msg.accountId, msg.chatId, "composing")
      } catch {
        // abaikan
      }
      try {
        await this.sendMessage(msg.chatId, { text }, { accountId: msg.accountId })
      } catch (error) {
        this.logger.error({ error, chat: msg.chatId }, "gagal mengirim balasan")
        this.bus.emit("error", { scope: "runtime.send", error })
      }
      try {
        await this.transport?.setPresence(msg.accountId, msg.chatId, "paused")
      } catch {
        // abaikan
      }
      try {
        await this.transport?.markRead(msg.accountId, msg.chatId, [msg.id])
      } catch {
        // abaikan
      }
      return
    }

    // Mode suggest/readonly, atau akun observer: catat sebagai saran.
    this.store.audit({
      actor: msg.accountId,
      action: isObserver ? "observe.suggestion" : "reply.suggestion",
      detail: { chatId: msg.chatId, senderId: msg.senderId, text, reason },
    })
    this.bus.emit("agent.finished", { sessionId: this.session.sessionId(msg.accountId, msg.chatId), reason: "suggestion", text })

    // Kirim saran ke owner bila dikonfigurasi.
    const owner = this.config.ownerNumbers[0]
    if (owner) {
      try {
        await this.sendMessage(
          `${owner.replace(/[^0-9]/g, "")}@s.whatsapp.net`,
          { text: `Saran balasan untuk ${msg.chatId}:\n\n${text}` },
          { accountId: msg.accountId },
        )
      } catch {
        // Diamkan kegagalan notifikasi owner.
      }
    }
  }

  /**
   * Menjalankan hook deterministik milik skill (sebelum LLM). Bila sebuah hook
   * mengembalikan balasan atau menandai pesan tertangani, agen tidak dijalankan.
   */
  private async runInboundHooks(msg: InboundMessage, account: AccountConfig): Promise<boolean> {
    for (const skill of this.registry.list()) {
      if (!skill.onInbound) continue
      try {
        const result = await skill.onInbound({
          message: msg,
          logger: this.logger.child({ skill: skill.id }),
          store: this.skillStore(skill.id),
          runtime: this,
        })
        if (result?.reply) {
          this.store.audit({ actor: msg.accountId, action: "hook.reply", detail: { skill: skill.id } })
          await this.deliverText(msg, account, result.reply, `hook:${skill.id}`)
          return true
        }
        if (result?.handled) {
          this.store.audit({ actor: msg.accountId, action: "hook.handled", detail: { skill: skill.id } })
          return true
        }
      } catch (error) {
        this.logger.error({ error, skill: skill.id }, "hook onInbound gagal")
      }
    }
    return false
  }
}
