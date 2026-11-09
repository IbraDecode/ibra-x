import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Logger } from "@ibrax/sdk"
import { EventBus } from "./events.ts"
import { WebhookDispatcher, signPayload } from "./webhooks.ts"

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

const tick = () => new Promise((r) => setTimeout(r, 10))

test("signPayload deterministik dan berformat sha256=", () => {
  const a = signPayload("rahasia", '{"x":1}')
  const b = signPayload("rahasia", '{"x":1}')
  assert.equal(a, b)
  assert.match(a, /^sha256=[0-9a-f]{64}$/)
  assert.notEqual(a, signPayload("lain", '{"x":1}'))
})

test("deliver mengirim body dan menandatangani bila ada secret", async () => {
  let captured: { url: string; body: string; signature?: string; method?: string } | undefined
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    captured = { url: String(url), body: String(init?.body), signature: headers["x-ibra-signature"], method: init?.method }
    return new Response("{}", { status: 200 })
  }) as typeof fetch

  const dispatcher = new WebhookDispatcher(new EventBus(), { logger: noopLogger, fetchImpl: fakeFetch })
  const ok = await dispatcher.deliver({ url: "https://hook.test/a", secret: "s" }, "agent.finished", { text: "hai" })

  assert.equal(ok, true)
  assert.equal(captured?.method, "POST")
  assert.equal(captured?.url, "https://hook.test/a")
  assert.match(captured?.signature ?? "", /^sha256=/)
  const parsed = JSON.parse(captured!.body)
  assert.equal(parsed.event, "agent.finished")
  assert.equal(parsed.data.text, "hai")
})

test("deliver mencoba ulang lalu gagal", async () => {
  let count = 0
  const fakeFetch = (async () => {
    count++
    return new Response("boom", { status: 500 })
  }) as typeof fetch

  const dispatcher = new WebhookDispatcher(new EventBus(), { logger: noopLogger, fetchImpl: fakeFetch, attempts: 3 })
  const ok = await dispatcher.deliver({ url: "https://hook.test/b" }, "error", {})
  assert.equal(ok, false)
  assert.equal(count, 3, "mencoba sebanyak attempts")
})

test("start berlangganan hanya pada event yang diizinkan", async () => {
  const calls: Array<{ url: string }> = []
  const fakeFetch = (async (url: string | URL) => {
    calls.push({ url: String(url) })
    return new Response("{}", { status: 200 })
  }) as typeof fetch

  const bus = new EventBus()
  const dispatcher = new WebhookDispatcher(bus, { logger: noopLogger, fetchImpl: fakeFetch })
  dispatcher.start([{ url: "https://hook.test/c", events: ["memory.written"] }])

  bus.emit("memory.written", { id: "1", scope: "global", text: "hi" })
  bus.emit("inbound.message", {
    id: "m",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm",
    senderId: "s1",
    fromMe: false,
    timestamp: 1,
    text: "halo",
  })
  await tick()

  assert.equal(calls.length, 1, "hanya memory.written yang dikirim")
  dispatcher.stop()

  bus.emit("memory.written", { id: "2", scope: "global", text: "lagi" })
  await tick()
  assert.equal(calls.length, 1, "setelah stop tidak ada pengiriman")
})
