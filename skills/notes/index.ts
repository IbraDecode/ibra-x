import { randomUUID } from "node:crypto"
import { defineSkill, defineTool, type SkillStore } from "@ibrax/sdk"

interface Note {
  id: string
  text: string
  tags: string[]
  createdAt: number
}

const KEY = "notes"

async function load(store: SkillStore): Promise<Note[]> {
  return (await store.get<Note[]>(KEY)) ?? []
}

async function save(store: SkillStore, notes: Note[]): Promise<void> {
  await store.set(KEY, notes)
}

export function searchNotes(notes: Note[], query: string): Note[] {
  const q = query.toLowerCase()
  return notes.filter((n) => n.text.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)))
}

/**
 * Skill: catatan. Buku catatan ringan yang dapat ditambah, dicari, dan dihapus
 * agen — berguna untuk mencatat ide, tautan, dan hal yang perlu ditindaklanjuti.
 */
export default defineSkill({
  id: "notes",
  name: "Catatan",
  description: "Catatan teks ringan yang bisa ditambah, dicari, dan dihapus.",
  systemPrompt: "Gunakan `note_add` untuk mencatat hal penting, `note_search` untuk mencari, dan `note_list` untuk melihat semua.",
  tools: [
    defineTool<{ text: string; tags?: string[] }, { id: string; total: number }>({
      name: "note_add",
      description: "Simpan sebuah catatan.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Isi catatan." },
          tags: { type: "array", items: { type: "string" }, description: "Tag pencarian (opsional)." },
        },
        required: ["text"],
      },
      risk: "low",
      async execute(input, ctx) {
        const notes = await load(ctx.store)
        const note: Note = { id: randomUUID(), text: input.text.trim(), tags: input.tags ?? [], createdAt: Date.now() }
        notes.push(note)
        await save(ctx.store, notes)
        return { id: note.id, total: notes.length }
      },
    }),
    defineTool<{ query: string; limit?: number }, { notes: Note[] }>({
      name: "note_search",
      description: "Cari catatan berdasarkan teks atau tag.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kata kunci." },
          limit: { type: "number", description: "Jumlah maksimum (default 10)." },
        },
        required: ["query"],
      },
      risk: "low",
      async execute(input, ctx) {
        const notes = searchNotes(await load(ctx.store), input.query).slice(0, input.limit ?? 10)
        return { notes }
      },
    }),
    defineTool<{ limit?: number }, { notes: Note[] }>({
      name: "note_list",
      description: "Tampilkan catatan terbaru.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Jumlah maksimum (default 20)." } },
      },
      risk: "low",
      async execute(input, ctx) {
        const notes = (await load(ctx.store)).slice().reverse().slice(0, input.limit ?? 20)
        return { notes }
      },
    }),
    defineTool<{ id: string }, { ok: boolean }>({
      name: "note_delete",
      description: "Hapus catatan berdasarkan id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id catatan." } },
        required: ["id"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const notes = await load(ctx.store)
        const remaining = notes.filter((n) => n.id !== input.id)
        await save(ctx.store, remaining)
        return { ok: remaining.length < notes.length }
      },
    }),
  ],
})
