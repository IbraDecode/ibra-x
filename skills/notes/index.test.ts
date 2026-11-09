import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { SkillStore, ToolContext } from "@ibrax/sdk"
import notesSkill, { searchNotes } from "./index.ts"

function memStore(): SkillStore {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    list: async () => [...map].map(([key, value]) => ({ key, value })),
  }
}

function makeCtx(store: SkillStore): ToolContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this } },
    runtime: {} as ToolContext["runtime"],
    store,
    sessionId: "s",
    accountId: "a1",
    requestApproval: async () => ({ approved: true }),
  }
}

test("searchNotes mencocokkan teks dan tag", () => {
  const notes = [
    { id: "1", text: "beli susu", tags: ["belanja"], createdAt: 1 },
    { id: "2", text: "ide fitur baru", tags: ["produk"], createdAt: 2 },
  ]
  assert.equal(searchNotes(notes, "susu").length, 1)
  assert.equal(searchNotes(notes, "PRODUK").length, 1)
  assert.equal(searchNotes(notes, "tidak ada").length, 0)
})

test("note_add lalu note_list dan note_search", async () => {
  const ctx = makeCtx(memStore())
  const add = notesSkill.tools!.find((t) => t.name === "note_add")!
  const list = notesSkill.tools!.find((t) => t.name === "note_list")!
  const search = notesSkill.tools!.find((t) => t.name === "note_search")!

  await add.execute({ text: "beli susu", tags: ["belanja"] }, ctx)
  await add.execute({ text: "telepon klien", tags: ["kerja"] }, ctx)

  const listed = (await list.execute({}, ctx)) as { notes: unknown[] }
  assert.equal(listed.notes.length, 2)

  const found = (await search.execute({ query: "klien" }, ctx)) as { notes: Array<{ text: string }> }
  assert.equal(found.notes.length, 1)
  assert.equal(found.notes[0]!.text, "telepon klien")
})
