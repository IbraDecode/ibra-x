# Ibra X

🇮🇩 Bahasa Indonesia · [🇬🇧 English](README.en.md)

> Agen otonom untuk WhatsApp — membaca, mengingat, memahami, dan bertindak atas lalu lintas WhatsApp Anda. Open source, instalasi termudah, dukungan bawaan untuk banyak penyedia LLM, dengan Skills API & SDK.

`ibra-x` adalah platform agen WhatsApp yang dapat di-host sendiri (self-hosted). Ia menautkan satu atau beberapa nomor WhatsApp lewat [Baileys](https://github.com/WhiskeySockets/Baileys), lalu menjalankan loop agen yang otonom: mengamati chat, mengingat konteks, memanggil *skill* (tool), dan membalas dengan kebijakan izin yang ketat.

[![npm version](https://img.shields.io/npm/v/ibra-x.svg)](https://www.npmjs.com/package/ibra-x)
[![license](https://img.shields.io/npm/l/ibra-x.svg)](LICENSE)
[![node](https://img.shields.io/node/v/ibra-x.svg)](https://nodejs.org)
[![ci](https://github.com/IbraDecode/ibra-x/actions/workflows/ci.yml/badge.svg)](https://github.com/IbraDecode/ibra-x/actions/workflows/ci.yml)

**Status: `0.10.0`.** Tersedia di npm sebagai [`ibra-x`](https://www.npmjs.com/package/ibra-x). Pengembangan aktif di branch `dev`.

---

## Mengapa Ibra X?

- **Satu agen untuk seluruh lalu lintas WhatsApp.** Bukan bot yang hanya membalas kata kunci, tetapi agen yang mengamati, mengingat, dan bertindak.
- **Multi-nomor dengan peran.** Satu nomor untuk *membaca* (observer), satu untuk *membalas* (assistant), atau mode *hybrid*. Memori dibagi antar-nomor.
- **Banyak penyedia LLM secara langsung.** OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek, xAI, Ollama lokal, dan endpoint apa pun yang kompatibel OpenAI — tanpa lapisan SDK berat.
- **Skills API & SDK.** Tulis kemampuan Anda sendiri dalam TypeScript, atau pasang server **MCP** sebagai sumber tool.
- **Instalasi termudah.** Tanpa build step saat self-host. `git clone && npm install && npm run init`.
- **Aman secara desain.** Allowlist, peran per akun, klasifikasi risiko, persetujuan untuk aksi berdampak, dan isolasi konten tak tepercaya.

---

## Mulai Cepat

**Tanpa clone (via npm):**

```bash
npx ibra-x init     # wizard: pilih provider, isi API key, tautkan nomor WhatsApp
npx ibra-x start    # jalankan agen + dashboard (http://127.0.0.1:8787)
```

**Dari sumber:**

```bash
git clone https://github.com/IbraDecode/ibra-x.git
cd ibra-x
npm install
npm run init      # wizard: pilih provider, isi API key, tautkan nomor WhatsApp
npm run start     # jalankan agen + dashboard (http://127.0.0.1:8787)
```

Atau via Docker:

```bash
cp .env.example .env
docker compose up -d
docker compose logs -f
```

---

## Konsep Inti

| Konsep | Arti |
|---|---|
| **Account** | Satu nomor WhatsApp (sesi Baileys) dengan **peran**: `observer`, `assistant`, atau `hybrid`. |
| **Agent** | Loop pengambilan keputusan: model + skill + memori + anggaran + izin. |
| **Skill** | Plugin yang mengekspos tool (dan prompt/command/hook). Ditulis dengan `@ibrax/sdk`. |
| **Provider** | Adaptor LLM. Semua penyedia OpenAI-compatible ditangani satu engine. |
| **Memory** | Memori jangka panjang per kontak/chat (SQLite + FTS5), plus ringkasan sesi. |
| **Policy** | Aturan izin: siapa boleh memicu agen, aksi apa yang butuh persetujuan. |

---

## Skill & MCP

Selain skill lokal (`skills/`) dan paket npm (`ibra-skill-*`), Ibra X dapat memakai **server MCP** sebagai sumber tool. Tambahkan ke `config.json`:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/docs"] }
  }
}
```

Tool MCP muncul otomatis sebagai skill dengan prefiks `<id>__`. Lihat [`docs/SKILLS.md`](docs/SKILLS.md).

---

## Skill bawaan

| Skill | Isi |
|---|---|
| `core-memory` | Memori jangka panjang: simpan/cari/hapus fakta |
| `whatsapp` | 29 tool WhatsApp (kirim teks/media/suara, reaksi, sunting/hapus, presence, riwayat, admin grup, poll + hasilnya, lokasi, kontak, arsip/pin/mute, blokir) |
| `subagents` | Delegasi ke subagen berkonteks terisolasi |
| `approvals` | Alur persetujuan: daftar/setujui/tolak aksi yang menunggu izin |
| `autoreply` | Balasan otomatis berbasis aturan (hook, **tanpa** memanggil LLM) |
| `handoff` | Handoff ke manusia — tahan balasan otomatis per chat (dengan eskalasi otomatis) |
| `notes` | Catatan ringan (tambah/cari/daftar/hapus) |
| `calendar` | Acara + undangan kalender `.ics` |
| `reminders` | Pengingat yang dikirim otomatis (job 60s) |
| `scheduler` | Pesan terjadwal (job 30s) |
| `digest` | Ringkasan harian percakapan (job 5 menit) |
| `web-fetch` | Mengambil isi URL (dengan penjagaan SSRF) |
| `web-search` | Pencarian web (Brave/Tavily/Serper) |

## Kemampuan WhatsApp

Skill bawaan `whatsapp` mengekspos operasi ini sebagai tool (semuanya tunduk pada policy & tingkat otonomi):

| Tool | Risiko | Fungsi |
|---|---|---|
| `wa_send_message` | medium | Kirim pesan teks (dengan kutipan opsional) |
| `wa_send_media` | medium | Kirim gambar/video/audio/dokumen |
| `wa_send_voice` | medium | Balas dengan pesan suara (TTS) |
| `wa_react` | low | Beri/hapus reaksi emoji |
| `wa_edit_message` | medium | Sunting pesan yang pernah dikirim |
| `wa_delete_message` | **high** | Hapus pesan (selalu butuh persetujuan) |
| `wa_mark_read` | low | Tandai dibaca |
| `wa_get_history` | low | Ambil riwayat chat |
| `wa_set_presence` | low | Indikator menulis/tersedia |
| `wa_list_chats` | low | Daftar chat |
| `wa_group_info` | low | Info grup & peserta |
| `wa_check_number` | low | Cek nomor terdaftar WhatsApp |
| `wa_group_create` | medium | Buat grup baru |
| `wa_group_add` | medium | Tambah peserta grup |
| `wa_group_remove` | **high** | Keluarkan peserta (butuh persetujuan) |
| `wa_group_promote` | medium | Jadikan admin |
| `wa_group_demote` | **high** | Cabut admin (butuh persetujuan) |
| `wa_group_invite` | low | Kode undangan grup |
| `wa_group_setting` | medium | Pengaturan grup (announcement/locked) |
| `wa_send_location` | medium | Kirim lokasi |
| `wa_send_poll` | medium | Kirim poll |
| `wa_poll_results` | low | Hasil suara sebuah poll |
| `wa_profile_picture` | low | URL foto profil |
| `wa_block` | **high** | Blokir/buka blokir (butuh persetujuan) |
| `wa_archive` | low | Arsipkan chat |
| `wa_pin` | low | Sematkan/lepas sematan chat |
| `wa_mute` | low | Bisukan/bunyikan chat |
| `wa_mark_unread` | low | Tandai belum dibaca |
| `wa_send_contact` | medium | Kirim kontak (vCard) |

Media masuk diunduh otomatis ke `<dataDir>/media/`. Agen dapat **memahami & menghasilkan media**:
- `IBRA_TRANSCRIBE=true` — transkripsikan pesan suara otomatis;
- `IBRA_DESCRIBE_IMAGES=true` — deskripsikan gambar masuk (butuh model multimodal);
- `IBRA_SPEAK=true` — aktifkan tool `wa_send_voice` untuk **membalas dengan voice note** (TTS).

Semuanya melampirkan/menghasilkan konten yang dipakai agen.

## Otomasi (job periodik)

Agen dapat bertindak **proaktif** lewat job periodik yang dideklarasikan skill:

| Skill | Job | Fungsi |
|---|---|---|
| `reminders` | setiap 60s | Mengirim pengingat yang jatuh tempo |
| `scheduler` | setiap 30s | Mengirim pesan terjadwal |
| `digest` | setiap 5 menit | Ringkasan harian percakapan (via subagen) pada jam tertentu |

Skill kustom dapat menambahkan `jobs` sendiri (lihat [`docs/SKILLS.md`](docs/SKILLS.md)). State job disimpan di `SkillStore` masing-masing, sehingga scheduler tetap sederhana tanpa layanan eksternal.

## Subagen (delegasi)

Agen dapat mendelegasikan tugas mandiri ke **subagen berkonteks terisolasi** lewat tool `spawn_subagent`. Hanya ringkasan akhir yang kembali, sehingga konteks percakapan utama tetap ringkas. Kedalaman bersarang dibatasi `maxSubagentDepth` (default 1) untuk mencegah rekursi tak terkendali.

## Webhook keluar

Kirim event ke sistem lain (n8n, Slack, CRM) lewat `config.webhooks`:

```json
{
  "webhooks": [
    { "url": "https://n8n.contoh/webhook/ibra", "events": ["inbound.message", "agent.finished"], "secret": "rahasia" }
  ]
}
```

Payload JSON: `{ event, at, data }`. Bila `secret` diisi, header `x-ibra-signature` berisi HMAC-SHA256 body. Percobaan ulang otomatis bila gagal.

## Dashboard

Setelah `ibrax start`, buka **http://127.0.0.1:8787** — dashboard satu halaman (tanpa build step) menampilkan status, akun, skill/tool, pencarian memori, penguji agen, dan aliran event langsung (SSE). Bila `IBRA_API_TOKEN` diset, buka dengan `?token=<token>`. Endpoint **`GET /api/metrics`** menyajikan ringkasan metrik (pesan, LLM, tool, token, error, polling).

---

## Memori & privasi

Memori jangka panjang disimpan di satu SQLite (FTS5) dan **dibagi antar-nomor** — fakta yang dipelajari nomor `observer` langsung tersedia bagi `assistant`. Setiap fakta menyimpan **provenance** (akun mana, kapan), dan fakta identik **digabung, bukan diduplikasi**.

```bash
ibrax memory search "<kata kunci>"
ibrax memory export backup.json     # ekspor (dengan sidik jari)
ibrax memory import backup.json     # impor (idempoten)
ibrax memory verify                 # jumlah + sidik jari (deteksi perubahan)
```

## Keamanan & batas

- **Allowlist pengirim** — `IBRA_ALLOWLIST`; kosong = mode owner-only.
- **Otonomi berjenjang** — `readonly` → `suggest` → `auto` → `autonomous`.
- **Risiko per tool** — `low`/`medium`/`high`; `high` selalu butuh persetujuan.
- **Rate limit** — `IBRA_RATE_PER_SENDER`, `IBRA_RATE_PER_CHAT` (per menit, 0 = mati).
- **Guard pesan basi** — `IBRA_REPLY_MAX_AGE` (detik): pesan yang lebih tua tidak dibalas,
  sehingga backlog saat offline tidak memicu banjir balasan.
- **Jam tenang** — `IBRA_QUIET_HOURS` (mis. `22:00-07:00`) menahan balasan otomatis.
- **Isolasi kanal** — konten pesan diperlakukan sebagai data, bukan instruksi.
- **Tolak panggilan** — `IBRA_REJECT_CALLS` menolak panggilan masuk otomatis (bot tidak mendukung panggilan).
- **Web fetch aman (SSRF)** — host diresolusi (DNS) dan **setiap redirect** divalidasi; alamat privat/loopback ditolak.

## Dokumentasi

- 🌐 **Situs dokumentasi**: https://ibradecode.github.io/ibra-x/
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arsitektur, keputusan desain, dan alur.
- [`docs/API.md`](docs/API.md) — referensi API SDK (skill, tool, hook, job).
- [`docs/AUDIT.md`](docs/AUDIT.md) — audit Baileys & Ibra X (temuan + perbaikan).
- [`docs/SKILLS.md`](docs/SKILLS.md) — cara menulis skill dan memakai server MCP.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — alur kontribusi dan strategi branch.

---

## Branch

- `main` — stabil, rilis.
- `dev` — integrasi, tempat pengembangan aktif. **PR mengarah ke `dev`.**

---

## Lisensi

MIT © IbraDecode
