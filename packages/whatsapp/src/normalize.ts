import type { InboundMessage } from "@ibrax/sdk"

interface MinimalMessage {
  key: {
    remoteJid?: string | null
    id?: string | null
    fromMe?: boolean | null
    participant?: string | null
    participantAlt?: string | null
    remoteJidAlt?: string | null
  }
  message?: Record<string, unknown> | null
  messageTimestamp?: number | { toNumber(): number } | null
}

/** Pembungkus kontainer WhatsApp yang perlu diupas untuk menemukan konten asli. */
const VIEW_ONCE_KEYS = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]

function toNumber(ts: MinimalMessage["messageTimestamp"]): number {
  if (ts == null) return Date.now()
  if (typeof ts === "number") return ts * 1000
  if (typeof ts === "object" && typeof ts.toNumber === "function") return ts.toNumber() * 1000
  return Date.now()
}

interface UnwrapResult {
  content: Record<string, any>
  viewOnce: boolean
  ephemeral: boolean
  edited: boolean
}

/**
 * Mengupas pembungkus pesan WhatsApp secara rekursif hingga mencapai konten asli.
 * Pesan modern sering dibungkus: ephemeralMessage, viewOnceMessageV2,
 * documentWithCaptionMessage, editedMessage, deviceSentMessage, dsb.
 * Tanpa ini, teks/media pada chat sementara atau sekali-lihat akan terlewat.
 */
function unwrapContent(input: Record<string, any>): UnwrapResult {
  let cur: Record<string, any> = input
  let viewOnce = false
  let ephemeral = false
  let edited = false
  for (let depth = 0; depth < 12; depth++) {
    if (!cur || typeof cur !== "object") break
    if (cur.ephemeralMessage?.message) {
      ephemeral = true
      cur = cur.ephemeralMessage.message
      continue
    }
    const voKey = VIEW_ONCE_KEYS.find((k) => cur[k]?.message)
    if (voKey) {
      viewOnce = true
      cur = cur[voKey].message
      continue
    }
    if (cur.documentWithCaptionMessage?.message) {
      cur = cur.documentWithCaptionMessage.message
      continue
    }
    if (cur.editedMessage?.message) {
      edited = true
      cur = cur.editedMessage.message
      continue
    }
    if (cur.deviceSentMessage?.message) {
      cur = cur.deviceSentMessage.message
      continue
    }
    if (cur.associatedChildMessage?.message) {
      cur = cur.associatedChildMessage.message
      continue
    }
    break
  }
  return { content: cur, viewOnce, ephemeral, edited }
}

function contextOf(content: Record<string, any>): any | undefined {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.stickerMessage?.contextInfo
  )
}

function extractText(content: Record<string, any>): string | undefined {
  if (typeof content.conversation === "string") return content.conversation
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text
  const captioned =
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.ptvMessage?.caption
  if (captioned) return captioned
  if (content.buttonsResponseMessage?.selectedDisplayText) return content.buttonsResponseMessage.selectedDisplayText
  if (content.listResponseMessage?.title) return content.listResponseMessage.title
  if (content.templateButtonReplyMessage?.selectedDisplayText)
    return content.templateButtonReplyMessage.selectedDisplayText
  if (content.reactionMessage?.text) return content.reactionMessage.text
  return undefined
}

function extractMedia(content: Record<string, any>): InboundMessage["media"] {
  const map: Array<[string, string]> = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["documentMessage", "document"],
    ["stickerMessage", "sticker"],
    ["ptvMessage", "video"],
  ]
  for (const [key, kind] of map) {
    const node = content[key]
    if (node) return { kind, mime: node.mimetype, caption: node.caption }
  }
  return undefined
}

/** Tipe konten yang dianggap "sistem" (bukan percakapan biasa). */
const SYSTEM_KEYS = new Set([
  "protocolMessage",
  "reactionMessage",
  "pollUpdateMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
])

export interface NormalizeOptions {
  /** Identitas milik akun (nomor PN + LID) untuk mendeteksi self-chat. */
  ownIds?: Set<string>
}

/** Identitas inti sebuah JID (digit PN atau id LID), tanpa server/suffix perangkat. */
export function jidIdentity(jid: string): string {
  return jid.split("@")[0]?.split(":")[0] ?? jid
}

/** Mengubah pesan Baileys mentah menjadi envelope Ibra X yang dinormalisasi. */
export function normalizeBaileysMessage(
  accountId: string,
  msg: MinimalMessage,
  opts: NormalizeOptions = {},
): InboundMessage | undefined {
  const key = msg.key
  if (!key?.remoteJid || !key.id) return undefined
  const raw = (msg.message ?? {}) as Record<string, any>
  if (!raw || Object.keys(raw).length === 0) return undefined

  const { content, viewOnce, ephemeral } = unwrapContent(raw)

  const chatId = key.remoteJid
  const chatKind: "dm" | "group" = chatId.endsWith("@g.us") ? "group" : "dm"
  const fromMe = Boolean(key.fromMe)
  const senderId = key.participant || chatId
  const senderAlt = key.participantAlt || key.remoteJidAlt || undefined
  const ctx = contextOf(content)

  const text = extractText(content)
  const media = extractMedia(content)
  const isSystem = Object.keys(content).some((k) => SYSTEM_KEYS.has(k)) && !text && !media

  const own = opts.ownIds ?? new Set<string>()
  const isSelfChat = fromMe && own.size > 0 && own.has(jidIdentity(chatId))

  // Buang pesan yang tidak punya konten bermakna sama sekali.
  if (!text && !media && !isSystem) return undefined

  return {
    id: key.id,
    accountId,
    chatId,
    chatKind,
    senderId,
    senderAlt: senderAlt ?? undefined,
    fromMe,
    timestamp: toNumber(msg.messageTimestamp),
    text,
    media,
    mentions: ctx?.mentionedJid ?? undefined,
    quotedId: ctx?.stanzaId ?? undefined,
    isViewOnce: viewOnce || undefined,
    isEphemeral: ephemeral || undefined,
    isSelfChat: isSelfChat || undefined,
    isSystem: isSystem || undefined,
  }
}
