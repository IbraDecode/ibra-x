import { FINISH_TOOL_NAME, defineSkill, defineTool, type ApprovalInfo } from "@ibrax/sdk"

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

/** Skill bawaan: delegasi ke subagen dengan konteks terisolasi. */
export const subagentSkill = defineSkill({
  id: "subagents",
  name: "Subagen",
  description: "Mendelegasikan tugas mandiri ke subagen berkonteks terisolasi.",
  systemPrompt:
    "Gunakan `spawn_subagent` untuk tugas mandiri yang butuh konteks terpisah (riset, analisis, " +
    "pekerjaan panjang). Hanya ringkasan akhir subagen yang kembali; sertakan semua konteks yang " +
    "diperlukan dalam `task` karena subagen tidak melihat riwayat percakapan ini.",
  tools: [
    defineTool<{ task: string; model?: string }, { text: string; reason: string; steps: number }>({
      name: "spawn_subagent",
      description:
        "Jalankan subagen untuk menyelesaikan `task` dan kembalikan ringkasannya. Subagen memiliki konteks kosong, " +
        "jadi berikan instruksi lengkap.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Instruksi lengkap untuk subagen." },
          model: { type: "string", description: "Model khusus (opsional)." },
        },
        required: ["task"],
      },
      risk: "low",
      async execute(input, ctx) {
        if (!ctx.runtime.subagent) throw new Error("Subagen tidak tersedia pada runtime ini.")
        return ctx.runtime.subagent.run(input.task, { model: input.model })
      },
    }),
  ],
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
            sourceAccountId: ctx.accountId,
          })
          return { id: res.id, merged: res.merged ?? false }
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

/** Skill bawaan: alur persetujuan untuk aksi berdampak (tugas terparkir). */
export const approvalsSkill = defineSkill({
  id: "approvals",
  name: "Persetujuan",
  description: "Menampilkan, menyetujui, atau menolak aksi yang menunggu persetujuan manusia.",
  systemPrompt:
    "Bila sebuah aksi ditolak karena butuh persetujuan, aksi itu di-park. Gunakan `list_approvals` untuk " +
    "melihatnya, lalu `approve_action`/`reject_action` dengan id-nya. Hanya lakukan bila pemilik memintanya.",
  tools: [
    defineTool<{ accountId?: string }, { approvals: ApprovalInfo[] }>({
      name: "list_approvals",
      description: "Tampilkan daftar aksi yang menunggu persetujuan.",
      parameters: {
        type: "object",
        properties: { accountId: { type: "string", description: "Filter akun (opsional)." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const api = ctx.runtime.approvals
        return { approvals: api ? api.list({ accountId: input.accountId }) : [] }
      },
    }),
    defineTool<{ id: string }, { ok: boolean; text?: string }>({
      name: "approve_action",
      description: "Setujui dan lanjutkan aksi terparkir berdasarkan id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id aksi terparkir." } },
        required: ["id"],
      },
      risk: "medium",
      async execute(input, ctx) {
        if (!ctx.runtime.approvals) throw new Error("Alur persetujuan tidak tersedia pada runtime ini.")
        const res = await ctx.runtime.approvals.approve(input.id)
        return { ok: res.ok, text: res.text }
      },
    }),
    defineTool<{ id: string }, { ok: boolean }>({
      name: "reject_action",
      description: "Tolak aksi terparkir berdasarkan id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id aksi terparkir." } },
        required: ["id"],
      },
      risk: "low",
      async execute(input, ctx) {
        if (!ctx.runtime.approvals) throw new Error("Alur persetujuan tidak tersedia pada runtime ini.")
        return ctx.runtime.approvals.reject(input.id)
      },
    }),
  ],
})

/**
 * Skill bawaan dari paket core (selalu tersedia). Gunakan ini bersama
 * `whatsappSkill` agar daftar builtin tidak terduplikasi/terlewat antar paket.
 */
export const coreBuiltinSkills = [coreMemorySkill, subagentSkill, approvalsSkill]
