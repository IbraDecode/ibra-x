import { randomUUID } from "node:crypto"
import { defineSkill, defineTool } from "@ibrax/sdk"

interface Reminder {
  id: string
  text: string
  at: string
  createdAt: number
  done: boolean
}

/**
 * Skill contoh: pengingat sederhana yang disimpan per-namespace skill.
 * Membuktikan bahwa SkillStore memberi setiap skill ruang penyimpanan sendiri.
 */
export default defineSkill({
  id: "reminders",
  name: "Pengingat",
  description: "Mencatat, mendaftar, dan menyelesaikan pengingat pengguna.",
  systemPrompt:
    "Gunakan `set_reminder` untuk mencatat pengingat dan `list_reminders` untuk menampilkannya. " +
    "Simpan waktu dalam format ISO 8601 bila memungkinkan.",
  tools: [
    defineTool<{ text: string; at: string }, { id: string; total: number }>({
      name: "set_reminder",
      description: "Simpan pengingat baru.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Isi pengingat." },
          at: { type: "string", description: "Waktu pengingat (ISO 8601 atau deskriptif)." },
        },
        required: ["text", "at"],
      },
      risk: "low",
      async execute(input, ctx) {
        const items = (await ctx.store.get<Reminder[]>("items")) ?? []
        const reminder: Reminder = {
          id: randomUUID(),
          text: input.text,
          at: input.at,
          createdAt: Date.now(),
          done: false,
        }
        items.push(reminder)
        await ctx.store.set("items", items)
        return { id: reminder.id, total: items.length }
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
        const items = (await ctx.store.get<Reminder[]>("items")) ?? []
        return { reminders: input.includeDone ? items : items.filter((r) => !r.done) }
      },
    }),
    defineTool<{ id: string }, { ok: boolean; found: boolean }>({
      name: "complete_reminder",
      description: "Tandai pengingat selesai.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id pengingat." } },
        required: ["id"],
      },
      risk: "low",
      async execute(input, ctx) {
        const items = (await ctx.store.get<Reminder[]>("items")) ?? []
        const target = items.find((r) => r.id === input.id)
        if (target) target.done = true
        await ctx.store.set("items", items)
        return { ok: Boolean(target), found: Boolean(target) }
      },
    }),
  ],
})
