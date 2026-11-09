# Changelog

Semua perubahan penting didokumentasikan di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

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
