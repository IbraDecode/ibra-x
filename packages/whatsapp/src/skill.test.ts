import { strict as assert } from "node:assert"
import { test } from "node:test"
import { whatsappSkill } from "./skill.ts"

test("skill whatsapp mengekspos tool inti dengan tingkat risiko yang benar", () => {
  const tools = new Map((whatsappSkill.tools ?? []).map((t) => [t.name, t]))

  const expected = [
    "wa_send_message",
    "wa_send_media",
    "wa_send_voice",
    "wa_mark_read",
    "wa_get_history",
    "wa_react",
    "wa_edit_message",
    "wa_delete_message",
    "wa_set_presence",
    "wa_list_chats",
    "wa_group_info",
    "wa_check_number",
    "wa_group_create",
    "wa_group_add",
    "wa_group_remove",
    "wa_group_promote",
    "wa_group_demote",
    "wa_group_invite",
    "wa_group_setting",
    "wa_send_location",
    "wa_send_poll",
    "wa_profile_picture",
    "wa_block",
  ]
  for (const name of expected) {
    assert.ok(tools.has(name), `tool ${name} harus ada`)
  }

  // Aksi ireversibel wajib high risk (dan selalu butuh persetujuan).
  assert.equal(tools.get("wa_delete_message")!.risk, "high")
  assert.equal(tools.get("wa_group_remove")!.risk, "high")
  assert.equal(tools.get("wa_group_demote")!.risk, "high")
  assert.equal(tools.get("wa_block")!.risk, "high")
  assert.equal(tools.get("wa_group_remove")!.requiresApproval, true)

  // Aksi tulis biasa medium.
  assert.equal(tools.get("wa_send_message")!.risk, "medium")
  assert.equal(tools.get("wa_group_create")!.risk, "medium")
  assert.equal(tools.get("wa_send_poll")!.risk, "medium")

  // Aksi baca rendah.
  assert.equal(tools.get("wa_get_history")!.risk, "low")
  assert.equal(tools.get("wa_check_number")!.risk, "low")
})
