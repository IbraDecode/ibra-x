import type {
  ChatMessage,
  CompleteRequest,
  CompletionResult,
  Provider,
  ProviderInfo,
  StreamChunk,
  ToolCall,
  ToolSchema,
  Usage,
} from "@ibrax/sdk"

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

export interface CreateProviderOptions {
  apiKey?: string
  baseUrl?: string
  headers?: Record<string, string>
  /** Timeout untuk koneksi awal (ms). Default 120000. */
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// Pemetaan pesan ke format OpenAI
// ---------------------------------------------------------------------------

function toOpenAIMessage(msg: ChatMessage): Record<string, unknown> {
  switch (msg.role) {
    case "tool":
      return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content ?? "" }
    case "assistant":
      if (msg.toolCalls?.length) {
        return {
          role: "assistant",
          content: msg.content,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
          })),
        }
      }
      return { role: "assistant", content: msg.content ?? "" }
    default:
      return { role: msg.role, content: msg.content ?? "" }
  }
}

function toOpenAITools(tools?: ToolSchema[]): unknown[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

// ---------------------------------------------------------------------------
// Parser SSE
// ---------------------------------------------------------------------------

async function* iterateSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        yield line
      }
    }
    if (buffer.length) yield buffer
  } finally {
    reader.releaseLock()
  }
}

interface AccumulatedToolCall {
  id?: string
  name?: string
  arguments: string
}

// ---------------------------------------------------------------------------
// Engine generik
// ---------------------------------------------------------------------------

export function createProvider(info: ProviderInfo, opts: CreateProviderOptions = {}): Provider {
  const baseUrl = (opts.baseUrl ?? info.baseUrl).replace(/\/$/, "")

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(info.headers ?? {}),
    ...(opts.headers ?? {}),
  }
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`

  const buildBody = (req: CompleteRequest, stream: boolean) => ({
    model: req.model,
    messages: req.messages.map(toOpenAIMessage),
    tools: toOpenAITools(req.tools),
    tool_choice: req.tools?.length ? "auto" : undefined,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    stream,
    stream_options: stream ? { include_usage: true } : undefined,
  })

  async function requestStream(req: CompleteRequest): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000)
    const onAbort = () => controller.abort()
    req.signal?.addEventListener("abort", onAbort)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(req, true)),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new ProviderError(`Provider ${info.id} gagal (HTTP ${res.status})`, res.status, text)
      }
      return res
    } finally {
      clearTimeout(timer)
      req.signal?.removeEventListener("abort", onAbort)
    }
  }

  async function* stream(req: CompleteRequest): AsyncGenerator<StreamChunk> {
    const res = await requestStream(req)
    for await (const line of iterateSSE(res.body!, req.signal)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(":")) continue
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]") break

      let json: any
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }

      const choice = json.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) {
        yield { type: "text", delta: String(delta.content) }
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          yield {
            type: "tool_call",
            index: tc.index ?? 0,
            id: tc.id,
            name: tc.function?.name,
            argumentsDelta: tc.function?.arguments,
          }
        }
      }
      if (json.usage) {
        yield {
          type: "usage",
          usage: { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens },
        }
      }
      if (choice?.finish_reason) {
        yield { type: "done", finishReason: choice.finish_reason }
      }
    }
  }

  async function complete(req: CompleteRequest): Promise<CompletionResult> {
    let text = ""
    const toolCalls = new Map<number, AccumulatedToolCall>()
    const usage: Usage = {}
    let finishReason: string | undefined

    for await (const chunk of stream(req)) {
      switch (chunk.type) {
        case "text":
          text += chunk.delta
          break
        case "tool_call": {
          const acc = toolCalls.get(chunk.index) ?? { arguments: "" }
          if (chunk.id) acc.id = chunk.id
          if (chunk.name) acc.name = chunk.name
          if (chunk.argumentsDelta) acc.arguments += chunk.argumentsDelta
          toolCalls.set(chunk.index, acc)
          break
        }
        case "usage":
          Object.assign(usage, chunk.usage)
          break
        case "done":
          finishReason = chunk.finishReason
          break
      }
    }

    const calls: ToolCall[] = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, acc]) => ({
        id: acc.id ?? `call_${index}`,
        name: acc.name ?? "",
        arguments: safeParseArgs(acc.arguments),
      }))
      .filter((c) => c.name)

    return {
      message: {
        role: "assistant",
        content: text.length ? text : null,
        toolCalls: calls.length ? calls : undefined,
      },
      usage,
      finishReason,
    }
  }

  return { info: { ...info, baseUrl }, stream, complete }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
