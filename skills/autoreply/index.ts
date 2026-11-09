import { randomUUID } from "node:crypto"
import {
  defineSkill,
  defineTool,
  type InboundHookContext,
  type InboundHookResult,
  type SkillStore,
} from "@ibrax/sdk"

interface Rule {
  id: string
  match: string
  isRegex?: boolean
  reply: string
  enabled: boolean
}

const KEY = "rules"

async function load(store: SkillStore): Promise<Rule[]> {
  return (await store.get<Rule[]>(KEY)) ?? []
}

async function save(store: SkillStore, rules: Rule[]): Promise<void> {
  await store.set(KEY, rules)
}

export function matchesRule(rule: Pick<Rule, "match" | "isRegex">, text: string): boolean {
  if (!text) return false
  if (rule.isRegex) {
    try {
      return new RegExp(rule.match, "i").test(text)
    } catch {
      return false
    }
  }
  return text.toLowerCase().includes(rule.match.toLowerCase())
}

/**
 * Skill: auto-reply deterministik. Hook `onInbound` dievaluasi SEBELUM agen
 * berjalan; bila ada aturan yang cocok, balasan dikirim tanpa memanggil LLM
 * (hemat biaya, latensi rendah, dan dapat diprediksi).
 */
export default defineSkill({
  id: "autoreply",
  name: "Auto-Reply",
  description: "Balasan otomatis berbasis aturan kata kunci/regex (tanpa memanggil LLM).",
  systemPrompt:
    "Gunakan `add_autoreply`, `list_autoreply`, dan `remove_autoreply` untuk mengelola aturan balasan otomatis.",
  tools: [
    defineTool<{ match: string; reply: string; isRegex?: boolean }, { id: string; total: number }>({
      name: "add_autoreply",
      description: "Tambah aturan balasan otomatis (kata kunci atau regex).",
      parameters: {
        type: "object",
        properties: {
          match: { type: "string", description: "Kata kunci atau pola regex." },
          reply: { type: "string", description: "Balasan yang dikirim saat cocok." },
          isRegex: { type: "boolean", description: "Bila true, `match` diperlakukan sebagai regex." },
        },
        required: ["match", "reply"],
      },
      risk: "low",
      async execute(input, ctx) {
        const rules = await load(ctx.store)
        const rule: Rule = {
          id: randomUUID(),
          match: input.match,
          isRegex: input.isRegex ?? false,
          reply: input.reply,
          enabled: true,
        }
        rules.push(rule)
        await save(ctx.store, rules)
        return { id: rule.id, total: rules.length }
      },
    }),
    defineTool<Record<string, never>, { rules: Rule[] }>({
      name: "list_autoreply",
      description: "Tampilkan aturan balasan otomatis.",
      parameters: { type: "object", properties: {} },
      risk: "low",
      async execute(_input, ctx) {
        return { rules: await load(ctx.store) }
      },
    }),
    defineTool<{ id: string }, { ok: boolean }>({
      name: "remove_autoreply",
      description: "Hapus aturan balasan otomatis berdasarkan id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id aturan." } },
        required: ["id"],
      },
      risk: "low",
      async execute(input, ctx) {
        const rules = await load(ctx.store)
        const remaining = rules.filter((r) => r.id !== input.id)
        await save(ctx.store, remaining)
        return { ok: remaining.length < rules.length }
      },
    }),
  ],
  onInbound: async (ctx: InboundHookContext): Promise<InboundHookResult | undefined> => {
    if (ctx.message.fromMe) return undefined
    const text = ctx.message.text
    if (!text) return undefined
    const rules = await load(ctx.store)
    const rule = rules.find((r) => r.enabled && matchesRule(r, text))
    if (!rule) return undefined
    ctx.logger.info({ rule: rule.id }, "auto-reply cocok")
    return { reply: rule.reply }
  },
})
