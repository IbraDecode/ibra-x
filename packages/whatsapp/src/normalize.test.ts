import { strict as assert } from "node:assert"
import { test } from "node:test"
import { normalizeBaileysMessage } from "./normalize.ts"

test("normalisasi pesan teks DM", () => {
  const msg = {
    key: { remoteJid: "62811@s.whatsapp.net", id: "m1", fromMe: false },
    message: { conversation: "halo" },
    messageTimestamp: 1000,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.chatKind, "dm")
  assert.equal(n?.text, "halo")
  assert.equal(n?.fromMe, false)
  assert.equal(n?.timestamp, 1_000_000)
})

test("normalisasi grup: pengirim, alt, mention, kutipan", () => {
  const msg = {
    key: {
      remoteJid: "123@g.us",
      id: "m2",
      participant: "62811@s.whatsapp.net",
      participantAlt: "99@lid",
    },
    message: {
      extendedTextMessage: {
        text: "hai",
        contextInfo: { mentionedJid: ["62822@s.whatsapp.net"], stanzaId: "q1" },
      },
    },
    messageTimestamp: 5,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.chatKind, "group")
  assert.equal(n?.senderId, "62811@s.whatsapp.net")
  assert.equal(n?.senderAlt, "99@lid")
  assert.deepEqual(n?.mentions, ["62822@s.whatsapp.net"])
  assert.equal(n?.quotedId, "q1")
})

test("media terdeteksi beserta mime dan caption", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "m3" },
    message: { imageMessage: { mimetype: "image/jpeg", caption: "foto" } },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.media?.kind, "image")
  assert.equal(n?.media?.mime, "image/jpeg")
  assert.equal(n?.media?.caption, "foto")
})

test("pesan tanpa konten atau tanpa remoteJid diabaikan", () => {
  assert.equal(normalizeBaileysMessage("a1", { key: { remoteJid: "x@s.whatsapp.net", id: "m4" }, message: {} }), undefined)
  assert.equal(normalizeBaileysMessage("a1", { key: {} }), undefined)
})

test("mengupas pembungkus ephemeral (chat sementara)", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "e1" },
    message: { ephemeralMessage: { message: { conversation: "pesan sementara" } } },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.text, "pesan sementara")
  assert.equal(n?.isEphemeral, true)
})

test("mengupas view-once (media sekali lihat)", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "v1" },
    message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.media?.kind, "image")
  assert.equal(n?.isViewOnce, true)
})

test("mengupas pembungkus bersarang (ephemeral + view-once)", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "n1" },
    message: {
      ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/png" } } } } },
    },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.media?.kind, "image")
  assert.equal(n?.isViewOnce, true)
  assert.equal(n?.isEphemeral, true)
})

test("documentWithCaption terbaca", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "d1" },
    message: {
      documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", caption: "laporan" } } },
    },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.media?.kind, "document")
  assert.equal(n?.media?.caption, "laporan")
})

test("self-chat terdeteksi dari ownIds", () => {
  const msg = {
    key: { remoteJid: "62811@s.whatsapp.net", id: "s1", fromMe: true },
    message: { conversation: "catatan pribadi" },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg, { ownIds: new Set(["62811"]) })
  assert.equal(n?.isSelfChat, true)
  assert.equal(normalizeBaileysMessage("a1", msg)?.isSelfChat, undefined)
})

test("protocolMessage ditandai sebagai sistem (tidak memicu agen)", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "p1" },
    message: { protocolMessage: { type: 0, key: { id: "old" } } },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.isSystem, true)
  assert.equal(n?.text, undefined)
})

test("protocolMessage REVOKE menandai target penghapusan", () => {
  const msg = {
    key: { remoteJid: "x@s.whatsapp.net", id: "r1", fromMe: false },
    message: { protocolMessage: { type: 0, key: { id: "target1" } } },
    messageTimestamp: 1,
  }
  const n = normalizeBaileysMessage("a1", msg)
  assert.equal(n?.revokeTargetId, "target1")
})
