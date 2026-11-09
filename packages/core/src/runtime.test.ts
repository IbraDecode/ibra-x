import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { CompleteRequest, CompletionResult, Logger, Provider, Skill, StreamChunk } from "@ibrax/sdk"
import { ConfigSchema } from "./config.ts"
import { Store } from "./db.ts"
import { EventBus } from "./events.ts"
import { Runtime, type Transport } from "./runtime.ts"
import { SkillRegistry } from "./skills.ts"
import { subagentSkill } from "./builtin.ts"

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

class ScriptedProvider implements Provider {
  info = { id: "scripted", label: "Scripted", baseUrl: "http://x", requiresKey: false }
  public calls = 0
  constructor(private readonly script: CompletionResult[]) {}
  async *stream(): AsyncGenerator<StreamChunk> {
    yield { type: "done" }
  }
  async complete(_req: CompleteRequest): Promise<CompletionResult> {
    const result = this.script[this.calls] ?? { message: { role: "assistant", content: "selesai" }, usage: {} }
    this.calls++
    return result
  }
}

function buildRuntime(provider: Provider, configOverrides: Record<string, unknown> = {}) {
  const store = new Store(":memory:")
  const config = ConfigSchema.parse(configOverrides)
  const registry = new SkillRegistry()
  registry.register(subagentSkill)
  const bus = new EventBus()
  const runtime = new Runtime({ config, store, bus, logger: noopLogger, provider, registry })
  return { runtime, store, bus }
}

test("subagent.run mengembalikan ringkasan anak (konteks terisolasi)", async () => {
  const provider = new ScriptedProvider([{ message: { role: "assistant", content: "ringkasan anak" }, usage: {} }])
  const { runtime, store } = buildRuntime(provider)

  const result = await runtime.subagent!.run("ringkas dokumen X")
  assert.equal(result.text, "ringkasan anak")
  assert.equal(result.reason, "completed")
  // Subagen tidak menulis ke store percakapan utama.
  assert.equal(store.countMessages(), 0)
  store.close()
})

test("batas kedalaman subagen mencegah rekursi", async () => {  // Anak mencoba memanggil spawn_subagent lagi → harus ditolak oleh batas kedalaman.
  const provider = new ScriptedProvider([
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "1", name: "spawn_subagent", arguments: { task: "terlalu dalam" } }],
      },
      usage: {},
    },
    { message: { role: "assistant", content: "anak selesai" }, usage: {} },
  ])
  const { runtime, store, bus } = buildRuntime(provider, { maxSubagentDepth: 1 })

  const toolEvents: Array<{ tool: string; ok: boolean }> = []
  bus.on("agent.tool", (e) => toolEvents.push({ tool: e.tool, ok: e.ok }))

  const result = await runtime.subagent!.run("tugas tingkat atas")
  assert.equal(result.text, "anak selesai")
  assert.ok(
    toolEvents.some((e) => e.tool === "spawn_subagent" && !e.ok),
    "panggilan spawn_subagent bersarang harus gagal karena batas kedalaman",
  )
  store.close()
})

class FakeTransport implements Transport {
  sent: Array<{ accountId: string; chatId: string; text: string }> = []
  async sendMessage(
    accountId: string,
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
  ): Promise<{ messageId: string }> {
    this.sent.push({ accountId, chatId, text: "text" in payload ? payload.text : (payload.caption ?? "[media]") })
    return { messageId: "m" }
  }
  async markRead(): Promise<void> {}
  async react(): Promise<void> {}
  async editMessage(): Promise<void> {}
  async deleteMessage(): Promise<void> {}
  async setPresence(): Promise<void> {}
  async getGroupMetadata(): Promise<undefined> {
    return undefined
  }
  async onWhatsApp(): Promise<Array<{ jid: string; exists: boolean }>> {
    return []
  }
  async groupCreate(): Promise<{ id: string }> {
    return { id: "g" }
  }
  async groupParticipants(): Promise<void> {}
  async groupInviteCode(): Promise<undefined> {
    return undefined
  }
  async groupSetting(): Promise<void> {}
  async sendLocation(): Promise<void> {}
  async sendPoll(): Promise<void> {}
  async profilePictureUrl(): Promise<undefined> {
    return undefined
  }
  async blockStatus(): Promise<void> {}
  async chatModify(): Promise<void> {}
  async sendContact(): Promise<void> {}
}

test("hook onInbound melakukan short-circuit sebelum memanggil LLM", async () => {
  const provider = new ScriptedProvider([])
  const store = new Store(":memory:")
  const config = ConfigSchema.parse({ autonomy: "auto", ownerNumbers: ["62811"] })
  const registry = new SkillRegistry()
  const hookSkill: Skill = { id: "hook", name: "Hook", onInbound: () => ({ reply: "balasan otomatis" }) }
  registry.register(hookSkill)
  const transport = new FakeTransport()

  const runtime = new Runtime({
    config,
    store,
    bus: new EventBus(),
    logger: noopLogger,
    provider,
    registry,
    transport,
  })

  await runtime.handleInbound({
    id: "m1",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "62811@s.whatsapp.net",
    fromMe: false,
    timestamp: Date.now(),
    text: "halo",
  })

  assert.equal(transport.sent.length, 1)
  assert.equal(transport.sent[0]!.text, "balasan otomatis")
  assert.equal(provider.calls, 0, "provider LLM tidak boleh dipanggil saat hook menangani")
  store.close()
})

test("handoff menahan balasan otomatis", async () => {
  const provider = new ScriptedProvider([])
  const store = new Store(":memory:")
  const config = ConfigSchema.parse({ autonomy: "auto", ownerNumbers: ["62811"] })
  const registry = new SkillRegistry()
  const transport = new FakeTransport()
  const runtime = new Runtime({ config, store, bus: new EventBus(), logger: noopLogger, provider, registry, transport })

  await runtime.handoff.enable("c1", "uji", { accountId: "a1" })
  transport.sent.length = 0 // buang notifikasi owner

  await runtime.handleInbound({
    id: "m1",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "62811@s.whatsapp.net",
    fromMe: false,
    timestamp: Date.now(),
    text: "halo",
  })

  assert.equal(provider.calls, 0, "agen tidak dijalankan saat handoff aktif")
  assert.equal(transport.sent.length, 0, "tidak ada balasan otomatis")
  assert.ok(runtime.handoff.isActive("c1"))
  store.close()
})

function buildWithTransport(provider: Provider, transport: FakeTransport, configOverrides: Record<string, unknown> = {}) {
  const store = new Store(":memory:")
  const config = ConfigSchema.parse(configOverrides)
  const runtime = new Runtime({
    config,
    store,
    bus: new EventBus(),
    logger: noopLogger,
    provider,
    registry: new SkillRegistry(),
    transport,
  })
  return { runtime, store }
}

test("gema pesan bot sendiri (isEcho) tidak memicu agen (anti-loop)", async () => {
  const provider = new ScriptedProvider([{ message: { role: "assistant", content: "x" }, usage: {} }])
  const transport = new FakeTransport()
  const { runtime, store } = buildWithTransport(provider, transport, { autonomy: "auto", respondTo: "all" })
  await runtime.handleInbound({
    id: "m1",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "a1",
    fromMe: true,
    isEcho: true,
    timestamp: Date.now(),
    text: "balasan bot",
  })
  assert.equal(provider.calls, 0, "agen tidak dijalankan untuk gema sendiri")
  assert.equal(transport.sent.length, 0)
  store.close()
})

test("self-chat aktif: pesan pemilik ke nomornya sendiri memicu agen", async () => {
  const provider = new ScriptedProvider([{ message: { role: "assistant", content: "siap" }, usage: {} }])
  const transport = new FakeTransport()
  const { runtime, store } = buildWithTransport(provider, transport, {
    autonomy: "auto",
    accounts: [{ id: "self", role: "assistant", selfChat: true }],
  })
  await runtime.handleInbound({
    id: "m1",
    accountId: "self",
    chatId: "62811@s.whatsapp.net",
    chatKind: "dm",
    senderId: "62811@s.whatsapp.net",
    fromMe: true,
    isSelfChat: true,
    timestamp: Date.now(),
    text: "catat: beli susu",
  })
  assert.equal(transport.sent.length, 1)
  assert.equal(transport.sent[0]!.text, "siap")
  store.close()
})

test("self-chat nonaktif: pesan fromMe tidak memicu agen", async () => {
  const provider = new ScriptedProvider([{ message: { role: "assistant", content: "x" }, usage: {} }])
  const transport = new FakeTransport()
  const { runtime, store } = buildWithTransport(provider, transport, {
    autonomy: "auto",
    accounts: [{ id: "self", role: "assistant" }],
  })
  await runtime.handleInbound({
    id: "m1",
    accountId: "self",
    chatId: "62811@s.whatsapp.net",
    chatKind: "dm",
    senderId: "62811@s.whatsapp.net",
    fromMe: true,
    isSelfChat: true,
    timestamp: Date.now(),
    text: "halo",
  })
  assert.equal(transport.sent.length, 0)
  assert.equal(provider.calls, 0)
  store.close()
})

test("guard pesan basi: pesan lama dilewati, pesan baru dibalas", async () => {
  const provider = new ScriptedProvider([{ message: { role: "assistant", content: "balas baru" }, usage: {} }])
  const transport = new FakeTransport()
  const { runtime, store } = buildWithTransport(provider, transport, {
    autonomy: "auto",
    ownerNumbers: ["62811"],
    replyMaxAgeSeconds: 300,
  })
  await runtime.handleInbound({
    id: "old",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "62811@s.whatsapp.net",
    fromMe: false,
    timestamp: Date.now() - 3_600_000,
    text: "pesan lama",
  })
  assert.equal(transport.sent.length, 0, "pesan basi tidak dibalas")
  await runtime.handleInbound({
    id: "new",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "62811@s.whatsapp.net",
    fromMe: false,
    timestamp: Date.now(),
    text: "pesan baru",
  })
  assert.equal(transport.sent.length, 1)
  assert.equal(transport.sent[0]!.text, "balas baru")
  store.close()
})

test("pesan sistem (protocolMessage) tidak memicu agen", async () => {
  const provider = new ScriptedProvider([{ message: { role: "assistant", content: "x" }, usage: {} }])
  const transport = new FakeTransport()
  const { runtime, store } = buildWithTransport(provider, transport, { autonomy: "auto", respondTo: "all" })
  await runtime.handleInbound({
    id: "p1",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "62899@s.whatsapp.net",
    fromMe: false,
    isSystem: true,
    timestamp: Date.now(),
  })
  assert.equal(transport.sent.length, 0)
  assert.equal(provider.calls, 0)
  store.close()
})

test("store.getLastMessage mengembalikan pesan terbaru sebuah chat", () => {
  const store = new Store(":memory:")
  store.insertMessage({ id: "a", accountId: "a1", chatId: "c1", senderId: "s", fromMe: false, text: "lama", timestamp: 1000 })
  store.insertMessage({
    id: "b",
    accountId: "a1",
    chatId: "c1",
    senderId: "s",
    fromMe: true,
    text: "baru",
    timestamp: 2000,
  })
  const last = store.getLastMessage("c1")
  assert.equal(last?.id, "b")
  assert.equal(last?.fromMe, true)
  assert.equal(last?.timestamp, 2000)
  assert.equal(store.getLastMessage("tidak-ada"), undefined)
  store.close()
})
