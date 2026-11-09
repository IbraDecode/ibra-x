import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { InboundHookContext, SkillStore } from "@ibrax/sdk"
import autoreply, { matchesRule } from "./index.ts"

function memStore(initial: Record<string, unknown> = {}): SkillStore {
  const map = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    list: async () => [...map].map(([key, value]) => ({ key, value })),
  }
}

test("matchesRule: kata kunci dan regex", () => {
  assert.equal(matchesRule({ match: "halo" }, "Halo, apa kabar?"), true)
  assert.equal(matchesRule({ match: "halo" }, "selamat pagi"), false)
  assert.equal(matchesRule({ match: "^menu\\b", isRegex: true }, "menu hari ini"), true)
  assert.equal(matchesRule({ match: "[", isRegex: true }, "menu"), false, "regex tidak valid tidak cocok")
})

test("onInbound mengembalikan balasan saat aturan cocok", async () => {
  const store = memStore({ rules: [{ id: "1", match: "harga", reply: "Cek daftar harga di bio ya 🙏", enabled: true }] })
  const result = await autoreply.onInbound!({
    message: {
      id: "m1",
      accountId: "a1",
      chatId: "c1",
      chatKind: "dm",
      senderId: "s1",
      fromMe: false,
      timestamp: 1,
      text: "berapa harga paketnya?",
    },
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this } },
    store,
    runtime: {} as InboundHookContext["runtime"],
  })
  assert.deepEqual(result, { reply: "Cek daftar harga di bio ya 🙏" })
})

test("onInbound mengabaikan pesan sendiri dan yang tidak cocok", async () => {
  const store = memStore({ rules: [{ id: "1", match: "harga", reply: "x", enabled: true }] })
  const base = {
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this } },
    store,
    runtime: {} as InboundHookContext["runtime"],
  }
  const own = await autoreply.onInbound!({
    ...base,
    message: { id: "m1", accountId: "a1", chatId: "c1", chatKind: "dm", senderId: "s1", fromMe: true, timestamp: 1, text: "harga" },
  })
  assert.equal(own, undefined)

  const noMatch = await autoreply.onInbound!({
    ...base,
    message: { id: "m2", accountId: "a1", chatId: "c1", chatKind: "dm", senderId: "s1", fromMe: false, timestamp: 1, text: "halo" },
  })
  assert.equal(noMatch, undefined)
})
