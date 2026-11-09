import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { serve } from "@hono/node-server"
import { createApp, type CreateAppOptions, type IbraApp } from "@ibrax/app"
import { VERSION, loadConfig, type IbraConfig } from "@ibrax/core"
import { dashboardHtml } from "./dashboard.ts"

export interface StartServerOptions extends CreateAppOptions {
  app?: IbraApp
}

export interface RunningServer {
  app: IbraApp
  port: number
  close(): Promise<void>
}

/**
 * Membangun aplikasi Hono untuk mengontrol Ibra X: status, chat ke agen,
 * pencarian memori, daftar skill, dan aliran event (SSE).
 */
export function createServer(app: IbraApp) {
  const server = new Hono()
  const startedAt = Date.now()

  // Autentikasi token opsional (header atau query `token` untuk EventSource).
  server.use("/api/*", async (c, next) => {
    const token = app.config.apiToken
    if (token) {
      const provided = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.header("x-api-token") ?? c.req.query("token")
      if (provided !== token) return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  })

  server.get("/", (c) => c.html(dashboardHtml()))
  server.get("/health", (c) => c.json({ ok: true, uptimeMs: Date.now() - startedAt }))

  server.get("/api/status", (c) =>
    c.json({
      version: VERSION,
      provider: app.config.provider,
      model: app.config.model,
      autonomy: app.config.autonomy,
      accounts: app.config.accounts.map((a) => ({
        id: a.id,
        role: a.role,
        enabled: a.enabled,
        label: a.label,
      })),
      skills: app.registry.list().map((s) => ({ id: s.id, name: s.name, tools: (s.tools ?? []).map((t) => t.name) })),
      counts: { messages: app.store.countMessages(), memory: app.store.countMemory() },
      uptimeMs: Date.now() - startedAt,
    }),
  )

  server.get("/api/accounts", (c) => c.json(app.manager.accountIds.map((id) => ({ id, status: app.manager.getRuntime(id)?.status }))))

  server.get("/api/chats", (c) => c.json(app.store.listChats()))

  server.get("/api/memory/search", (c) => {
    const q = c.req.query("q") ?? ""
    const limit = Number(c.req.query("limit") ?? 20)
    if (!q) return c.json({ error: "parameter q wajib" }, 400)
    return c.json(app.store.searchMemory(q, { limit }))
  })

  server.get("/api/skills", (c) =>
    c.json(
      app.registry.list().map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        tools: (s.tools ?? []).map((t) => ({ name: t.name, description: t.description, risk: t.risk })),
      })),
    ),
  )

  server.post("/api/chat", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { chatId?: string; text?: string; senderId?: string; accountId?: string }
    if (!body.text) return c.json({ error: "field 'text' wajib" }, 400)
    const accountId = body.accountId ?? app.config.accounts[0]?.id ?? "default"
    const chatId = body.chatId ?? "api:local"
    const senderId = body.senderId ?? "api:local"

    app.store.insertMessage({
      id: `api-${randomUUID()}`,
      accountId,
      chatId,
      senderId,
      fromMe: false,
      text: body.text,
      timestamp: Date.now(),
    })

    const sessionId = app.runtime.session.sessionId(accountId, chatId)
    const result = await app.runtime.agent.run({
      accountId,
      chatId,
      chatKind: "dm",
      role: "hybrid",
      senderId,
      sessionId,
    })
    return c.json({ text: result.text, reason: result.reason, steps: result.steps, usage: result.usage })
  })

  server.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const events = [
        "inbound.message",
        "outbound.message",
        "agent.step",
        "agent.tool",
        "agent.finished",
        "account.status",
        "memory.written",
      ] as const
      const unsubs = events.map((event) =>
        app.bus.on(event, (payload) => {
          void stream.writeSSE({ event, data: JSON.stringify(payload) })
        }),
      )
      const keepAlive = setInterval(() => void stream.writeSSE({ event: "ping", data: String(Date.now()) }), 15_000)
      stream.onAbort(() => {
        clearInterval(keepAlive)
        for (const unsub of unsubs) unsub()
      })
      await new Promise<void>((resolve) => stream.onAbort(resolve))
    }),
  )

  return server
}

/** Menjalankan app + server HTTP. */
export async function startServer(config: IbraConfig, opts: StartServerOptions = {}): Promise<RunningServer> {
  const app = opts.app ?? (await createApp(config, { ...opts, autoStart: true }))
  const server = createServer(app)

  const instance = serve(
    { fetch: server.fetch, port: config.port, hostname: config.host },
    (info) => app.logger.info({ port: info.port, host: config.host }, "server Ibra X berjalan"),
  )

  return {
    app,
    port: config.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => instance.close((err) => (err ? reject(err) : resolve())))
      app.stop()
    },
  }
}

// Entri mandiri: `npm run server`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config } = loadConfig()
  startServer(config).catch((error) => {
    console.error("Gagal menjalankan server:", error)
    process.exit(1)
  })
}
