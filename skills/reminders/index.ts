import { randomUUID } from "node:crypto"
import { defineSkill, defineTool, type JobContext, type SkillStore } from "@ibrax/sdk"

interface Reminder {
  id: string
  text: string
  at: string
  chatId?: string
  createdAt: number
  done: boolean
}

const KEY = "items"

async function load(store: SkillStore): Promise<Reminder[]> {
  return (await store.get<Reminder[]>(KEY)) ?? []
}

async function save(store: SkillStore, items: Reminder[]): Promise<void> {
  await store.set(KEY, items)
}

function parseAt(at: string): number | undefined {
  const asNumber = Number(at)
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber < 1e12 ? asNumber * 1000 : asNumber
  const parsed = Date.parse(at)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Skill contoh: pengingat. Membuktikan dua hal sekaligus — SkillStore
 * memberi setiap skill ruang penyimpanan sendiri, dan job periodik dapat
 * mengirim pesan secara proaktif.
 */
export default defineSkill({
  id: "reminders",
  name: "Pengingat",
  description: "Mencatat pengingat dan mengirimkannya tepat waktu.",
  systemPrompt:
    "Gunakan `set_reminder` untuk mencatat pengingat (sertakan waktu ISO 8601) dan `list_reminders` " +
    "untuk menampilkannya. Pengingat akan dikirim otomatis oleh scheduler.",
  tools: [
    defineTool<{ text: string; at: string }, { id: string; total: number; parsed: boolean }>({
      name: "set_reminder",
      description: "Simpan pengingat. `at` menerima ISO 8601 (mis. 2026-11-10T09:00:00+07:00) atau epoch detik/ms.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Isi pengingat." },
          at: { type: "string", description: "Waktu pengingat." },
        },
        required: ["text", "at"],
      },
      risk: "low",
      async execute(input, ctx) {
        const items = await load(ctx.store)
        const reminder: Reminder = {
          id: randomUUID(),
          text: input.text,
          at: input.at,
          chatId: ctx.chatId,
          createdAt: Date.now(),
          done: false,
        }
        items.push(reminder)
        await save(ctx.store, items)
        return { id: reminder.id, total: items.length, parsed: parseAt(input.at) !== undefined }
      },
    }),
    defineTool<{ includeDone?: boolean }, { reminders: Reminder[] }>({
      name: "list_reminders",
      description: "Tampilkan daftar pengingat.",
      parameters: {
        type: "object",
        properties: { includeDone: { type: "boolean", description: "Sertakan yang sudah selesai." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const items = await load(ctx.store)
        return { reminders: input.includeDone ? items : items.filter((r) => !r.done) }
      },
    }),
    defineTool<{ id: string }, { ok: boolean }>({
      name: "complete_reminder",
      description: "Tandai pengingat selesai.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id pengingat." } },
        required: ["id"],
      },
      risk: "low",
      async execute(input, ctx) {
        const items = await load(ctx.store)
        const target = items.find((r) => r.id === input.id)
        if (target) target.done = true
        await save(ctx.store, items)
        return { ok: Boolean(target) }
      },
    }),
  ],
  jobs: [
    {
      id: "dispatch",
      intervalMs: 60_000,
      async run(ctx: JobContext) {
        const items = await load(ctx.store)
        if (!items.length) return
        const now = Date.now()
        let changed = false

        for (const reminder of items) {
          if (reminder.done) continue
          const due = parseAt(reminder.at)
          if (due === undefined || due > now) continue

          reminder.done = true
          changed = true
          if (!reminder.chatId) continue

          try {
            await ctx.runtime.sendMessage(
              reminder.chatId,
              { text: `⏰ Pengingat: ${reminder.text}` },
              { accountId: ctx.runtime.accountId },
            )
            ctx.logger.info({ id: reminder.id }, "pengingat terkirim")
          } catch (error) {
            ctx.logger.error({ error, id: reminder.id }, "gagal mengirim pengingat")
          }
        }

        if (changed) await save(ctx.store, items)
      },
    },
  ],
})
