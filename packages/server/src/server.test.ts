import { strict as assert } from "node:assert"
import { test } from "node:test"
import { ConfigSchema, type IbraConfig } from "@ibrax/core"
import type { IbraApp } from "@ibrax/app"
import { createServer } from "./index.ts"

function stubApp(configOverrides: Record<string, unknown> = {}): IbraApp {
  const config = ConfigSchema.parse(configOverrides)
  const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger } }
  return {
    config,
    logger,
    store: {
      countMessages: () => 7,
      countMemory: () => 3,
      listChats: () => [],
      searchMemory: () => [],
    },
    bus: { on: () => () => {} },
    registry: { list: () => [{ id: "x", name: "X", tools: [] }] },
    manager: { accountIds: ["a1"], getRuntime: () => ({ status: "open" }) },
    runtime: {
      session: { sessionId: (a: string, b: string) => `${a}:${b}` },
      agent: { run: async () => ({ text: "hai", reason: "completed", steps: 1, usage: {} }) },
    },
    scheduler: { stop() {} },
    start: async () => {},
    stop: () => {},
  } as unknown as IbraApp
}

test("GET /health mengembalikan ok", async () => {
  const server = createServer(stubApp())
  const res = await server.fetch(new Request("http://localhost/health"))
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean }
  assert.equal(body.ok, true)
})

test("GET / menyajikan dashboard HTML", async () => {
  const server = createServer(stubApp())
  const res = await server.fetch(new Request("http://localhost/"))
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /Ibra X/)
  assert.match(html, /\/api\/events/)
})

test("API terlindungi token dan menerima token via query", async () => {
  const server = createServer(stubApp({ apiToken: "rahasia" }))

  const denied = await server.fetch(new Request("http://localhost/api/status"))
  assert.equal(denied.status, 401)

  const allowed = await server.fetch(new Request("http://localhost/api/status?token=rahasia"))
  assert.equal(allowed.status, 200)
  const body = (await allowed.json()) as { provider: string; counts: { messages: number } }
  assert.equal(body.counts.messages, 7)

  const headerAllowed = await server.fetch(
    new Request("http://localhost/api/status", { headers: { "x-api-token": "rahasia" } }),
  )
  assert.equal(headerAllowed.status, 200)
})
