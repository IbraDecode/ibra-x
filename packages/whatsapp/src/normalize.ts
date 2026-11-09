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

function toNumber(ts: MinimalMessage["messageTimestamp"]): number {
  if (ts == null) return Date.now()
  if (typeof ts === "number") return ts * 1000
  if (typeof ts === "object" && typeof ts.toNumber === "function") return ts.toNumber() * 1000
  return Date.now()
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
  return undefined
}

function extractMedia(content: Record<string, any>): InboundMessage["media"] {
  const map: Array<[string, string]> = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["documentMessage", "document"],
    ["stickerMessage", "sticker"],
  ]
  for (const [key, kind] of map) {
    const node = content[key]
    if (node) return { kind, mime: node.mimetype, caption: node.caption }
  }
  return undefined
}

/** Mengubah pesan Baileys mentah menjadi envelope Ibra X yang dinormalisasi. */
export function normalizeBaileysMessage(accountId: string, msg: MinimalMessage): InboundMessage | undefined {
  const key = msg.key
  if (!key?.remoteJid || !key.id) return undefined
  const content = (msg.message ?? {}) as Record<string, any>
  if (!content || Object.keys(content).length === 0) return undefined

  const chatId = key.remoteJid
  const chatKind: "dm" | "group" = chatId.endsWith("@g.us") ? "group" : "dm"
  const senderId = key.participant || chatId
  const senderAlt = key.participantAlt || key.remoteJidAlt || undefined
  const ctx = contextOf(content)

  return {
    id: key.id,
    accountId,
    chatId,
    chatKind,
    senderId,
    senderAlt: senderAlt ?? undefined,
    fromMe: Boolean(key.fromMe),
    timestamp: toNumber(msg.messageTimestamp),
    text: extractText(content),
    media: extractMedia(content),
    mentions: ctx?.mentionedJid ?? undefined,
    quotedId: ctx?.stanzaId ?? undefined,
  }
}
