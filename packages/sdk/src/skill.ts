import type { JsonSchemaObject, Skill, Tool } from "./types.ts"

/**
 * Helper penulisan skill. Fungsi-fungsi ini bersifat identitas (tidak
 * mengubah nilai) tetapi memberikan inferensi tipe dan validasi ringan.
 */

export interface DefineToolInput<In, Out> {
  name: string
  description: string
  /** Skema parameter JSON (kompatibel MCP/OpenAI). */
  parameters: JsonSchemaObject
  risk?: Tool["risk"]
  requiresApproval?: boolean
  execute: Tool<In, Out>["execute"]
}

export function defineTool<In = Record<string, unknown>, Out = unknown>(
  input: DefineToolInput<In, Out>,
): Tool<In, Out> {
  if (!input.name) throw new Error("defineTool: nama tool wajib diisi")
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.name)) {
    throw new Error(`defineTool: nama tool tidak valid: "${input.name}" (gunakan huruf, angka, _ atau -)`)
  }
  if (!input.description) throw new Error(`defineTool: deskripsi tool "${input.name}" wajib diisi`)
  if (!input.parameters || input.parameters.type !== "object") {
    throw new Error(`defineTool: parameters tool "${input.name}" harus berupa JsonSchemaObject`)
  }
  return {
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    risk: input.risk ?? "low",
    requiresApproval: input.requiresApproval,
    execute: input.execute,
  }
}

export interface DefineSkillInput {
  id: string
  name: string
  description?: string
  version?: string
  tools?: Tool[]
  commands?: Skill["commands"]
  jobs?: Skill["jobs"]
  onInbound?: Skill["onInbound"]
  systemPrompt?: string
  setup?: Skill["setup"]
}

export function defineSkill(input: DefineSkillInput): Skill {
  if (!input.id) throw new Error("defineSkill: id wajib diisi")
  if (!input.name) throw new Error(`defineSkill: name wajib diisi untuk skill "${input.id}"`)
  const seen = new Set<string>()
  for (const tool of input.tools ?? []) {
    if (seen.has(tool.name)) throw new Error(`defineSkill: nama tool duplikat "${tool.name}" di skill "${input.id}"`)
    seen.add(tool.name)
  }
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    version: input.version ?? "0.1.0",
    tools: input.tools ?? [],
    commands: input.commands ?? [],
    jobs: input.jobs ?? [],
    onInbound: input.onInbound,
    systemPrompt: input.systemPrompt,
    setup: input.setup,
  }
}

/** Nama tool yang dipakai agen untuk mengakhiri gilirannya. */
export const FINISH_TOOL_NAME = "finish"
