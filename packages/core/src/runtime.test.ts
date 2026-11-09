import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { CompleteRequest, CompletionResult, Logger, Provider, StreamChunk } from "@ibrax/sdk"
import { ConfigSchema } from "./config.ts"
import { Store } from "./db.ts"
import { EventBus } from "./events.ts"
import { Runtime } from "./runtime.ts"
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

test("batas kedalaman subagen mencegah rekursi", async () => {
  // Anak mencoba memanggil spawn_subagent lagi → harus ditolak oleh batas kedalaman.
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
