import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { ToolContext } from "@ibrax/sdk"
import { McpClient, mcpSkillFromClient, type McpTransport } from "./mcp.ts"

interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

/** Transport tiruan yang membalas handshake & tools layaknya server MCP. */
class FakeTransport implements McpTransport {
  private handler?: (m: JsonRpcMessage) => void
  public sent: JsonRpcMessage[] = []

  onMessage(handler: (m: JsonRpcMessage) => void): void {
    this.handler = handler
  }
  onError(): void {}

  async start(): Promise<void> {}

  send(message: JsonRpcMessage): void {
    this.sent.push(message)
    if (message.method === "initialize") {
      this.reply(message.id, { protocolVersion: "2024-11-05", serverInfo: { name: "fake", version: "1.0" } })
    } else if (message.method === "tools/list") {
      this.reply(message.id, {
        tools: [
          { name: "echo", description: "Mengembalikan teks", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
          { name: "boom", description: "Selalu gagal", inputSchema: { type: "object", properties: {} } },
        ],
      })
    } else if (message.method === "tools/call") {
      const params = message.params as { name: string; arguments: Record<string, unknown> }
      if (params.name === "boom") {
        this.reply(message.id, { content: [{ type: "text", text: "rusak" }], isError: true })
      } else {
        this.reply(message.id, { content: [{ type: "text", text: `echo:${String(params.arguments.text)}` }] })
      }
    }
  }

  private reply(id: JsonRpcMessage["id"], result: unknown): void {
    queueMicrotask(() => this.handler?.({ jsonrpc: "2.0", id, result }))
  }

  async close(): Promise<void> {}
}

test("client MCP melakukan handshake, daftar tool, dan pemanggilan", async () => {
  const transport = new FakeTransport()
  const client = new McpClient(transport)
  await client.initialize()
  assert.equal(client.serverInfo?.name, "fake")

  const tools = await client.listTools()
  assert.equal(tools.length, 2)

  const out = await client.callTool("echo", { text: "hai" })
  assert.equal(out, "echo:hai")

  const err = (await client.callTool("boom", {})) as { error?: string }
  assert.match(err.error ?? "", /rusak/)
})

test("skill MCP memetakan tool dan menandai risiko", async () => {
  const transport = new FakeTransport()
  const client = new McpClient(transport)
  await client.initialize()
  const tools = await client.listTools()

  const skill = mcpSkillFromClient("fake", client, tools, { prefix: "fake__", risk: "medium" })
  assert.equal(skill.id, "fake")
  assert.equal(skill.tools?.length, 2)
  assert.equal(skill.tools?.[0]!.name, "fake__echo")
  assert.equal(skill.tools?.[0]!.risk, "medium")

  const result = await skill.tools![0]!.execute({ text: "x" }, {} as ToolContext)
  assert.equal(result, "echo:x")
})
