import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { HandoffApi, RuntimeApi, SkillStore } from "@ibrax/sdk"
import handoffSkill, { wantsHuman } from "./index.ts"

const noopLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this } }

function fakeStore(): SkillStore {
  return {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  }
}

function fakeRuntime(enabled: Array<{ chatId: string; reason?: string }>, active = false): RuntimeApi {
  const handoff: HandoffApi = {
    enable: async (chatId, reason) => {
      enabled.push({ chatId, reason })
    },
    disable: async () => {},
    isActive: () => active,
    list: () => [],
  }
  return {
    accountId: "a1",
    sendMessage: async () => ({ messageId: "m" }),
    getChatHistory: async () => [],
    markRead: async () => {},
    memory: { remember: async () => ({ id: "1" }), search: async () => [], forget: async () => {} },
    handoff,
  }
}

test("wantsHuman mendeteksi kata kunci dengan batas kata", () => {
  assert.equal(wantsHuman("saya mau bicara dengan manusia"), true)
  assert.equal(wantsHuman("panggil admin dong"), true)
  assert.equal(wantsHuman("human please"), true)
  assert.equal(wantsHuman("terima kasih"), false)
  assert.equal(wantsHuman("administrasi"), false, "tidak cocok di tengah kata")
  assert.equal(wantsHuman(undefined), false)
})

test("onInbound mengaktifkan handoff dan membalas", async () => {
  const enabled: Array<{ chatId: string; reason?: string }> = []
  const result = await handoffSkill.onInbound!({
    message: {
      id: "m1",
      accountId: "a1",
      chatId: "c1",
      chatKind: "dm",
      senderId: "s1",
      fromMe: false,
      timestamp: 1,
      text: "bisa sambung ke operator?",
    },
    logger: noopLogger as never,
    store: fakeStore(),
    runtime: fakeRuntime(enabled),
  })

  assert.ok(result?.reply)
  assert.equal(enabled.length, 1)
  assert.equal(enabled[0]!.chatId, "c1")
})

test("onInbound tidak mengaktifkan ulang bila handoff sudah aktif", async () => {
  const enabled: Array<{ chatId: string; reason?: string }> = []
  const result = await handoffSkill.onInbound!({
    message: {
      id: "m2",
      accountId: "a1",
      chatId: "c1",
      chatKind: "dm",
      senderId: "s1",
      fromMe: false,
      timestamp: 1,
      text: "admin",
    },
    logger: noopLogger as never,
    store: fakeStore(),
    runtime: fakeRuntime(enabled, true),
  })
  assert.equal(result, undefined)
  assert.equal(enabled.length, 0)
})
