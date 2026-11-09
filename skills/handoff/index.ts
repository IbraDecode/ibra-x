import { defineSkill, defineTool } from "@ibrax/sdk"

const KEYWORDS = ["manusia", "admin", "operator", "cs", "human", "agen"]

/** Mendeteksi permintaan berbicara dengan manusia (deterministik). */
export function wantsHuman(text?: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return KEYWORDS.some((k) => new RegExp(`(^|\\W)${k}(\\W|$)`, "i").test(lower))
}

/**
 * Skill: handoff ke manusia. Mengalihkan percakapan ke manusia lalu menahan
 * balasan otomatis untuk chat tersebut sampai ditutup. Berguna agar agen tidak
 * "ngotot" menjawab saat pengguna minta admin/operator.
 */
export default defineSkill({
  id: "handoff",
  name: "Handoff Manusia",
  description: "Mengalihkan percakapan ke manusia dan menahan balasan otomatis.",
  systemPrompt:
    "Gunakan `request_handoff` bila pengguna jelas butuh manusia atau kamu tidak yakin, `resolve_handoff` " +
    "untuk menutup handoff, dan `list_handoffs` untuk melihat chat yang menunggu manusia.",
  tools: [
    defineTool<{ reason?: string; chatId?: string }, { ok: boolean; chatId: string }>({
      name: "request_handoff",
      description: "Tandai chat butuh ditangani manusia (balasan otomatis ditahan).",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Alasan (opsional)." },
          chatId: { type: "string", description: "JID chat (opsional; default chat saat ini)." },
        },
      },
      risk: "medium",
      async execute(input, ctx) {
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui")
        if (!ctx.runtime.handoff) throw new Error("Handoff tidak tersedia pada runtime ini.")
        await ctx.runtime.handoff.enable(chatId, input.reason, { accountId: ctx.accountId })
        return { ok: true, chatId }
      },
    }),
    defineTool<{ chatId?: string }, { ok: boolean }>({
      name: "resolve_handoff",
      description: "Tutup handoff untuk sebuah chat (balasan otomatis aktif kembali).",
      parameters: {
        type: "object",
        properties: { chatId: { type: "string", description: "JID chat (opsional)." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui")
        await ctx.runtime.handoff?.disable(chatId, { accountId: ctx.accountId })
        return { ok: true }
      },
    }),
    defineTool<Record<string, never>, { handoffs: Array<{ chatId: string; reason?: string; at: number }> }>({
      name: "list_handoffs",
      description: "Tampilkan chat yang sedang menunggu manusia.",
      parameters: { type: "object", properties: {} },
      risk: "low",
      async execute(_input, ctx) {
        return { handoffs: ctx.runtime.handoff?.list({ accountId: ctx.accountId }) ?? [] }
      },
    }),
  ],
  onInbound: async (ctx) => {
    if (ctx.message.fromMe) return undefined
    if (!ctx.runtime.handoff) return undefined
    if (ctx.runtime.handoff.isActive(ctx.message.chatId)) return undefined
    if (!wantsHuman(ctx.message.text)) return undefined
    await ctx.runtime.handoff.enable(ctx.message.chatId, "permintaan pengguna", { accountId: ctx.message.accountId })
    ctx.logger.info({ chat: ctx.message.chatId }, "handoff diaktifkan otomatis")
    return { reply: "Baik, saya sambungkan ke tim manusia ya. Mohon tunggu sebentar 🙏" }
  },
})
