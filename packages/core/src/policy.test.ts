import { strict as assert } from "node:assert"
import { test } from "node:test"
import { ConfigSchema } from "./config.ts"
import { Policy, normalizeId } from "./policy.ts"

function makePolicy(overrides: Record<string, unknown> = {}): Policy {
  const config = ConfigSchema.parse({
    allowlist: ["628111", "628222"],
    ownerNumbers: ["628999"],
    autonomy: "suggest",
    ...overrides,
  })
  return new Policy(config)
}

test("normalizeId hanya menyisakan digit", () => {
  assert.equal(normalizeId("62811@s.whatsapp.net"), "62811")
  assert.equal(normalizeId("+62 811-222"), "62811222")
})

test("owner selalu diizinkan memicu agen", () => {
  const policy = makePolicy()
  assert.equal(policy.canTrigger("628999", { respondTo: "allowlist" }).effect, "allow")
  assert.equal(policy.canTrigger("+62 8999", { respondTo: "owner" }).effect, "allow")
})

test("non-allowlist ditolak saat allowlist tidak kosong", () => {
  const policy = makePolicy()
  assert.equal(policy.canTrigger("628777", { respondTo: "allowlist" }).effect, "deny")
  assert.equal(policy.canTrigger("628111", { respondTo: "allowlist" }).effect, "allow")
})

test("allowlist kosong berarti mode owner-only", () => {
  const policy = makePolicy({ allowlist: [] })
  assert.equal(policy.canTrigger("628111", { respondTo: "allowlist" }).effect, "deny")
  assert.equal(policy.canTrigger("628999", { respondTo: "allowlist" }).effect, "allow")
})

test("tool risiko rendah diizinkan, tinggi selalu bertanya", () => {
  const policy = makePolicy()
  assert.equal(policy.decideTool({ name: "read", risk: "low" }).effect, "allow")
  assert.equal(policy.decideTool({ name: "write", risk: "medium" }).effect, "ask")
  assert.equal(policy.decideTool({ name: "drop", risk: "high" }).effect, "ask")
})

test("tool dengan requiresApproval selalu bertanya", () => {
  const policy = makePolicy({ autonomy: "autonomous" })
  assert.equal(policy.decideTool({ name: "x", risk: "low", requiresApproval: true }).effect, "ask")
})

test("mode readonly menolak aksi yang mengubah keadaan", () => {
  const policy = makePolicy({ autonomy: "readonly" })
  assert.equal(policy.decideTool({ name: "read", risk: "low" }).effect, "allow")
  assert.equal(policy.decideTool({ name: "send", risk: "medium" }).effect, "deny")
  assert.equal(policy.decideTool({ name: "read", risk: "low" }, { outbound: true }).effect, "deny")
})

test("mode auto mengizinkan aksi medium tanpa bertanya", () => {
  const policy = makePolicy({ autonomy: "auto" })
  assert.equal(policy.decideTool({ name: "send", risk: "medium" }).effect, "allow")
  assert.equal(policy.decideTool({ name: "drop", risk: "high" }).effect, "ask")
  assert.equal(policy.canSendAutomatically(), true)
})
