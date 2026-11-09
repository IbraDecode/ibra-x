import { defineSkill, defineTool, type JobContext, type SkillStore } from "@ibrax/sdk"

interface DigestTarget {
  chatId: string
  /** Waktu kirim harian "HH:MM". */
  at: string
  /** Tujuan pengiriman: "chat" (default) atau JID eksplisit. */
  deliverTo?: string
  /** Tanggal (YYYY-MM-DD) terakhir dijalankan, untuk sekali-sehari. */
  lastRun?: string
}

const KEY = "targets"

function minutes(hhmm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return undefined
  return h * 60 + min
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

async function load(store: SkillStore): Promise<DigestTarget[]> {
  return (await store.get<DigestTarget[]>(KEY)) ?? []
}

async function save(store: SkillStore, targets: DigestTarget[]): Promise<void> {
  await store.set(KEY, targets)
}

function buildTranscript(history: Array<{ fromMe: boolean; senderId: string; text: string }>): string {
  const lines = history
    .filter((m) => m.text)
    .map((m) => `${m.fromMe ? "Saya" : m.senderId}: ${m.text}`)
  let transcript = lines.join("\n")
  if (transcript.length > 8000) transcript = transcript.slice(transcript.length - 8000)
  return transcript
}

/**
 * Skill contoh: ringkasan harian. Setiap target mendapat ringkasan percakapan
 * sekali sehari pada jam tertentu. Peringkasan didelegasikan ke subagen
 * (konteks terisolasi), lalu hasilnya dikirim ke chat tujuan.
 */
export default defineSkill({
  id: "digest",
  name: "Ringkasan Harian",
  description: "Merangkum percakapan sebuah chat setiap hari dan mengirimkannya.",
  systemPrompt:
    "Gunakan `enable_digest` untuk mengaktifkan ringkasan harian pada sebuah chat (mis. grup), " +
    "`list_digests` untuk melihat daftar, dan `disable_digest` untuk mematikan.",
  tools: [
    defineTool<{ at: string; chatId?: string; deliverTo?: string }, { ok: boolean; chatId: string; at: string }>({
      name: "enable_digest",
      description: "Aktifkan ringkasan harian untuk sebuah chat pada jam tertentu (HH:MM).",
      parameters: {
        type: "object",
        properties: {
          at: { type: "string", description: "Jam kirim harian, format HH:MM." },
          chatId: { type: "string", description: "JID chat (opsional; default chat saat ini)." },
          deliverTo: { type: "string", description: "Tujuan pengiriman (opsional; default chat itu sendiri)." },
        },
        required: ["at"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui dan tidak ada chat aktif")
        if (minutes(input.at) === undefined) throw new Error("format waktu tidak valid (HH:MM)")
        const targets = await load(ctx.store)
        const existing = targets.find((t) => t.chatId === chatId)
        if (existing) {
          existing.at = input.at
          existing.deliverTo = input.deliverTo
        } else {
          targets.push({ chatId, at: input.at, deliverTo: input.deliverTo })
        }
        await save(ctx.store, targets)
        return { ok: true, chatId, at: input.at }
      },
    }),
    defineTool<{ chatId?: string }, { ok: boolean }>({
      name: "disable_digest",
      description: "Matikan ringkasan harian untuk sebuah chat.",
      parameters: {
        type: "object",
        properties: { chatId: { type: "string", description: "JID chat (opsional)." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const chatId = input.chatId ?? ctx.chatId
        const targets = await load(ctx.store)
        const remaining = targets.filter((t) => t.chatId !== chatId)
        await save(ctx.store, remaining)
        return { ok: remaining.length < targets.length }
      },
    }),
    defineTool<Record<string, never>, { targets: DigestTarget[] }>({
      name: "list_digests",
      description: "Tampilkan daftar ringkasan harian.",
      parameters: { type: "object", properties: {} },
      risk: "low",
      async execute(_input, ctx) {
        return { targets: await load(ctx.store) }
      },
    }),
  ],
  jobs: [
    {
      id: "daily",
      intervalMs: 300_000,
      async run(ctx: JobContext) {
        const targets = await load(ctx.store)
        if (!targets.length) return
        const now = new Date()
        const nowMin = now.getHours() * 60 + now.getMinutes()
        const today = todayKey(now)
        let changed = false

        for (const target of targets) {
          const at = minutes(target.at)
          if (at === undefined || target.lastRun === today || nowMin < at) continue

          const history = await ctx.runtime.getChatHistory(target.chatId, { limit: 200 })
          if (history.length === 0) {
            target.lastRun = today
            changed = true
            continue
          }

          const transcript = buildTranscript(history)
          let summary: string
          if (ctx.runtime.subagent) {
            const res = await ctx.runtime.subagent.run(
              "Ringkas percakapan WhatsApp berikut menjadi poin-poin penting (maksimal 8 poin), " +
                "sebutkan keputusan dan hal yang perlu ditindaklanjuti. Jawab ringkas dalam Bahasa Indonesia.\n\n" +
                transcript,
            )
            summary = res.text
          } else {
            summary = `${history.length} pesan terakhir.`
          }

          const dest = target.deliverTo && target.deliverTo !== "chat" ? target.deliverTo : target.chatId
          try {
            await ctx.runtime.sendMessage(
              dest,
              { text: `📋 Ringkasan harian ${target.chatId}:\n\n${summary}` },
              { accountId: ctx.runtime.accountId },
            )
            target.lastRun = today
            changed = true
            ctx.logger.info({ chatId: target.chatId }, "ringkasan harian terkirim")
          } catch (error) {
            ctx.logger.error({ error, chatId: target.chatId }, "gagal mengirim ringkasan harian")
          }
        }

        if (changed) await save(ctx.store, targets)
      },
    },
  ],
})
