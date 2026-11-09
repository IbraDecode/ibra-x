import { strict as assert } from "node:assert"
import { test } from "node:test"
import { Store } from "./db.ts"
import { MemoryService } from "./memory.ts"

test("menyimpan, mencari, dan menghapus memori", async () => {
  const store = new Store(":memory:")
  const memory = new MemoryService(store)

  const a = await memory.remember({ scope: "contact", scopeId: "62811@s.whatsapp.net", text: "Suka kopi tanpa gula", tags: ["preferensi"] })
  await memory.remember({ scope: "global", text: "Zona waktu pengguna: WIB" })

  const found = await memory.search("kopi")
  assert.equal(found.length, 1)
  assert.match(found[0]!.text, /kopi/)

  await memory.forget(a.id)
  assert.equal((await memory.search("kopi")).length, 0)
  assert.equal(store.countMemory(), 1)
  store.close()
})

test("pencarian memori dapat dibatasi per scope", async () => {
  const store = new Store(":memory:")
  const memory = new MemoryService(store)
  await memory.remember({ scope: "chat", scopeId: "c1", text: "deal harga proyek alpha" })
  await memory.remember({ scope: "chat", scopeId: "c2", text: "deal harga proyek beta" })

  const inC1 = await memory.search("deal", { scope: "chat", scopeId: "c1" })
  assert.equal(inC1.length, 1)
  assert.equal(inC1[0]!.scopeId, "c1")
  store.close()
})

test("pesan tersimpan idempoten berdasarkan id", () => {
  const store = new Store(":memory:")
  const msg = { id: "m1", accountId: "a1", chatId: "c1", senderId: "s1", fromMe: false, text: "halo", timestamp: 1 }
  assert.equal(store.insertMessage(msg), true)
  assert.equal(store.insertMessage(msg), false)
  assert.equal(store.countMessages(), 1)
  store.close()
})

test("antrean masuk bersifat idempoten", () => {
  const store = new Store(":memory:")
  const inbound = {
    id: "in1",
    accountId: "a1",
    chatId: "c1",
    chatKind: "dm" as const,
    senderId: "s1",
    fromMe: false,
    timestamp: 1,
    text: "hai",
  }
  assert.equal(store.enqueueInbox("a1", inbound), true)
  assert.equal(store.enqueueInbox("a1", inbound), false)
  store.close()
})
