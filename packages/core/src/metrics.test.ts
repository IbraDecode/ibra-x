import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { InboundMessage } from "@ibrax/sdk"
import { EventBus } from "./events.ts"
import { MetricsRegistry } from "./metrics.ts"

test("MetricsRegistry mengagregasi event bus", () => {
  const bus = new EventBus()
  const metrics = new MetricsRegistry(bus)

  bus.emit("inbound.message", { id: "m1" } as InboundMessage)
  bus.emit("outbound.message", { accountId: "a1", chatId: "c1", text: "halo" })
  bus.emit("agent.step", { sessionId: "s1", step: 1, kind: "llm" })
  bus.emit("agent.tool", { sessionId: "s1", tool: "t", risk: "low", ok: false, ms: 3 })
  bus.emit("agent.finished", {
    sessionId: "s1",
    reason: "completed",
    usage: { inputTokens: 100, outputTokens: 40 },
  })
  bus.emit("agent.finished", { sessionId: "sub:abc", reason: "completed" })
  bus.emit("poll.vote", { accountId: "a1", chatId: "c1", pollId: "p1", votes: [] })
  bus.emit("memory.written", { id: "mem1", scope: "contact", text: "x" })
  bus.emit("error", { scope: "x", error: new Error("boom") })

  const s = metrics.snapshot()
  assert.equal(s.inboundMessages, 1)
  assert.equal(s.outboundMessages, 1)
  assert.equal(s.llmCalls, 1)
  assert.equal(s.toolCalls, 1)
  assert.equal(s.toolErrors, 1)
  assert.equal(s.agentRuns, 1)
  assert.equal(s.subagentRuns, 1)
  assert.equal(s.pollVotes, 1)
  assert.equal(s.memoryWrites, 1)
  assert.equal(s.errors, 1)
  assert.equal(s.inputTokens, 100)
  assert.equal(s.outputTokens, 40)
})

test("MetricsRegistry.detach menghentikan agregasi", () => {
  const bus = new EventBus()
  const metrics = new MetricsRegistry(bus)
  bus.emit("inbound.message", { id: "m1" } as InboundMessage)
  assert.equal(metrics.snapshot().inboundMessages, 1)
  metrics.detach()
  bus.emit("inbound.message", { id: "m2" } as InboundMessage)
  assert.equal(metrics.snapshot().inboundMessages, 1, "setelah detach tidak bertambah")
})
