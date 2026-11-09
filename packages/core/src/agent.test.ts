import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { CompletionResult, CompleteRequest, Logger, Provider, RuntimeApi, SkillStore, StreamChunk } from "@ibrax/sdk"
import { Agent } from "./agent.ts"
import { ConfigSchema } from "./config.ts"
import { Store } from "./db.ts"
import { EventBus } from "./events.ts"
import { MemoryService } from "./memory.ts"
import { Policy } from "./policy.ts"
import { SessionManager } from "./session.ts"
import { SkillRegistry } from "./skills.ts"
import { coreMemorySkill } from "./builtin.ts"

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

const emptyStore: SkillStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
  list: async () => [],
}

class ScriptedProvider implements Provider {
  info = { id: "scripted", label: "Scripted", baseUrl: "http://x", requiresKey: false }
  public calls = 0
  constructor(private readonly script: CompletionResult[]) {}
  async *stream(_req: CompleteRequest): AsyncGenerator<StreamChunk> {
    yield { type: "done" }
  }
  async complete(_req: CompleteRequest): Promise<CompletionResult> {
    const result = this.script[this.calls] ?? { message: { role: "assistant", content: "selesai" }, usage: {} }
    this.calls++
    return result
  }
}

function buildAgent(provider: Provider, configOverrides: Record<string, unknown> = {}) {
  const store = new Store(":memory:")
  const config = ConfigSchema.parse({ maxSteps: 5, autonomy: "auto", ...configOverrides })
  const registry = new SkillRegistry()
  registry.register(coreMemorySkill)
  const memory = new MemoryService(store)
  const runtimeApi: RuntimeApi = {
    accountId: "a1",
    sendMessage: async () => ({ messageId: "m" }),
    getChatHistory: async () => [],
    markRead: async () => {},
    memory,
  }
  const agent = new Agent({
    config,
    provider,
    registry,
    policy: new Policy(config),
    session: new SessionManager(store, config),
    bus: new EventBus(),
    logger: noopLogger,
    autoApprove: true,
    makeToolContext: (info) => ({
      logger: noopLogger,
      runtime: runtimeApi,
      store: emptyStore,
      sessionId: info.sessionId,
      accountId: info.accountId,
      chatId: info.chatId,
      senderId: info.senderId,
      requestApproval: async () => ({ approved: true }),
    }),
  })
  return { agent, store, memory }
}

test("loop agen memanggil tool lalu menyelesaikan dengan teks", async () => {
  const provider = new ScriptedProvider([
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "1", name: "memory_remember", arguments: { text: "pengguna suka kopi", scope: "global" } }],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    { message: { role: "assistant", content: "Baik, saya ingat." }, usage: { inputTokens: 3, outputTokens: 2 } },
  ])

  const { agent, store } = buildAgent(provider)
  const result = await agent.run({
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    role: "hybrid",
    senderId: "s1",
    sessionId: "a1:c1",
  })

  assert.equal(result.reason, "completed")
  assert.equal(result.text, "Baik, saya ingat.")
  assert.equal(result.steps, 2)
  assert.equal(result.usage.inputTokens, 13)
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0]!.ok, true)
  assert.equal(store.countMemory(), 1)
  store.close()
})

test("mode readonly menolak tool yang mengubah keadaan", async () => {
  const provider = new ScriptedProvider([
    {
      message: {
        role: "assistant",
        content: null,
        // memory_forget berisiko medium → ditolak pada readonly
        toolCalls: [{ id: "1", name: "memory_forget", arguments: { id: "x" } }],
      },
      usage: {},
    },
    { message: { role: "assistant", content: "Tidak bisa." }, usage: {} },
  ])

  const { agent } = buildAgent(provider, { autonomy: "readonly" })
  const result = await agent.run({
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    role: "hybrid",
    senderId: "s1",
    sessionId: "a1:c1",
  })

  assert.equal(result.toolCalls[0]!.ok, false)
  assert.equal(result.text, "Tidak bisa.")
})

test("mode suggest memarkir aksi yang butuh persetujuan", async () => {
  const provider = new ScriptedProvider([
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "1", name: "memory_forget", arguments: { id: "x" } }],
      },
      usage: {},
    },
  ])

  // autoApprove=false pada mode suggest → harus berhenti meminta persetujuan.
  const store = new Store(":memory:")
  const config = ConfigSchema.parse({ autonomy: "suggest" })
  const registry = new SkillRegistry()
  registry.register(coreMemorySkill)
  const agent = new Agent({
    config,
    provider,
    registry,
    policy: new Policy(config),
    session: new SessionManager(store, config),
    bus: new EventBus(),
    logger: noopLogger,
    autoApprove: false,
    makeToolContext: (info) => ({
      logger: noopLogger,
      runtime: {
        accountId: "a1",
        sendMessage: async () => ({ messageId: "m" }),
        getChatHistory: async () => [],
        markRead: async () => {},
        memory: new MemoryService(store),
      },
      store: emptyStore,
      sessionId: info.sessionId,
      accountId: info.accountId,
      chatId: info.chatId,
      senderId: info.senderId,
      requestApproval: async () => ({ approved: false }),
    }),
  })

  const result = await agent.run({
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    role: "hybrid",
    senderId: "s1",
    sessionId: "a1:c1",
  })
  assert.equal(result.reason, "approval-required")
  store.close()
})
