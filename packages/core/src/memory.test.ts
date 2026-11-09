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

test("fakta yang sama digabung dan provenance bertambah (memori lintas-nomor)", async () => {
  const store = new Store(":memory:")
  const memory = new MemoryService(store)

  const first = await memory.remember({
    scope: "contact",
    scopeId: "c1",
    text: "Suka kopi tanpa gula",
    sourceAccountId: "observer",
  })
  const second = await memory.remember({
    scope: "contact",
    scopeId: "c1",
    text: "Suka kopi tanpa gula",
    sourceAccountId: "assistant",
  })

  assert.equal(first.merged, false)
  assert.equal(second.merged, true)
  assert.equal(first.id, second.id, "id sama, tidak diduplikasi")
  assert.equal(store.countMemory(), 1)

  const row = store.getMemory(first.id)!
  assert.equal(row.provenance.length, 2)
  assert.deepEqual(
    row.provenance.map((p) => p.accountId).sort(),
    ["assistant", "observer"],
    "jejak kedua akun tercatat",
  )
  store.close()
})

test("fingerprint stabil dan berubah hanya saat isi berubah", async () => {
  const store = new Store(":memory:")
  const memory = new MemoryService(store)

  const empty = store.memoryFingerprint()
  const { id } = await memory.remember({ scope: "global", text: "fakta A", sourceAccountId: "a1" })
  const once = store.memoryFingerprint()
  assert.notEqual(empty, once)

  // Dedup tidak mengubah isi → fingerprint tetap.
  await memory.remember({ scope: "global", text: "fakta A", sourceAccountId: "a2" })
  assert.equal(store.memoryFingerprint(), once)

  await memory.forget(id)
  assert.equal(store.memoryFingerprint(), empty)
  store.close()
})
