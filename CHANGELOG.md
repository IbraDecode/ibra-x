# Changelog

Semua perubahan penting didokumentasikan di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

## [0.28.0] — 2026-11-09

### Diperbaiki
- **MCP tanpa timeout**: permintaan ke server MCP kini dibatasi waktu (default 30 detik),
  sehingga server yang diam tidak lagi menggantung proses. Versi klien pada handshake
  memakai `VERSION` (sebelumnya hardcoded `0.1.0`).
- **Sanitasi nama berkas media**: id pesan dibersihkan sebelum dipakai sebagai nama berkas
  (`<dataDir>/media`), mencegah path traversal (defense-in-depth).

### Ditambahkan
- Tes timeout MCP.

## [0.27.0] — 2026-11-09

### Ditambahkan
- **Dashboard**: panel **Metrik** (pesan, LLM, tool, subagen, token, error, polling) dan
  event baru (`poll.vote`, `message.revoked`) pada aliran langsung.
- Tes endpoint server (`/api/metrics`, `/api/revoked`).

### Diperbaiki
- **Gerbang `mentionOnly`**: kini memeriksa apakah **bot sendiri** disebut (via
  `mentionedMe`), bukan apakah allowlist/owner disebut. Pemilik selalu dapat memicu.
- **Webhook**: event `poll.vote` dan `message.revoked` ditambahkan ke daftar event yang
  dapat dilanggankan (sebelumnya tidak bisa dipilih).

## [0.26.1] — 2026-11-09

### Diperbaiki
- **Daftar skill bawaan terpusat** (`coreBuiltinSkills`): sebelumnya terduplikasi di tiga
  tempat (app + CLI 2×), sehingga skill baru mudah terlewat. Kini `approvals` dan skill
  bawaan lain selalu termuat — CLI `status` menampilkan 13 skill & 60 tool.

## [0.26.0] — 2026-11-09

### Ditambahkan
- **Snapshot pesan yang ditarik (revoke)**: `protocolMessage` REVOKE dideteksi; pesan asli
  disalin ke penyimpanan (`revoked:<id>`) sebelum konteksnya hilang, dicatat di audit, dan
  dipancarkan lewat event `message.revoked`. Tersedia `GET /api/revoked` dan aliran SSE.

### Diperbaiki
- Pesan `protocolMessage` tidak lagi dibuang diam-diam — penghapusan kini mengawetkan isi asli.

## [0.25.0] — 2026-11-09

### Ditambahkan
- **Alur persetujuan (parked task → resume)**: aksi yang butuh izin kini benar-benar
  di-park (`RuntimeApi.approvals`), owner diberi tahu, dan dapat **disetujui untuk
  dilanjutkan** (agen dijalankan ulang dengan izin) atau ditolak. Tersedia lewat skill
  bawaan **`approvals`** (`list_approvals`, `approve_action`, `reject_action`).
- `AgentRunInput.autoApprove` + `ToolContext.requestApproval` kini menghormati izin
  saat tugas terparkir dilanjutkan.

### Diperbaiki
- `requestApproval` tidak lagi selalu menolak — saat melanjutkan tugas yang disetujui,
  permintaan persetujuan otomatis disetujui (izinkan tool berjalan).

## [0.24.0] — 2026-11-09

### Ditambahkan
- **Dekripsi suara polling**: event `messages.update` diproses; suara diagregasi memakai
  pesan pembuat asli (via `getMessage`), disimpan di kv, dipancarkan lewat event `poll.vote`,
  dan dapat dibaca lewat tool baru **`wa_poll_results`**.
- **Penolakan panggilan otomatis** (`rejectCalls`, env `IBRA_REJECT_CALLS`): panggilan masuk
  ditolak sopan (bot tidak mendukung panggilan suara/video).
- **Outbox durable**: pengiriman yang gagal disimpan ke tabel `outbox` dan dicoba ulang
  otomatis (runner tiap 30 detik, maksimum 5 percobaan) — tidak ada balasan yang hilang
  saat gangguan jaringan.
- **Modul metrics** (`MetricsRegistry`): agregasi dari event bus (pesan masuk/keluar, LLM,
  tool, subagen, token, error, polling) + endpoint **`GET /api/metrics`** dan event `poll.vote`
  pada aliran SSE.

### Diperbaiki
- **Pengerasan SSRF** pada skill `web-fetch`: validasi host + resolusi DNS (semua alamat) +
  validasi **setiap redirect** (redirect tidak lagi diikuti otomatis), menutup celah
  DNS-rebinding dan redirect ke alamat privat.

## [0.23.0] — 2026-11-09

### Ditambahkan
- **`getMessage` + penyimpanan proto mentah**: proto pesan mentah disimpan di tabel
  `raw_messages` (dipangkas otomatis). Ini mengaktifkan **pengiriman ulang saat penerima
  minta retry** (menghindari "Menunggu pesan ini") dan **dekripsi suara polling**.
- **`syncFullHistory` per akun** (`accounts[].syncFullHistory`): sinkronkan riwayat penuh
  saat konek — cocok untuk akun `observer` yang mengarsipkan percakapan.
- **Kompaksi sesi berbasis model**: `compactAfterMessages` (default `60`) meringkas riwayat
  lama menjadi catatan memori sesi secara otomatis (best-effort, di latar belakang) agar
  konteks tetap ringkas pada chat panjang.

### Diperbaiki
- **Rate limiter**: `check()`/`record()` — memeriksa kuota tanpa mengonsumsi token pembatas
  lain, sehingga penolakan salah satu pembatas (pengirim/chat) tidak membuang kuota yang lain.

## [0.22.0] — 2026-11-09

### Ditambahkan
- **Self-chat**: akun dapat merespons percakapan pemilik ke nomornya sendiri
  (`accounts[].selfChat`, default `false`). Pemilik kini bisa mengobrol dengan agen
  di self-chat, dengan otoritas owner penuh.
- **Guard pesan basi**: `replyMaxAgeSeconds` (default `300`, env `IBRA_REPLY_MAX_AGE`)
  mencegah banjir balasan atas backlog pesan offline/lama. `0` = tanpa batas.
- **Cache in-memory** (`MemoryCache`) tanpa dependensi: dipakai untuk
  `msgRetryCounterCache` (anti-loop "Bad MAC") dan `cachedGroupMetadata` (kirim grup lebih cepat).

### Diperbaiki
- **Pembungkus pesan bersarang**: `ephemeralMessage`, `viewOnceMessageV2`,
  `documentWithCaptionMessage`, `editedMessage`, `deviceSentMessage`, dsb. kini diupas
  rekursif — sebelumnya teks/media pada chat sementara atau sekali-lihat terlewat.
- **Anti-loop gema**: ID pesan yang dikirim bot dilacak; gemanya (`isEcho`) tidak pernah
  memicu agen, sehingga tidak ada balasan berulang.
- **Pesan sistem**: `protocolMessage`/`reactionMessage` tanpa teks kini ditandai `isSystem`
  dan tidak memicu agen (sebelumnya berpotensi memicu balasan kosong).
- **Race antrean masuk**: kunci dilepas sebelum pengecekan akhir, sehingga pesan yang
  tiba tepat saat drain tidak lagi "nyangkut" — ditutup dengan loop verifikasi (`hasPendingInbox`).
- **Keamanan `chatModify`**: arsip/markRead kini mengirim pesan terakhir yang valid
  (`Store.getLastMessage`). Aksi ini **ditolak** bila pesan terakhir belum diketahui,
  menghindari `lastMessages: []` yang berisiko mencabut sesi (logout) menurut dokumen Baileys.

### Catatan
- Riset protokol: `syncFullHistory`/`getMessage` penuh (untuk retry dekripsi & dekripsi poll)
  dijadwalkan pada rilis berikutnya karena memerlukan penyimpanan proto mentah.

## [0.21.0] — 2026-11-09

### Riset & audit
- Riset mendalam Baileys v7 (pairing, DisconnectReason, ChatModification, ParticipantAction) → `docs/AUDIT.md`.

### Diperbaiki
- **Pesan ganda**: system prompt melarang `wa_send_message` ke chat saat ini (harness yang mengirim).
- **Kelaparan antrean**: `processInboxOnce` menjadi drain loop sampai antrean kosong.
- **Reconnect**: kode terminal (401/403/411/500) menghentikan dengan panduan; lainnya backoff eksponensial (cap 60s).
- **Pairing**: flag `--reset`, penanganan error yang jelas, jeda sebelum meminta kode.
- **UX**: presence composing→paused + markRead best-effort saat membalas.
- **Provider custom**: memprioritaskan `CUSTOM_BASE_URL`.

## [0.20.0] — 2026-11-09

### Ditambahkan
- Tool WhatsApp: `wa_archive`, `wa_pin`, `wa_mute`, `wa_mark_unread` (via `chatModify`) dan
  `wa_send_contact` (vCard). Total **28 tool WhatsApp**.
- `WhatsAppOps.chatModify` / `WhatsAppOps.sendContact` dan implementasi Baileys-nya.

### Catatan
- Dukungan **Postgres** ditunda: memerlukan refactor `Store` menjadi async. Dijadwalkan terpisah
  agar tidak mengganggu stabilitas rilis saat ini.

## [0.19.0] — 2026-11-09

### Ditambahkan
- **Handoff ke manusia**: `RuntimeApi.handoff` (enable/disable/isActive/list) menyimpan state
  per chat secara persisten; saat aktif, balasan otomatis ditahan dan owner diberi tahu.
- Skill **`handoff`**: tool `request_handoff`/`resolve_handoff`/`list_handoffs` +
  eskalasi otomatis saat pengguna minta admin/operator/manusia.
- Fungsi murni `wantsHuman` (batas kata) yang diuji.

## [0.18.0] — 2026-11-09

### Ditambahkan
- **Webhook keluar**: `config.webhooks` mengirim event ke sistem lain (n8n/Slack/CRM)
  sebagai HTTP POST `{ event, at, data }`, dengan tanda tangan HMAC-SHA256 (`x-ibra-signature`)
  dan percobaan ulang otomatis.
- `WebhookDispatcher` + `signPayload` (fungsi murni, diuji) dengan `fetch` yang dapat disuntik.

## [0.17.0] — 2026-11-09

### Ditambahkan
- **README Inggris** (`README.en.md`) dengan tautan dua bahasa.
- **Referensi API SDK** (`docs/API.md`): `defineSkill`/`defineTool`, `ToolContext`, `RuntimeApi`,
  hook `onInbound`, job periodik, dan tabel tipe. Ditautkan dari README dan situs dokumentasi.

## [0.16.0] — 2026-11-09

### Ditambahkan
- Skill **`notes`**: catatan teks (tambah/cari/daftar/hapus).
- Skill **`calendar`**: acara + undangan kalender `.ics` (kirim sebagai dokumen WhatsApp).
- Fungsi murni `searchNotes`, `toIcsDate`, `buildIcs` (diuji tanpa I/O).

## [0.15.0] — 2026-11-09

### Ditambahkan
- **Balasan suara (TTS)**: `createSpeaker` (endpoint OpenAI-compatible `/audio/speech`),
  `RuntimeApi.speech`, dan tool `wa_send_voice` — agen dapat membalas dengan voice note.
- `config.media.speak`/`ttsModel`/`ttsVoice`; env `IBRA_SPEAK`.
- Dukungan `ptt` pada pengiriman audio.

## [0.14.0] — 2026-11-09

### Ditambahkan
- **Hook pesan masuk** (`Skill.onInbound`) — menangani pesan secara deterministik sebelum LLM
  (`{ reply }` / `{ handled }`), mengurangi biaya dan latensi.
- Skill **`autoreply`**: aturan kata kunci/regex dengan tool `add_autoreply`/`list_autoreply`/`remove_autoreply`.
- `docs/SKILLS.md`: bagian hook pesan masuk.

## [0.13.0] — 2026-11-09

### Ditambahkan
- Linter **Biome** (lint-only) + skrip `npm run lint` / `lint:fix`, dan langkah Lint di CI.

### Diperbaiki
- Anotasi tipe eksplisit (`let` tanpa tipe), penulisan loop parser tanpa assignment-in-expression,
  dan template literal yang tidak perlu (temuan Biome).

## [0.12.0] — 2026-11-09

### Ditambahkan
- WhatsApp diperluas menjadi **22 tool**: cek nomor, buat grup, kelola anggota (tambah/keluarkan/promosikan/turunkan),
  kode undangan, pengaturan grup (announcement/locked), kirim lokasi, kirim poll, foto profil, blokir/buka blokir.
- Aksi ireversibel (`wa_group_remove`, `wa_group_demote`, `wa_block`) selalu butuh persetujuan (risiko `high`).
- Dokumentasi GitHub Pages (`docs/index.md`, `docs/_config.yml`).

## [0.11.0] — 2026-11-09

### Ditambahkan
- Subpath ekspor `ibra-x/sdk` (dengan `dist/sdk.d.ts`) untuk penulis skill eksternal.
- README: badge npm/CI + status.

## [0.10.0] — 2026-11-09

### Ditambahkan
- Skill `web-search`: pencarian web via Brave/Tavily/Serper (penyedia dipilih dari API key).
- Helper murni `resolveSearchProvider`, `describeRequest`, `parseResults` (dapat diuji tanpa jaringan).
- README: tabel skill bawaan; `.env.example`: kunci pencarian.

## [0.9.0] — 2026-11-09

### Ditambahkan
- Skill `digest`: ringkasan harian percakapan (grup/pribadi) pada jam tertentu.
  Peringkasan didelegasikan ke subagen; hasil dikirim ke chat itu sendiri atau JID eksplisit.
- Tool: `enable_digest`, `disable_digest`, `list_digests`.
- Dukungan tes untuk skill (glob tes memuat `skills/*/*.test.ts`).

## [0.8.0] — 2026-11-09

### Ditambahkan
- Memori bersama antar-nomor dengan **provenance** (akun mana, kapan) dan **dedup** (fakta identik digabung).
- `memoryFingerprint()` — sidik jari stabil isi memori untuk deteksi perubahan/tamper.
- CLI: `ibrax memory export`, `ibrax memory import`, `ibrax memory verify`.
- Migrasi skema ringan (menambah kolom baru pada DB lama otomatis).

## [0.7.0] — 2026-11-09

### Ditambahkan
- Rate limit per pengirim dan per chat (sliding window) — `config.limits`.
- Jam tenang (quiet hours) yang menahan balasan otomatis — `config.quietHours`.
- Override env: `IBRA_RATE_PER_SENDER`, `IBRA_RATE_PER_CHAT`, `IBRA_QUIET_HOURS`.
- Keputusan tahan dicatat di audit log (`skip.rateLimit`, `skip.quietHours`).

## [0.6.0] — 2026-11-09

### Ditambahkan
- Dashboard web satu halaman (status, akun, skill/tool, uji agen, cari memori, aliran event SSE).
- Auth `/api/*` menerima token via query (`?token=`) selain header — untuk `EventSource`.
- `VERSION` sebagai satu sumber kebenaran; seluruh paket disinkronkan.

## [0.5.0] — 2026-11-09

### Ditambahkan
- Deskripsi gambar otomatis (vision) untuk gambar/stiker masuk.
- `config.media.describeImages`, `visionModel`, `maxImageBytes`; env `IBRA_DESCRIBE_IMAGES`.

## [0.4.0] — 2026-11-09

### Ditambahkan
- Subagen: tool `spawn_subagent` dengan konteks terisolasi; hanya ringkasan akhir yang kembali.
- Penjaga kedalaman `maxSubagentDepth` (default 1).

## [0.3.0] — 2026-11-09

### Ditambahkan
- Job periodik milik skill (`Skill.jobs`) dan `Scheduler` (deterministik, tanpa layanan eksternal).
- Skill `reminders`: pengingat terkirim otomatis.
- Skill `scheduler`: pesan terjadwal (`schedule_message`, `list_scheduled`, `cancel_scheduled`).

## [0.2.0] — 2026-11-09

### Ditambahkan
- Kemampuan WhatsApp lebih luas: `wa_send_message`, `wa_send_media`, `wa_react`, `wa_edit_message`,
  `wa_delete_message`, `wa_mark_read`, `wa_get_history`, `wa_set_presence`, `wa_list_chats`, `wa_group_info`.
- Unduh media masuk otomatis ke `<dataDir>/media/`.
- Integrasi MCP (stdio + Streamable HTTP): tool server MCP menjadi skill.
- Transkripsi pesan suara otomatis.

## [0.1.0] — 2026-11-09

### Ditambahkan
- Fondasi monorepo npm workspaces tanpa build step (`tsx`).
- `@ibrax/sdk` (Skills API), `@ibrax/providers` (engine OpenAI-compatible + 11 preset),
  `@ibrax/core` (config, SQLite+FTS5, memori, sesi, policy, loop agen, runtime),
  `@ibrax/whatsapp` (Baileys multi-akun berperan), `@ibrax/app`, `@ibrax/server`, `@ibrax/cli`.
- CLI: `init`, `start`, `pair`, `status`, `doctor`, `skills`, `memory`, `chat`.
- Docker, `install.sh`, CI GitHub Actions.
