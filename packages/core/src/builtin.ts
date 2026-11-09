import { FINISH_TOOL_NAME, defineSkill, defineTool } from "@ibrax/sdk"

/**
 * Tool `finish` dipakai agen untuk mengakhiri giliran secara eksplisit sambil
 * menyampaikan jawaban akhir. Ia ditambahkan otomatis oleh loop agen.
 */
export const finishTool = defineTool<{ text: string; reason?: string }, { ok: true }>({
  name: FINISH_TOOL_NAME,
  description:
    "Akhiri giliran dan sampaikan jawaban akhir kepada pengguna. Gunakan ini ketika selesai. " +
    "Isi `text` dengan pesan final yang akan dikirim ke pengguna.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Pesan akhir untuk pengguna." },
      reason: { type: "string", description: "Alasan singkat berhenti (opsional)." },
    },
    required: ["text"],
  },
  risk: "low",
  async execute() {
    return { ok: true as const }
  },
})

/** Skill bawaan: tool memori jangka panjang. */
export const coreMemorySkill = defineSkill({
  id: "core-memory",
  name: "Memori Inti",
  description: "Mengingat dan mencari fakta jangka panjang tentang kontak dan chat.",
  systemPrompt:
    "Kamu memiliki memori jangka panjang. Gunakan `memory_remember` untuk menyimpan fakta penting " +
    "(preferensi, janji, konteks) dan `memory_search` sebelum menjawab pertanyaan tentang masa lalu.",
  tools: [
    defineTool<{ text: string; scope?: "global" | "contact" | "chat"; scopeId?: string; tags?: string[] }, { id: string }>(
      {
        name: "memory_remember",
        description: "Simpan fakta ke memori jangka panjang.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Fakta yang diingat." },
            scope: { type: "string", enum: ["global", "contact", "chat"], description: "Ruang lingkup memori." },
            scopeId: { type: "string", description: "ID lingkup (JID kontak/chat) bila scope bukan global." },
            tags: { type: "array", items: { type: "string" }, description: "Tag untuk pencarian." },
          },
          required: ["text"],
        },
        risk: "low",
        async execute(input, ctx) {
          const scope = input.scope ?? (ctx.chatId ? "chat" : "global")
          const scopeId = input.scopeId ?? (scope === "global" ? undefined : ctx.chatId)
          const res = await ctx.runtime.memory.remember({
            scope,
            scopeId,
            text: input.text,
            tags: input.tags,
            source: ctx.chatId ? `chat:${ctx.chatId}` : "agent",
          })
          return { id: res.id }
        },
      },
    ),
    defineTool<{ query: string; limit?: number }, unknown>({
      name: "memory_search",
      description: "Cari fakta di memori jangka panjang.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kata kunci pencarian." },
          limit: { type: "number", description: "Jumlah hasil maksimum (default 10)." },
        },
        required: ["query"],
      },
      risk: "low",
      async execute(input, ctx) {
        return ctx.runtime.memory.search(input.query, { limit: input.limit ?? 10 })
      },
    }),
    defineTool<{ id: string }, { ok: true }>({
      name: "memory_forget",
      description: "Hapus satu fakta dari memori berdasarkan id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id fakta yang dihapus." } },
        required: ["id"],
      },
      risk: "medium",
      async execute(input, ctx) {
        await ctx.runtime.memory.forget(input.id)
        return { ok: true as const }
      },
    }),
  ],
})
