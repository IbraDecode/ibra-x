# Laporan Audit Baileys & Ibra X

Dokumen ini merangkum riset mendalam terhadap **WhiskeySockets/Baileys v7.0.0-rc14** (pembacaan source
langsung) dan **audit kode Ibra X** yang memakainya, beserta perbaikan yang diterapkan.

## Metodologi

- Membaca source Baileys: `Socket/socket.ts` (koneksi, pairing, lifecycle), `Socket/messages-recv.ts`
  (alur `link_code_companion_reg` → `companion_finish`), `Utils/companion-reg-client-utils.ts`
  (`getCompanionPlatformId`), `Types/*` (DisconnectReason, ChatModification, ParticipantAction),
  `Socket/chats.ts` (presence, app-state), `Socket/messages-send.ts` (relay, readMessages).
- Audit seluruh paket Ibra X (`@ibrax/sdk|providers|core|whatsapp|app|server|cli`).
- Verifikasi runtime: gateway LLM (completion + tool calling), loop agen, dan alur pairing.

## Alur pairing WhatsApp (hasil riset)

1. `makeWASocket` → Noise XX handshake → `clientFinish` (register/login).
2. `requestPairingCode(phone)` mengirim iq `link_code_companion_reg` stage `companion_hello`;
   kode 8 karakter Crockford dibuat lokal; `creds.me` di-set.
3. Saat pengguna memasukkan kode di HP, server mengirim node `link_code_companion_reg`
   (ditangani **internal** oleh Baileys di `messages-recv.ts`): klien mengirim `companion_finish`
   berisi key bundle terenkripsi, lalu `creds.registered = true`.
4. Server mengirim `CB:iq,,pair-success` → `configureSuccessfulPairing` → koneksi diminta restart.

Konsekuensi: integrasi kita **tidak perlu** menangani kriptografi pairing; cukup menunggu.

### `DisconnectReason` (Baileys)

| Kode | Nama | Sifat |
|---|---|---|
| 401 | `loggedOut` | terminal (sesi dicabut) |
| 403 | `forbidden` | terminal |
| 411 | `multideviceMismatch` | terminal-ish |
| 500 | `badSession` | terminal (state rusak) |
| 515 | `restartRequired` | pulih cepat |
| 408/428 | `timedOut`/`connectionClosed` | pulih (backoff) |

## Temuan & perbaikan

| # | Temuan | Dampak | Perbaikan |
|---|---|---|---|
| 1 | Agen bisa memanggil `wa_send_message` ke chat saat ini **sementara** harness juga mengirim jawaban akhir → **pesan ganda** | UX buruk | System prompt diperjelas: balas sebagai teks; `wa_*` hanya untuk chat lain/aksi (`session.ts`) |
| 2 | Antrean masuk bisa **kelaparan**: pesan yang datang saat pemrosesan tidak diproses sampai pesan berikutnya | Pesan tertunda | `processInboxOnce` menjadi **drain loop** sampai antrean kosong (`runtime.ts`) |
| 3 | Kebijakan reconnect hanya membedakan 401 vs lainnya | Reconnect tak terkendali / tidak tepat | Kode **terminal** (401/403/411/500) menghentikan + panduan; lainnya **backoff eksponensial** (cap 60s); 515 cepat (`account.ts`) |
| 4 | Pairing tidak bisa di-reset; error tanpa panduan | Sulit pulih dari sesi rusak | Flag `ibrax pair --reset`, penanganan error, jeda sebelum minta kode (`commands.ts`, `index.ts`) |
| 5 | Tidak ada indikator menulis / tanda dibaca saat membalas | Kurang natural | Best-effort `setPresence('composing'→'paused')` + `markRead` (`runtime.ts`) |
| 6 | Provider `custom` mengabaikan `CUSTOM_BASE_URL` (karena preset punya baseUrl default) | Konfigurasi gateway gagal | `resolveProvider` memprioritaskan env untuk `custom` (`registry.ts`) |
| 7 | `iq error 400 bad-request` sesekali muncul saat pairing | Tidak fatal (stanza tak terkait) | Dicatat; alur tetap ditangani internal Baileys |

## Verifikasi pemakaian API Baileys

| API yang dipakai Ibra X | Status |
|---|---|
| `makeWASocket({ auth, version, browser, logger, markOnlineOnConnect, syncFullHistory, getMessage })` | sesuai |
| `requestPairingCode(phone)` | sesuai (dipanggil setelah socket dibuat) |
| `sendMessage(jid, content, opts)` (teks/media/ptt/lokasi/poll/kontak) | sesuai |
| `readMessages(keys)` | sesuai |
| `sendPresenceUpdate(type, jid?)` | sesuai |
| `groupCreate/groupParticipantsUpdate/groupInviteCode/groupSettingUpdate` | sesuai (`ParticipantAction` = add/remove/promote/demote/modify) |
| `updateBlockStatus(jid, 'block'|'unblock')` | sesuai |
| `chatModify(mod, jid)` (archive/pin/mute/markRead) | sesuai (`markRead` butuh `lastMessages`) |
| `onWhatsApp(...numbers)` | sesuai |
| `profilePictureUrl(jid, 'image')` | sesuai |
| `downloadMediaMessage(msg, 'buffer', {}, ctx)` | sesuai |
| `fetchLatestBaileysVersion()` | sesuai |

## Catatan operasional

- **Kredensial** ada di `<dataDir>/auth/<akun>` — rahasia, jangan di-commit (sudah di `.gitignore`).
- Saat sesi rusak (401/500), jalankan `ibrax pair --reset <akun> <nomor>`.
- Verifikasi runtime nyata: gateway `/models` 200; completion + tool calling 200; loop agen
  menghasilkan `reason=finish`.
