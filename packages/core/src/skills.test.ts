import { strict as assert } from "node:assert"
import { test } from "node:test"
import { defineSkill, defineTool, type Logger, type SkillStore } from "@ibrax/sdk"
import { coreMemorySkill } from "./builtin.ts"
import { SkillRegistry, loadSkills } from "./skills.ts"

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

const emptyStore: SkillStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
  list: async () => [],
}

test("defineTool memvalidasi nama dan skema", () => {
  assert.throws(() => defineTool({ name: "bad name!", description: "x", parameters: { type: "object" }, execute: async () => ({}) }))
  assert.throws(() => defineTool({ name: "ok", description: "", parameters: { type: "object" }, execute: async () => ({}) }))
})

test("registry mendeteksi konflik nama tool antar-skill", () => {
  const registry = new SkillRegistry()
  const tool = defineTool({ name: "dup", description: "x", parameters: { type: "object" }, execute: async () => ({}) })
  registry.register(defineSkill({ id: "s1", name: "S1", tools: [tool] }))
  assert.throws(() => registry.register(defineSkill({ id: "s2", name: "S2", tools: [tool] })))
})

test("loadSkills memuat skill bawaan dan mengindeks tool", async () => {
  const registry = await loadSkills({ builtins: [coreMemorySkill], store: emptyStore, logger: noopLogger })
  assert.equal(registry.list().length, 1)
  assert.ok(registry.getTool("memory_remember"))
  assert.ok(registry.getTool("memory_search"))
  assert.ok(registry.getTool("memory_forget"))
  assert.equal(registry.getTool("tidak_ada"), undefined)
})

test("loadSkills menghormati daftar nonaktif", async () => {
  const registry = await loadSkills({ builtins: [coreMemorySkill], disabled: ["core-memory"], store: emptyStore, logger: noopLogger })
  assert.equal(registry.list().length, 0)
})
