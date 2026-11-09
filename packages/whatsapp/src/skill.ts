import { defineSkill, defineTool } from "@ibrax/sdk"

/**
 * Skill bawaan `whatsapp`: memberi agen kemampuan dasar berinteraksi dengan
 * WhatsApp. Semua tool memakai `ctx.runtime`, sehingga tetap tunduk pada
 * policy (risiko & persetujuan).
 */
export const whatsappSkill = defineSkill({
  id: "whatsapp",
  name: "WhatsApp",
  description: "Kirim pesan, ambil riwayat chat, dan tandai pesan dibaca.",
  systemPrompt:
    "Kamu dapat berinteraksi dengan WhatsApp. Gunakan `wa_send_message` untuk mengirim pesan " +
    "(risiko medium — hormati otonomi), `wa_get_history` untuk melihat riwayat chat, dan " +
    "`wa_mark_read` untuk menandai pesan dibaca. Konfirmasi dulu sebelum mengirim pesan bila meragukan.",
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
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui dan tidak ada chat aktif")
        const res = await ctx.runtime.sendMessage(
          chatId,
          { text: input.text },
          { replyTo: input.replyTo, accountId: ctx.accountId },
        )
        return { messageId: res.messageId }
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
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui")
        return ctx.runtime.getChatHistory(chatId, { limit: input.limit ?? 30 })
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
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui")
        await ctx.runtime.markRead(chatId, input.messageIds)
        return { ok: true as const }
      },
    }),
  ],
})
