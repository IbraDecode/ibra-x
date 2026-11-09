# Changelog

Semua perubahan penting didokumentasikan di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

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
