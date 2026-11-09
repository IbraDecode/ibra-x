import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { defineSkill, type JsonSchemaObject, type Logger, type Skill, type Tool } from "@ibrax/sdk"
import { VERSION } from "./version.ts"

// ---------------------------------------------------------------------------
// JSON-RPC / MCP
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: JsonSchemaObject
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

/**
 * Abstraksi transport MCP (stdio atau HTTP). Client bersifat transport-agnostik
 * sehingga mudah diuji dan diperluas.
 */
export interface McpTransport {
  send(message: JsonRpcMessage): void
  onMessage(handler: (message: JsonRpcMessage) => void): void
  onError(handler: (error: Error) => void): void
  start(): Promise<void>
  close(): Promise<void>
}

const PROTOCOL_VERSION = "2024-11-05"

/** Client MCP: menangani handshake, daftar tool, dan pemanggilan tool. */
export class McpClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private closed = false
  public serverInfo?: { name?: string; version?: string }

  constructor(
    private readonly transport: McpTransport,
    private readonly logger?: Logger,
    private readonly requestTimeoutMs = 30_000,
  ) {
    transport.onMessage((message) => this.handle(message))
    transport.onError((error) => this.failAll(error))
  }

  private handle(message: JsonRpcMessage): void {
    if (message.id === undefined) return
    const entry = this.pending.get(Number(message.id))
    if (!entry) return
    this.pending.delete(Number(message.id))
    if (message.error) entry.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`))
    else entry.resolve(message.result)
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("MCP client sudah ditutup"))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      // Timeout agar permintaan tidak menggantung selamanya bila server MCP diam.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timeout (${method}, ${this.requestTimeoutMs}ms)`))
      }, this.requestTimeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.transport.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  private notify(method: string, params?: unknown): void {
    this.transport.send({ jsonrpc: "2.0", method, params })
  }

  async initialize(): Promise<void> {
    await this.transport.start()
    const result = (await this.request<{ serverInfo?: { name?: string; version?: string } }>("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ibra-x", version: VERSION },
    })) as { serverInfo?: { name?: string; version?: string } }
    this.serverInfo = result?.serverInfo
    this.notify("notifications/initialized")
    this.logger?.debug({ server: this.serverInfo }, "MCP terinisialisasi")
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request<{ tools?: McpToolDefinition[] }>("tools/list")
    return result?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.request<{ content?: unknown[]; isError?: boolean }>("tools/call", {
      name,
      arguments: args,
    })) as { content?: unknown[]; isError?: boolean }
    return normalizeToolResult(result)
  }

  async close(): Promise<void> {
    this.closed = true
    this.failAll(new Error("MCP client ditutup"))
    await this.transport.close()
  }
}

function normalizeToolResult(result: { content?: unknown[]; isError?: boolean }): unknown {
  if (result?.isError) {
    return { error: extractText(result.content) ?? "tool MCP mengembalikan error" }
  }
  const text = extractText(result?.content)
  return text ?? result
}

function extractText(content: unknown[] | undefined): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts = content
    .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
    .map((c) => (c.type === "text" ? (c.text ?? "") : JSON.stringify(c)))
  return parts.length ? parts.join("\n") : undefined
}

// ---------------------------------------------------------------------------
// Transport: stdio
// ---------------------------------------------------------------------------

export interface StdioMcpOptions {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

/** Transport stdio: menjalankan server MCP sebagai subprocess, JSON per baris. */
export class StdioMcpTransport implements McpTransport {
  private child?: ChildProcessWithoutNullStreams
  private messageHandler?: (m: JsonRpcMessage) => void
  private errorHandler?: (e: Error) => void
  private buffer = ""

  constructor(private readonly opts: StdioMcpOptions) {}

  onMessage(handler: (m: JsonRpcMessage) => void): void {
    this.messageHandler = handler
  }

  onError(handler: (e: Error) => void): void {
    this.errorHandler = handler
  }

  async start(): Promise<void> {
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child = child

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.onData(chunk))
    child.stderr.resume()
    child.on("error", (error) => this.errorHandler?.(error instanceof Error ? error : new Error(String(error))))
    child.on("exit", (code) => {
      if (code && code !== 0) this.errorHandler?.(new Error(`Server MCP keluar dengan kode ${code}`))
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf("\n")
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line?.startsWith("{")) {
        try {
          this.messageHandler?.(JSON.parse(line) as JsonRpcMessage)
        } catch {
          // abaikan baris yang bukan JSON
        }
      }
      idx = this.buffer.indexOf("\n")
    }
  }

  send(message: JsonRpcMessage): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`)
  }

  async close(): Promise<void> {
    this.child?.stdin.end()
    this.child?.kill()
  }
}

// ---------------------------------------------------------------------------
// Transport: Streamable HTTP
// ---------------------------------------------------------------------------

export interface HttpMcpOptions {
  url: string
  headers?: Record<string, string>
}

/** Transport HTTP (Streamable HTTP): satu POST per pesan JSON-RPC; balasan JSON. */
export class HttpMcpTransport implements McpTransport {
  private messageHandler?: (m: JsonRpcMessage) => void
  private errorHandler?: (e: Error) => void
  private sessionId?: string

  constructor(private readonly opts: HttpMcpOptions) {}

  onMessage(handler: (m: JsonRpcMessage) => void): void {
    this.messageHandler = handler
  }

  onError(handler: (e: Error) => void): void {
    this.errorHandler = handler
  }

  async start(): Promise<void> {
    // Tidak ada koneksi persisten; handshake dilakukan lewat request pertama.
  }

  send(message: JsonRpcMessage): void {
    void this.post(message).catch((error) => this.errorHandler?.(error instanceof Error ? error : new Error(String(error))))
  }

  private async post(message: JsonRpcMessage): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.opts.headers ?? {}),
    }
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId

    const res = await fetch(this.opts.url, { method: "POST", headers, body: JSON.stringify(message) })
    const sid = res.headers.get("mcp-session-id")
    if (sid) this.sessionId = sid
    if (!res.ok && res.status !== 202) throw new Error(`MCP HTTP ${res.status}`)
    const text = await res.text()
    if (!text) return
    // Balasan bisa berupa JSON tunggal atau SSE.
    if (text.startsWith("event:") || text.startsWith("data:") || text.includes("\ndata:")) {
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === "[DONE]") continue
        try {
          this.messageHandler?.(JSON.parse(payload) as JsonRpcMessage)
        } catch {
          // abaikan
        }
      }
      return
    }
    try {
      this.messageHandler?.(JSON.parse(text) as JsonRpcMessage)
    } catch {
      // abaikan
    }
  }

  async close(): Promise<void> {
    // tidak ada koneksi untuk ditutup
  }
}

// ---------------------------------------------------------------------------
// Skill dari server MCP
// ---------------------------------------------------------------------------

export interface McpSkillOptions {
  /** Tingkat risiko default untuk tool MCP (default "medium"). */
  risk?: Tool["risk"]
  /** Prefiks nama tool agar tidak bentrok antar-server. */
  prefix?: string
}

/** Mengubah tool MCP menjadi Skill Ibra X. */
export function mcpSkillFromClient(
  id: string,
  client: McpClient,
  tools: McpToolDefinition[],
  opts: McpSkillOptions = {},
): Skill {
  const prefix = opts.prefix ?? ""
  const risk = opts.risk ?? "medium"

  const mapped: Tool[] = tools.map((tool) => ({
    name: `${prefix}${tool.name}`,
    description: tool.description ?? `Tool MCP: ${tool.name}`,
    parameters: (tool.inputSchema as JsonSchemaObject) ?? { type: "object", properties: {} },
    risk: tool.annotations?.destructiveHint ? "high" : tool.annotations?.readOnlyHint ? "low" : risk,
    async execute(input) {
      return client.callTool(tool.name, (input ?? {}) as Record<string, unknown>)
    },
  }))

  return defineSkill({
    id,
    name: `MCP: ${client.serverInfo?.name ?? id}`,
    description: `Tool dari server MCP (${tools.length}).`,
    tools: mapped,
  })
}

export interface McpServerConfig {
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  /** Tingkat risiko default tool server ini. */
  risk?: Tool["risk"]
}

export interface LoadedMcp {
  skills: Skill[]
  clients: McpClient[]
}

/** Menyambung ke seluruh server MCP pada config dan mengubah tool-nya menjadi skill. */
export async function loadMcpSkills(
  servers: Record<string, McpServerConfig>,
  logger: Logger,
): Promise<LoadedMcp> {
  const skills: Skill[] = []
  const clients: McpClient[] = []

  for (const [id, cfg] of Object.entries(servers)) {
    const scopedLogger = logger.child({ mcp: id })
    try {
      const transport: McpTransport = cfg.url
        ? new HttpMcpTransport({ url: cfg.url })
        : cfg.command
          ? new StdioMcpTransport({ command: cfg.command, args: cfg.args, env: cfg.env })
          : (() => {
              throw new Error(`Server MCP "${id}" tidak punya 'command' atau 'url'`)
            })()

      const client = new McpClient(transport, scopedLogger)
      await client.initialize()
      const tools = await client.listTools()
      skills.push(mcpSkillFromClient(id, client, tools, { risk: cfg.risk, prefix: `${id}__` }))
      clients.push(client)
      scopedLogger.info({ tools: tools.length }, "server MCP dimuat")
    } catch (error) {
      scopedLogger.error({ error }, "gagal memuat server MCP")
    }
  }

  return { skills, clients }
}
