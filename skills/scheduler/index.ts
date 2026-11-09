import { randomUUID } from "node:crypto"
import { defineSkill, defineTool, type JobContext, type SkillStore } from "@ibrax/sdk"

interface ScheduledMessage {
  id: string
  chatId: string
  text: string
  at: number
  createdAt: number
  sent: boolean
}

const KEY = "messages"

async function load(store: SkillStore): Promise<ScheduledMessage[]> {
  return (await store.get<ScheduledMessage[]>(KEY)) ?? []
}

async function save(store: SkillStore, items: ScheduledMessage[]): Promise<void> {
  await store.set(KEY, items)
}

function parseAt(at: string | number): number | undefined {
  if (typeof at === "number") return at < 1e12 ? at * 1000 : at
  const asNumber = Number(at)
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber < 1e12 ? asNumber * 1000 : asNumber
  const parsed = Date.parse(at)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Skill contoh: mengirim pesan WhatsApp pada waktu tertentu. Job periodik
 * mengirim pesan yang sudah jatuh tempo; state disimpan di SkillStore.
 */
export default defineSkill({
  id: "scheduler",
  name: "Penjadwal Pesan",
  description: "Menjadwalkan pesan WhatsApp untuk dikirim pada waktu tertentu.",
  systemPrompt:
    "Gunakan `schedule_message` untuk menjadwalkan pesan (waktu ISO 8601), `list_scheduled` untuk " +
    "melihat daftar, dan `cancel_scheduled` untuk membatalkan.",
  tools: [
    defineTool<{ text: string; at: string; chatId?: string }, { id: string; at: number; ok: boolean }>({
      name: "schedule_message",
      description: "Jadwalkan pesan teks ke sebuah chat pada waktu tertentu.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Isi pesan." },
          at: { type: "string", description: "Waktu kirim (ISO 8601 atau epoch)." },
          chatId: { type: "string", description: "JID tujuan (opsional; default chat saat ini)." },
        },
        required: ["text", "at"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui dan tidak ada chat aktif")
        const at = parseAt(input.at)
        if (at === undefined) throw new Error("waktu tidak valid")
        const items = await load(ctx.store)
        const item: ScheduledMessage = {
          id: randomUUID(),
          chatId,
          text: input.text,
          at,
          createdAt: Date.now(),
          sent: false,
        }
        items.push(item)
        await save(ctx.store, items)
        return { id: item.id, at, ok: true }
      },
    }),
    defineTool<{ includeSent?: boolean }, { scheduled: ScheduledMessage[] }>({
      name: "list_scheduled",
      description: "Tampilkan pesan terjadwal.",
      parameters: {
        type: "object",
        properties: { includeSent: { type: "boolean", description: "Sertakan yang sudah terkirim." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const items = await load(ctx.store)
        return { scheduled: input.includeSent ? items : items.filter((m) => !m.sent) }
      },
    }),
    defineTool<{ id: string }, { ok: boolean }>({
      name: "cancel_scheduled",
      description: "Batalkan pesan terjadwal berdasarkan id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id pesan terjadwal." } },
        required: ["id"],
      },
      risk: "low",
      async execute(input, ctx) {
        const items = await load(ctx.store)
        const before = items.length
        const remaining = items.filter((m) => m.id !== input.id)
        await save(ctx.store, remaining)
        return { ok: remaining.length < before }
      },
    }),
  ],
  jobs: [
    {
      id: "dispatch",
      intervalMs: 30_000,
      async run(ctx: JobContext) {
        const items = await load(ctx.store)
        if (!items.length) return
        const now = Date.now()
        let changed = false
        for (const item of items) {
          if (item.sent || item.at > now) continue
          item.sent = true
          changed = true
          try {
            await ctx.runtime.sendMessage(item.chatId, { text: item.text }, { accountId: ctx.runtime.accountId })
            ctx.logger.info({ id: item.id, chatId: item.chatId }, "pesan terjadwal terkirim")
          } catch (error) {
            ctx.logger.error({ error, id: item.id }, "gagal mengirim pesan terjadwal")
          }
        }
        if (changed) await save(ctx.store, items)
      },
    },
  ],
})
