import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { JobContext, Logger, SkillStore } from "@ibrax/sdk"
import digestSkill from "./index.ts"

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

function memStore(initial: Record<string, unknown> = {}): SkillStore {
  const map = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    list: async () => [...map].map(([key, value]) => ({ key, value })),
  }
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function makeCtx(store: SkillStore, sent: Array<{ to: string; text: string }>): JobContext {
  return {
    logger: noopLogger,
    store,
    runtime: {
      accountId: "a1",
      sendMessage: async (to, payload) => {
        sent.push({ to, text: (payload as { text: string }).text })
        return { messageId: "m" }
      },
      getChatHistory: async () => [
        { id: "m1", fromMe: false, senderId: "62811", text: "kapan rapat?", timestamp: 1 },
        { id: "m2", fromMe: true, senderId: "a1", text: "besok jam 10", timestamp: 2 },
      ],
      markRead: async () => {},
      memory: { remember: async () => ({ id: "1" }), search: async () => [], forget: async () => {} },
      subagent: { run: async () => ({ text: "RINGKASAN", reason: "completed", steps: 1 }) },
    },
  }
}

test("job digest mengirim ringkasan ke chat tujuan", async () => {
  const sent: Array<{ to: string; text: string }> = []
  const store = memStore({ targets: [{ chatId: "g1", at: "00:00" }] })
  const job = digestSkill.jobs![0]!

  await job.run(makeCtx(store, sent))

  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.to, "g1")
  assert.match(sent[0]!.text, /RINGKASAN/)
  assert.match(sent[0]!.text, /Ringkasan harian/)

  const updated = (await store.get<Array<{ lastRun?: string }>>("targets"))!
  assert.equal(updated[0]!.lastRun, todayKey(), "lastRun diset agar tidak berulang hari ini")
})

test("job digest tidak berjalan dua kali di hari yang sama", async () => {
  const sent: Array<{ to: string; text: string }> = []
  const store = memStore({ targets: [{ chatId: "g2", at: "00:00", lastRun: todayKey() }] })
  await digestSkill.jobs![0]!.run(makeCtx(store, sent))
  assert.equal(sent.length, 0)
})

test("job digest mengirim ke tujuan eksplisit", async () => {
  const sent: Array<{ to: string; text: string }> = []
  const store = memStore({ targets: [{ chatId: "g3", at: "00:00", deliverTo: "62899@s.whatsapp.net" }] })
  await digestSkill.jobs![0]!.run(makeCtx(store, sent))
  assert.equal(sent[0]!.to, "62899@s.whatsapp.net")
})
