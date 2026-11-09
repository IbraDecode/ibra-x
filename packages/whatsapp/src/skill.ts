import { defineSkill, defineTool, type ToolContext } from "@ibrax/sdk"

function ops(ctx: ToolContext) {
  if (!ctx.runtime.whatsapp) {
    throw new Error("Transport tidak mendukung operasi WhatsApp lanjutan.")
  }
  return ctx.runtime.whatsapp
}

function resolveChatId(ctx: ToolContext, chatId?: string): string {
  const id = chatId ?? ctx.chatId
  if (!id) throw new Error("chatId tidak diketahui dan tidak ada chat aktif")
  return id
}

/**
 * Skill bawaan `whatsapp`: memberi agen kemampuan berinteraksi dengan
 * WhatsApp. Semua tool memakai `ctx.runtime`, sehingga tetap tunduk pada
 * policy (risiko & persetujuan).
 */
export const whatsappSkill = defineSkill({
  id: "whatsapp",
  name: "WhatsApp",
  description: "Kirim pesan/media, reaksi, sunting/hapus, presence, daftar chat, dan info grup.",
  systemPrompt:
    "Kamu dapat berinteraksi dengan WhatsApp melalui tool `wa_*`. Gunakan `wa_send_message`/`wa_send_media` " +
    "untuk mengirim (risiko medium — hormati tingkat otonomi), `wa_get_history` untuk konteks, " +
    "`wa_react` untuk reaksi, `wa_edit`/`wa_delete` untuk mengubah pesan (hapus berisiko tinggi), " +
    "`wa_set_presence` untuk indikator menulis, `wa_list_chats` dan `wa_group_info` untuk informasi. " +
    "Selalu konfirmasi bila meragukan.",
  tools: [
    defineTool<{ text: string; chatId?: string; replyTo?: string }, { messageId: string }>({
      name: "wa_send_message",
      description: "Kirim pesan teks ke sebuah chat WhatsApp. Bila chatId tidak diberikan, gunakan chat saat ini.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Isi pesan." },
          chatId: { type: "string", description: "JID tujuan (opsional; default chat saat ini)." },
          replyTo: { type: "string", description: "id pesan yang dikutip (opsional)." },
        },
        required: ["text"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const chatId = resolveChatId(ctx, input.chatId)
        const res = await ctx.runtime.sendMessage(
          chatId,
          { text: input.text },
          { replyTo: input.replyTo, accountId: ctx.accountId },
        )
        return { messageId: res.messageId }
      },
    }),
    defineTool<{ mediaPath: string; mime: string; caption?: string; chatId?: string }, { messageId: string }>({
      name: "wa_send_media",
      description: "Kirim berkas media (gambar/video/audio/dokumen) dari path lokal.",
      parameters: {
        type: "object",
        properties: {
          mediaPath: { type: "string", description: "Path lokal berkas media." },
          mime: { type: "string", description: "MIME type, mis. image/jpeg." },
          caption: { type: "string", description: "Keterangan (opsional)." },
          chatId: { type: "string", description: "JID tujuan (opsional)." },
        },
        required: ["mediaPath", "mime"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const chatId = resolveChatId(ctx, input.chatId)
        const res = await ctx.runtime.sendMessage(
          chatId,
          { mediaPath: input.mediaPath, mime: input.mime, caption: input.caption },
          { accountId: ctx.accountId },
        )
        return { messageId: res.messageId }
      },
    }),
    defineTool<{ messageIds: string[]; chatId?: string }, { ok: true }>({
      name: "wa_mark_read",
      description: "Tandai pesan sebagai sudah dibaca.",
      parameters: {
        type: "object",
        properties: {
          messageIds: { type: "array", items: { type: "string" }, description: "Daftar id pesan." },
          chatId: { type: "string", description: "JID chat (opsional)." },
        },
        required: ["messageIds"],
      },
      risk: "low",
      async execute(input, ctx) {
        await ctx.runtime.markRead(resolveChatId(ctx, input.chatId), input.messageIds)
        return { ok: true as const }
      },
    }),
    defineTool<{ chatId?: string; limit?: number }, unknown>({
      name: "wa_get_history",
      description: "Ambil riwayat pesan terakhir dari sebuah chat.",
      parameters: {
        type: "object",
        properties: {
          chatId: { type: "string", description: "JID chat (opsional; default chat saat ini)." },
          limit: { type: "number", description: "Jumlah pesan (default 30)." },
        },
      },
      risk: "low",
      async execute(input, ctx) {
        return ctx.runtime.getChatHistory(resolveChatId(ctx, input.chatId), { limit: input.limit ?? 30 })
      },
    }),
    defineTool<{ messageId: string; emoji: string; chatId?: string }, { ok: true }>({
      name: "wa_react",
      description: "Beri reaksi emoji pada sebuah pesan. Kirim string kosong untuk menghapus reaksi.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "id pesan yang direaksi." },
          emoji: { type: "string", description: "Emoji (mis. 👍) atau kosong untuk menghapus." },
          chatId: { type: "string", description: "JID chat (opsional)." },
        },
        required: ["messageId", "emoji"],
      },
      risk: "low",
      async execute(input, ctx) {
        await ops(ctx).react(resolveChatId(ctx, input.chatId), input.messageId, input.emoji, {
          accountId: ctx.accountId,
        })
        return { ok: true as const }
      },
    }),
    defineTool<{ messageId: string; text: string; chatId?: string }, { ok: true }>({
      name: "wa_edit_message",
      description: "Sunting pesan teks yang pernah dikirim.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "id pesan yang disunting." },
          text: { type: "string", description: "Teks baru." },
          chatId: { type: "string", description: "JID chat (opsional)." },
        },
        required: ["messageId", "text"],
      },
      risk: "medium",
      async execute(input, ctx) {
        await ops(ctx).editMessage(resolveChatId(ctx, input.chatId), input.messageId, input.text, {
          accountId: ctx.accountId,
        })
        return { ok: true as const }
      },
    }),
    defineTool<{ messageId: string; forEveryone?: boolean; chatId?: string }, { ok: true }>({
      name: "wa_delete_message",
      description: "Hapus pesan. Bila forEveryone true, hapus untuk semua orang (aksi ireversibel).",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "id pesan yang dihapus." },
          forEveryone: { type: "boolean", description: "Hapus untuk semua orang." },
          chatId: { type: "string", description: "JID chat (opsional)." },
        },
        required: ["messageId"],
      },
      risk: "high",
      requiresApproval: true,
      async execute(input, ctx) {
        await ops(ctx).deleteMessage(resolveChatId(ctx, input.chatId), input.messageId, {
          forEveryone: input.forEveryone ?? true,
          accountId: ctx.accountId,
        })
        return { ok: true as const }
      },
    }),
    defineTool<{ state: "composing" | "paused" | "available"; chatId?: string }, { ok: true }>({
      name: "wa_set_presence",
      description: "Setel indikator kehadiran (menulis/menjeda/tersedia) pada sebuah chat.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["composing", "paused", "available"], description: "Status presence." },
          chatId: { type: "string", description: "JID chat (opsional)." },
        },
        required: ["state"],
      },
      risk: "low",
      async execute(input, ctx) {
        await ops(ctx).setPresence(resolveChatId(ctx, input.chatId), input.state, { accountId: ctx.accountId })
        return { ok: true as const }
      },
    }),
    defineTool<{ limit?: number }, unknown>({
      name: "wa_list_chats",
      description: "Daftar chat yang dikenal (dari store lokal).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Jumlah maksimum (default 50)." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const chats = await ops(ctx).listChats({ accountId: ctx.accountId })
        return chats.slice(0, input.limit ?? 50)
      },
    }),
    defineTool<{ chatId?: string }, unknown>({
      name: "wa_group_info",
      description: "Ambil informasi grup (nama dan daftar peserta).",
      parameters: {
        type: "object",
        properties: { chatId: { type: "string", description: "JID grup (opsional)." } },
      },
      risk: "low",
      async execute(input, ctx) {
        return ops(ctx).getGroupInfo(resolveChatId(ctx, input.chatId), { accountId: ctx.accountId })
      },
    }),
  ],
})
