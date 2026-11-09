import { readFile } from "node:fs/promises"
import pino, { type Logger as PinoLogger } from "pino"
import qrcode from "qrcode-terminal"
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  type AnyMessageContent,
  type WASocket,
  type WAMessage,
  type WAVersion,
} from "@whiskeysockets/baileys"
import type { InboundMessage, Logger } from "@ibrax/sdk"
import { loadAuthState } from "./auth.ts"
import { normalizeBaileysMessage } from "./normalize.ts"

const SEND_TIMEOUT_MS = 60_000
const RESTART_CODE = 515

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
  private readonly pinoLogger: PinoLogger

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
      syncFullHistory: false,
      getMessage: async () => undefined,
    })
    this.sock = sock
    this.setStatus("connecting")

    sock.ev.on("creds.update", () => {
      void saveCreds()
    })

    sock.ev.on("connection.update", (update) => this.handleConnectionUpdate(update))

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return
      for (const raw of messages) {
        const normalized = normalizeBaileysMessage(this.id, raw as unknown as Parameters<typeof normalizeBaileysMessage>[1])
        if (!normalized) continue
        void Promise.resolve(this.opts.onInbound(normalized)).catch((error) =>
          this.opts.logger.error({ error, account: this.id }, "onInbound gagal"),
        )
      }
    })
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
        qrcode.generate(qr, { small: true }, (code: string) => process.stdout.write(code + "\n"))
      }
    }

    if (connection === "open") {
      this.setStatus("open")
      this.opts.logger.info({ account: this.id }, "WhatsApp terhubung")
      return
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      this.setStatus("close", code !== undefined ? String(code) : undefined)

      if (this.stopped) return

      if (code === DisconnectReason.loggedOut) {
        this.opts.logger.error({ account: this.id }, "sesi logout — perlu tautkan ulang")
        this.stopped = true
        return
      }

      const delay = code === RESTART_CODE ? 1_000 : 3_000
      this.opts.logger.warn({ account: this.id, code }, `koneksi tertutup, menyambung ulang dalam ${delay}ms`)
      this.scheduleReconnect(delay)
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      void this.start().catch((error) => {
        this.opts.logger.error({ error, account: this.id }, "gagal menyambung ulang, mencoba lagi")
        this.scheduleReconnect(5_000)
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
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string },
    opts?: { replyTo?: string },
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
    return { messageId }
  }

  private async buildContent(
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string },
  ): Promise<AnyMessageContent> {
    if ("text" in payload) return { text: payload.text }

    const buffer = await readFile(payload.mediaPath)
    const mime = payload.mime
    if (mime.startsWith("image/")) return { image: buffer, caption: payload.caption, mimetype: mime }
    if (mime.startsWith("video/")) return { video: buffer, caption: payload.caption, mimetype: mime }
    if (mime.startsWith("audio/")) return { audio: buffer, mimetype: mime, ptt: false }
    return { document: buffer, mimetype: mime, caption: payload.caption, fileName: "file" }
  }

  async markRead(chatId: string, messageIds: string[]): Promise<void> {
    if (!this.sock || !messageIds.length) return
    await this.sock.readMessages(messageIds.map((id) => ({ remoteJid: chatId, id, fromMe: false })))
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
