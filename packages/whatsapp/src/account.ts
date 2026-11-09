import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import pino, { type Logger as PinoLogger } from "pino"
import qrcode from "qrcode-terminal"
import {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getAggregateVotesInPollMessage,
  makeWASocket,
  type AnyMessageContent,
  type WASocket,
  type WAMessage,
  type WAVersion,
} from "@whiskeysockets/baileys"
import type { InboundMessage, Logger } from "@ibrax/sdk"
import { loadAuthState } from "./auth.ts"
import { MemoryCache } from "./cache.ts"
import { jidIdentity, normalizeBaileysMessage } from "./normalize.ts"

const SEND_TIMEOUT_MS = 60_000
const RESTART_CODE = 515
/** Batas jumlah ID pesan terkirim yang dilacak (anti-loop). */
const SENT_IDS_MAX = 5000

export type AccountStatus = "idle" | "connecting" | "open" | "close"

export interface AccountRuntimeOptions {
  accountId: string
  dataDir: string
  logger: Logger
  onInbound: (msg: InboundMessage) => Promise<void> | void
  onQr?: (qr: string) => void
  onStatus?: (status: AccountStatus, reason?: string) => void
  browser?: [string, string, string]
  /** Cetak QR ke terminal otomatis (default false). */
  printQr?: boolean
  logLevel?: string
  /** Sinkronkan riwayat penuh saat konek (cocok untuk akun observer). */
  syncFullHistory?: boolean
  /** Tolak panggilan masuk secara otomatis. */
  rejectCalls?: boolean
  /** Ambil proto pesan mentah berdasarkan id (untuk getMessage: retry & poll). */
  getRawMessage?: (id: string) => unknown
  /** Simpan proto pesan mentah saat pesan masuk. */
  onRawMessage?: (accountId: string, id: string, chatId: string, raw: unknown) => void
  /** Dipanggil saat suara polling terkumpul (setelah didekripsi). */
  onPollVote?: (info: PollVoteInfo) => void
}

/** Hasil agregasi suara sebuah polling. */
export interface PollVoteInfo {
  accountId: string
  chatId: string
  pollId: string
  votes: Array<{ name: string; voters: string[] }>
}

/**
 * Runtime satu akun WhatsApp (satu sesi Baileys).
 *
 * Tanggung jawab:
 *  - memuat state auth & menyambung ke WhatsApp,
 *  - menormalkan pesan masuk menjadi `InboundMessage`,
 *  - mengantre semua pengiriman secara serial (kirim paralel pada satu socket
 *    dapat menyebabkan salah-antar),
 *  - memulihkan koneksi sesuai alasan putus.
 */
export class AccountRuntime {
  status: AccountStatus = "idle"
  private sock?: WASocket
  private sendChain: Promise<unknown> = Promise.resolve()
  private reconnectTimer?: NodeJS.Timeout
  private stopped = false
  private reconnectAttempts = 0
  private readonly pinoLogger: PinoLogger
  /** ID pesan yang dikirim bot ini — gema dengan ID ini bukan pesan pemilik. */
  private readonly sentIds = new Set<string>()
  private readonly sentOrder: string[] = []
  /** Identitas milik akun (nomor PN + LID) untuk mendeteksi self-chat. */
  private readonly ownIds = new Set<string>()
  /** Cache metadata grup (5 menit) — mempercepat kirim ke grup. */
  private readonly groupCache = new MemoryCache(5 * 60_000)
  /** Cache penghitung retry dekripsi — mencegah loop "Bad MAC". */
  private readonly retryCache = new MemoryCache(20 * 60_000)
  /** Nomor akun (digit) setelah terhubung. */
  private ownNumber?: string

  constructor(private readonly opts: AccountRuntimeOptions) {
    this.pinoLogger = pino({ level: opts.logLevel ?? "warn" })
  }

  get id(): string {
    return this.opts.accountId
  }

  get socket(): WASocket | undefined {
    return this.sock
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await loadAuthState(this.opts.dataDir, this.opts.accountId)

    let version: WAVersion | undefined
    try {
      ;({ version } = await fetchLatestBaileysVersion())
    } catch {
      this.opts.logger.warn({ account: this.id }, "gagal mengambil versi Baileys terbaru, memakai default")
    }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: this.pinoLogger,
      browser: this.opts.browser ?? ["Ibra X", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: this.opts.syncFullHistory ?? false,
      // getMessage memungkinkan Baileys mengirim ulang pesan saat penerima minta
      // retry (menghindari "Menunggu pesan ini") dan mendekripsi suara polling.
      getMessage: async (key: { id?: string | null }) => {
        const raw = key?.id ? this.opts.getRawMessage?.(key.id) : undefined
        return raw as never
      },
      msgRetryCounterCache: this.retryCache as never,
      maxMsgRetryCount: 5,
      cachedGroupMetadata: async (jid: string) => {
        const cached = this.groupCache.get(jid)
        if (cached) return cached as never
        try {
          const md = await this.sock?.groupMetadata(jid)
          if (md) this.groupCache.set(jid, md)
          return md as never
        } catch {
          return undefined
        }
      },
    })
    this.sock = sock
    this.setStatus("connecting")

    sock.ev.on("creds.update", () => {
      void saveCreds()
    })

    sock.ev.on("connection.update", (update) => this.handleConnectionUpdate(update))

    // Invalidasi cache metadata grup saat ada perubahan (akan diambil segar saat dipakai).
    sock.ev.on("groups.update", (events) => {
      for (const ev of events ?? []) {
        if (ev?.id) this.groupCache.del(ev.id)
      }
    })
    sock.ev.on("group-participants.update", (ev) => {
      if (ev?.id) this.groupCache.del(ev.id)
    })
    // Pelajari LID akun sendiri (untuk deteksi self-chat).
    sock.ev.on("lid-mapping.update" as never, (mapping: { lid?: string; pn?: string }) => {
      if (!mapping) return
      const pn = mapping.pn ? jidIdentity(mapping.pn) : undefined
      if (pn && this.ownNumber && pn === this.ownNumber && mapping.lid) {
        this.ownIds.add(jidIdentity(mapping.lid))
      }
    })

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return
      for (const raw of messages) {
        void this.processIncoming(raw as WAMessage)
      }
    })

    // Tolak panggilan masuk otomatis (bot tidak mendukung panggilan suara/video).
    if (this.opts.rejectCalls) {
      sock.ev.on("call", (calls) => {
        for (const call of calls) {
          if (call.status === "offer") void this.rejectCall(call.id, call.from)
        }
      })
    }

    // Dekripsi suara polling: datang sebagai messages.update (bukan pesan baru)
    // dan memerlukan pesan pembuat asli (via getMessage).
    sock.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        const pollUpdates = (update as { pollUpdates?: unknown[] } | undefined)?.pollUpdates
        if (pollUpdates?.length) void this.handlePollUpdate(key, pollUpdates)
      }
    })
  }

  /** Menolak panggilan masuk (best-effort). */
  private async rejectCall(id: string, from: string): Promise<void> {
    try {
      await this.sock?.rejectCall(id, from)
      this.opts.logger.info({ from }, "panggilan masuk ditolak otomatis")
    } catch (error) {
      this.opts.logger.debug({ error }, "gagal menolak panggilan")
    }
  }

  /** Mengagregasi suara polling memakai pesan pembuat asli (dari getMessage). */
  private async handlePollUpdate(
    key: { id?: string | null; remoteJid?: string | null },
    pollUpdates: unknown[],
  ): Promise<void> {
    if (!key?.id) return
    const pollCreation = this.opts.getRawMessage?.(key.id)
    if (!pollCreation) return
    try {
      const votes = getAggregateVotesInPollMessage({
        message: pollCreation as never,
        pollUpdates: pollUpdates as never,
      })
      this.opts.onPollVote?.({
        accountId: this.id,
        chatId: key.remoteJid ?? "",
        pollId: key.id,
        votes: votes.map((v) => ({ name: v.name, voters: v.voters })),
      })
    } catch (error) {
      this.opts.logger.debug({ error, pollId: key.id }, "gagal mengagregasi suara polling")
    }
  }

  /** Menormalkan pesan, mengunduh media (bila ada), lalu meneruskannya ke handler. */
  private async processIncoming(raw: WAMessage): Promise<void> {
    const normalized = normalizeBaileysMessage(
      this.id,
      raw as unknown as Parameters<typeof normalizeBaileysMessage>[1],
      { ownIds: this.ownIds },
    )
    if (!normalized) return

    // Tandai gema pesan yang dikirim bot ini (bukan diketik pemilik di ponsel).
    if (normalized.fromMe) normalized.isEcho = this.sentIds.has(normalized.id)

    // Apakah bot ini disebut (untuk gerbang mentionOnly akun).
    if (normalized.mentions?.length && this.ownIds.size > 0) {
      normalized.mentionedMe = normalized.mentions.some((jid) => this.ownIds.has(jidIdentity(jid)))
    }

    // Simpan proto mentah untuk getMessage (retry dekripsi & dekripsi polling).
    if (this.opts.onRawMessage) {
      const rawProto = (raw as { message?: unknown }).message
      if (rawProto) {
        try {
          this.opts.onRawMessage(this.id, normalized.id, normalized.chatId, rawProto)
        } catch (error) {
          this.opts.logger.debug({ error, id: normalized.id }, "gagal menyimpan proto mentah")
        }
      }
    }

    if (normalized.media && !normalized.media.localPath) {
      try {
        const localPath = await this.downloadMedia(raw, normalized.id, normalized.media.mime)
        if (localPath) normalized.media.localPath = localPath
      } catch (error) {
        this.opts.logger.warn({ error, id: normalized.id }, "gagal mengunduh media")
      }
    }

    try {
      await this.opts.onInbound(normalized)
    } catch (error) {
      this.opts.logger.error({ error, account: this.id }, "onInbound gagal")
    }
  }

  /** Mencatat ID pesan yang dikirim bot ini (dibatasi jumlahnya). */
  private markSent(id: string | undefined | null): void {
    if (!id || this.sentIds.has(id)) return
    this.sentIds.add(id)
    this.sentOrder.push(id)
    while (this.sentOrder.length > SENT_IDS_MAX) {
      const old = this.sentOrder.shift()
      if (old) this.sentIds.delete(old)
    }
  }

  /** Menyimpan identitas akun (PN/LID) untuk deteksi self-chat. */
  private captureOwnIdentity(): void {
    const me = this.sock?.user
    if (!me) return
    if (me.id) {
      this.ownIds.add(jidIdentity(me.id))
      const digits = jidIdentity(me.id).replace(/[^0-9]/g, "")
      if (digits) this.ownNumber = digits
    }
    const lid = (me as unknown as { lid?: string }).lid
    if (lid) this.ownIds.add(jidIdentity(lid))
  }

  private async downloadMedia(raw: WAMessage, id: string, mime?: string): Promise<string | undefined> {
    if (!this.sock) return undefined
    const buffer = (await downloadMediaMessage(
      raw,
      "buffer",
      {},
      { logger: this.pinoLogger, reuploadRequest: this.sock.updateMediaMessage },
    )) as Buffer
    if (!buffer?.length) return undefined
    const dir = resolve(this.opts.dataDir, "media")
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${id}.${extensionForMime(mime)}`)
    await writeFile(path, buffer)
    return path
  }

  private handleConnectionUpdate(update: {
    connection?: "connecting" | "open" | "close"
    lastDisconnect?: { error?: unknown }
    qr?: string
  }): void {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      this.opts.onQr?.(qr)
      if (this.opts.printQr) {
        qrcode.generate(qr, { small: true }, (code: string) => process.stdout.write(`${code}\n`))
      }
    }

    if (connection === "open") {
      this.reconnectAttempts = 0
      this.captureOwnIdentity()
      this.setStatus("open")
      this.opts.logger.info({ account: this.id, own: this.ownNumber }, "WhatsApp terhubung")
      return
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      this.setStatus("close", code !== undefined ? String(code) : undefined)

      if (this.stopped) return

      // Kode yang menandakan sesi tidak dapat dilanjutkan → butuh tautkan ulang.
      const terminalCodes = new Set<number | undefined>([
        DisconnectReason.loggedOut, // 401
        DisconnectReason.forbidden, // 403
        DisconnectReason.multideviceMismatch, // 411
        DisconnectReason.badSession, // 500
      ])
      if (terminalCodes.has(code)) {
        this.stopped = true
        this.opts.logger.error(
          { account: this.id, code },
          "sesi tidak dapat dilanjutkan — jalankan `ibrax pair --reset <akun> <nomor>` untuk menautkan ulang",
        )
        return
      }

      if (code === RESTART_CODE) this.reconnectAttempts = 0
      const delay = code === RESTART_CODE ? 1_000 : Math.min(60_000, 2 ** this.reconnectAttempts * 1_000)
      this.reconnectAttempts++
      this.opts.logger.warn({ account: this.id, code, delayMs: delay }, "koneksi tertutup, menyambung ulang")
      this.scheduleReconnect(delay)
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      void this.start().catch((error) => {
        this.opts.logger.error({ error, account: this.id }, "gagal menyambung ulang, mencoba lagi")
        const backoff = Math.min(60_000, 2 ** this.reconnectAttempts * 1_000)
        this.reconnectAttempts++
        this.scheduleReconnect(backoff)
      })
    }, delayMs)
  }

  private setStatus(status: AccountStatus, reason?: string): void {
    this.status = status
    this.opts.onStatus?.(status, reason)
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) throw new Error("Akun belum dijalankan.")
    return this.sock.requestPairingCode(phoneNumber)
  }

  /** Mengantre pengiriman agar tidak pernah tumpang tindih pada satu socket. */
  private enqueueSend<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.sendChain.then(fn, fn)
    this.sendChain = task.catch(() => {})
    return task
  }

  async sendMessage(
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
    _opts?: { replyTo?: string },
  ): Promise<{ messageId: string; messageIds?: string[] }> {
    if (!this.sock) throw new Error(`Akun ${this.id}: socket belum siap`)

    const content = await this.buildContent(payload)

    let timer: NodeJS.Timeout
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("sendMessage timeout")), SEND_TIMEOUT_MS)
    })

    const sent = await this.enqueueSend(() =>
      Promise.race([this.sock!.sendMessage(chatId, content, undefined), timeout]).finally(() => clearTimeout(timer)),
    )

    const messageId = (sent as WAMessage | undefined)?.key?.id ?? ""
    this.markSent(messageId)
    return { messageId }
  }

  private async buildContent(
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
  ): Promise<AnyMessageContent> {
    if ("text" in payload) return { text: payload.text }

    const buffer = await readFile(payload.mediaPath)
    const mime = payload.mime
    if (mime.startsWith("image/")) return { image: buffer, caption: payload.caption, mimetype: mime }
    if (mime.startsWith("video/")) return { video: buffer, caption: payload.caption, mimetype: mime }
    if (mime.startsWith("audio/")) return { audio: buffer, mimetype: mime, ptt: payload.ptt ?? false }
    return { document: buffer, mimetype: mime, caption: payload.caption, fileName: "file" }
  }

  async markRead(chatId: string, messageIds: string[]): Promise<void> {
    if (!this.sock || !messageIds.length) return
    await this.sock.readMessages(messageIds.map((id) => ({ remoteJid: chatId, id, fromMe: false })))
  }

  async react(chatId: string, messageId: string, emoji: string, opts?: { fromMe?: boolean }): Promise<void> {
    if (!this.sock) return
    const sent = await this.enqueueSend(() =>
      this.sock!.sendMessage(chatId, {
        react: { text: emoji, key: { remoteJid: chatId, id: messageId, fromMe: opts?.fromMe ?? false } },
      }),
    )
    this.markSent((sent as WAMessage | undefined)?.key?.id)
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    if (!this.sock) return
    const sent = await this.enqueueSend(() =>
      this.sock!.sendMessage(chatId, { text, edit: { remoteJid: chatId, id: messageId, fromMe: true } }),
    )
    this.markSent((sent as WAMessage | undefined)?.key?.id)
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    if (!this.sock) return
    const sent = await this.enqueueSend(() =>
      this.sock!.sendMessage(chatId, { delete: { remoteJid: chatId, id: messageId, fromMe: true } }),
    )
    this.markSent((sent as WAMessage | undefined)?.key?.id)
  }

  async setPresence(chatId: string, state: "composing" | "paused" | "available"): Promise<void> {
    if (!this.sock) return
    await this.sock.sendPresenceUpdate(state, chatId)
  }

  async getGroupMetadata(chatId: string): Promise<{ id: string; name?: string; participants: string[] } | undefined> {
    if (!this.sock) return undefined
    try {
      const meta = await this.sock.groupMetadata(chatId)
      return {
        id: meta.id,
        name: meta.subject ?? undefined,
        participants: (meta.participants ?? []).map((p) => p.id),
      }
    } catch (error) {
      this.opts.logger.warn({ error, chatId }, "gagal mengambil metadata grup")
      return undefined
    }
  }

  async onWhatsApp(numbers: string[]): Promise<Array<{ jid: string; exists: boolean }>> {
    if (!this.sock) return []
    const res = (await this.sock.onWhatsApp(...numbers)) ?? []
    return res.map((r: { jid: string; exists?: boolean }) => ({ jid: r.jid, exists: Boolean(r.exists) }))
  }

  async groupCreate(subject: string, participants: string[]): Promise<{ id: string }> {
    if (!this.sock) throw new Error("socket belum siap")
    const meta = await this.sock.groupCreate(subject, participants)
    return { id: meta.id }
  }

  async groupParticipants(
    chatId: string,
    action: "add" | "remove" | "promote" | "demote",
    participants: string[],
  ): Promise<void> {
    if (!this.sock) return
    await this.sock.groupParticipantsUpdate(chatId, participants, action)
  }

  async groupInviteCode(chatId: string): Promise<string | undefined> {
    if (!this.sock) return undefined
    try {
      return await this.sock.groupInviteCode(chatId)
    } catch (error) {
      this.opts.logger.warn({ error, chatId }, "gagal mengambil kode undangan")
      return undefined
    }
  }

  async groupSetting(
    chatId: string,
    setting: "announcement" | "not_announcement" | "locked" | "unlocked",
  ): Promise<void> {
    if (!this.sock) return
    await this.sock.groupSettingUpdate(chatId, setting)
  }

  async sendLocation(
    chatId: string,
    location: { latitude: number; longitude: number; name?: string; address?: string },
  ): Promise<void> {
    if (!this.sock) return
    const sent = await this.enqueueSend(() =>
      this.sock!.sendMessage(chatId, {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          name: location.name,
          address: location.address,
        },
      }),
    )
    this.markSent((sent as WAMessage | undefined)?.key?.id)
  }

  async sendPoll(
    chatId: string,
    poll: { name: string; options: string[]; selectableCount?: number },
  ): Promise<void> {
    if (!this.sock) return
    const sent = await this.enqueueSend(() =>
      this.sock!.sendMessage(chatId, {
        poll: { name: poll.name, values: poll.options, selectableCount: poll.selectableCount ?? 1 },
      }),
    )
    this.markSent((sent as WAMessage | undefined)?.key?.id)
  }

  async profilePictureUrl(chatId: string): Promise<string | undefined> {
    if (!this.sock) return undefined
    try {
      return await this.sock.profilePictureUrl(chatId, "image")
    } catch {
      return undefined
    }
  }

  async blockStatus(chatId: string, block: boolean): Promise<void> {
    if (!this.sock) return
    await this.sock.updateBlockStatus(chatId, block ? "block" : "unblock")
  }

  async chatModify(
    chatId: string,
    action: "archive" | "unarchive" | "pin" | "unpin" | "mute" | "unmute" | "markUnread",
    lastMessage?: { id: string; fromMe: boolean; timestamp: number },
  ): Promise<void> {
    if (!this.sock) return
    // Pesan terakhir memberi patch app-state yang konsisten. Tanpa itu, aksi
    // arsip/markRead berisiko membuat WhatsApp mencabut sesi (logout) — jadi ditolak.
    const needsLast = action === "archive" || action === "unarchive" || action === "markUnread"
    if (needsLast && !lastMessage) {
      throw new Error(`Tidak dapat ${action}: pesan terakhir untuk chat ini belum diketahui.`)
    }
    const lastMessages = lastMessage
      ? [
          {
            key: { remoteJid: chatId, id: lastMessage.id, fromMe: lastMessage.fromMe },
            messageTimestamp: Math.floor(lastMessage.timestamp / 1000),
          },
        ]
      : undefined
    let modification: any
    if (action === "archive") modification = { archive: true, lastMessages }
    else if (action === "unarchive") modification = { archive: false, lastMessages }
    else if (action === "pin") modification = { pin: true }
    else if (action === "unpin") modification = { pin: false }
    else if (action === "mute") modification = { mute: 8 * 60 * 60 }
    else if (action === "unmute") modification = { mute: null }
    else modification = { markRead: false, lastMessages }
    await this.sock.chatModify(modification, chatId)
  }

  async sendContact(chatId: string, contact: { displayName: string; vcard: string }): Promise<void> {
    if (!this.sock) return
    const sent = await this.enqueueSend(() =>
      this.sock!.sendMessage(chatId, {
        contacts: { displayName: contact.displayName, contacts: [{ vcard: contact.vcard }] },
      }),
    )
    this.markSent((sent as WAMessage | undefined)?.key?.id)
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    try {
      this.sock?.end(undefined)
    } catch {
      // abaikan
    }
    this.sock = undefined
    this.setStatus("idle")
  }
}

function extensionForMime(mime?: string): string {
  if (!mime) return "bin"
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "application/pdf": "pdf",
    "text/plain": "txt",
  }
  return map[mime] ?? mime.split("/")[1]?.split(";")[0] ?? "bin"
}
