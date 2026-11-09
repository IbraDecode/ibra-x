import {
  FINISH_TOOL_NAME,
  type ChatMessage,
  type CompletionResult,
  type Logger,
  type Provider,
  type ToolSchema,
  type Usage,
} from "@ibrax/sdk"
import { finishTool } from "./builtin.ts"
import type { IbraConfig } from "./config.ts"
import type { EventBus } from "./events.ts"
import type { Policy } from "./policy.ts"
import type { SessionManager } from "./session.ts"
import type { SkillRegistry } from "./skills.ts"
import type { ToolContext } from "@ibrax/sdk"

const MAX_TOOL_RESULT_CHARS = 4000

export type ToolContextFactory = (info: {
    sessionId: string
    accountId: string
    chatId?: string
    senderId?: string
    skillId: string
    signal?: AbortSignal
  }) => ToolContext

export interface AgentDeps {
  config: IbraConfig
  provider: Provider
  registry: SkillRegistry
  policy: Policy
  session: SessionManager
  bus: EventBus
  logger: Logger
  makeToolContext: ToolContextFactory
  /** Bila true, aksi `ask` dijalankan tanpa persetujuan (mis. mode auto/CLI --yes). */
  autoApprove?: boolean
}

export interface AgentRunInput {
  accountId: string
  chatId: string
  chatKind: "dm" | "group"
  role: string
  senderId: string
  sessionId: string
  /** Model khusus; default dari config. */
  model?: string
}

export interface AgentRunResult {
  text: string
  steps: number
  usage: Usage
  reason: "completed" | "finish" | "max-steps" | "approval-required" | "error"
  toolCalls: Array<{ name: string; ok: boolean }>
}

/**
 * Loop agen: panggil model dengan skema tool, jalankan tool yang diizinkan
 * policy, dan akhiri saat model menyampaikan jawaban akhir atau memanggil
 * tool `finish`. Batas langkah dan token menjaga biaya tetap terkendali.
 */
export class Agent {
  constructor(private readonly deps: AgentDeps) {}

  private toolSchemas(): ToolSchema[] {
    const tools = [...this.deps.registry.tools(), finishTool]
    return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { config, provider, session, bus, logger, registry } = this.deps
    const model = input.model ?? config.model
    const autonomy =
      input.role === "observer" ? "readonly" : config.autonomy

    const messages: ChatMessage[] = session.buildMessages({
      accountId: input.accountId,
      chatId: input.chatId,
      role: input.role,
      chatKind: input.chatKind,
      skills: registry.list(),
    })

    const schemas = this.toolSchemas()
    const usage: Usage = {}
    const executed: Array<{ name: string; ok: boolean }> = []
    let lastText = ""

    for (let step = 1; step <= config.maxSteps; step++) {
      bus.emit("agent.step", { sessionId: input.sessionId, step, kind: "llm", detail: model })

      let res: CompletionResult
      try {
        res = await provider.complete({
          model,
          messages,
          tools: schemas,
          temperature: config.temperature,
          maxTokens: config.maxTokensPerTurn,
        })
      } catch (error) {
        logger.error({ error, step }, "panggilan model gagal")
        bus.emit("error", { scope: "agent.llm", error })
        return { text: lastText || "Maaf, terjadi kesalahan saat memproses permintaan.", steps: step, usage, reason: "error", toolCalls: executed }
      }

      usage.inputTokens = (usage.inputTokens ?? 0) + (res.usage.inputTokens ?? 0)
      usage.outputTokens = (usage.outputTokens ?? 0) + (res.usage.outputTokens ?? 0)

      const msg = res.message
      if (msg.content) lastText = msg.content

      if (!msg.toolCalls?.length) {
        const text = (msg.content ?? "").trim()
        messages.push({ role: "assistant", content: msg.content })
        bus.emit("agent.finished", { sessionId: input.sessionId, reason: "completed", text })
        return { text, steps: step, usage, reason: "completed", toolCalls: executed }
      }

      messages.push({ role: "assistant", content: msg.content, toolCalls: msg.toolCalls })

      for (const call of msg.toolCalls) {
        if (call.name === FINISH_TOOL_NAME) {
          const text = String(call.arguments.text ?? msg.content ?? "").trim()
          bus.emit("agent.finished", { sessionId: input.sessionId, reason: "finish", text })
          return { text, steps: step, usage, reason: "finish", toolCalls: executed }
        }

        const found = registry.getTool(call.name)
        if (!found) {
          pushToolResult(messages, call.id, call.name, { error: `Tool "${call.name}" tidak ditemukan.` })
          executed.push({ name: call.name, ok: false })
          continue
        }

        const decision = this.deps.policy.decideTool(
          { name: found.tool.name, risk: found.tool.risk, requiresApproval: found.tool.requiresApproval },
          { autonomy },
        )

        if (decision.effect === "deny") {
          pushToolResult(messages, call.id, call.name, { error: `Ditolak oleh policy: ${decision.reason}` })
          executed.push({ name: call.name, ok: false })
          continue
        }

        if (decision.effect === "ask" && !this.deps.autoApprove) {
          const text = `Aksi \`${call.name}\` memerlukan persetujuan (${decision.reason}). Menunggu konfirmasi.`
          bus.emit("agent.finished", { sessionId: input.sessionId, reason: "approval-required", text })
          return { text, steps: step, usage, reason: "approval-required", toolCalls: executed }
        }

        const ctx = this.deps.makeToolContext({
          sessionId: input.sessionId,
          accountId: input.accountId,
          chatId: input.chatId,
          senderId: input.senderId,
          skillId: found.skill.id,
        })

        const t0 = Date.now()
        let ok = true
        let result: unknown
        try {
          result = await found.tool.execute(call.arguments, ctx)
        } catch (error) {
          ok = false
          result = { error: error instanceof Error ? error.message : String(error) }
        }
        const ms = Date.now() - t0
        bus.emit("agent.tool", { sessionId: input.sessionId, tool: call.name, risk: found.tool.risk, ok, ms })
        executed.push({ name: call.name, ok })
        pushToolResult(messages, call.id, call.name, result)
      }
    }

    const text = lastText || "Batas langkah tercapai. Mohon persempit permintaan."
    bus.emit("agent.finished", { sessionId: input.sessionId, reason: "max-steps", text })
    return { text, steps: config.maxSteps, usage, reason: "max-steps", toolCalls: executed }
  }
}

function pushToolResult(messages: ChatMessage[], toolCallId: string, name: string, result: unknown): void {
  let content: string
  try {
    content = typeof result === "string" ? result : JSON.stringify(result)
  } catch {
    content = String(result)
  }
  if (content.length > MAX_TOOL_RESULT_CHARS) content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…(terpotong)`
  messages.push({ role: "tool", toolCallId, name, content })
}
