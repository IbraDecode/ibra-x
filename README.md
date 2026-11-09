# Ibra X

> Agen otonom untuk WhatsApp — membaca, mengingat, memahami, dan bertindak atas lalu lintas WhatsApp Anda. Open source, instalasi termudah, dukungan bawaan untuk banyak penyedia LLM, dengan Skills API & SDK.

`ibra-x` adalah platform agen WhatsApp yang dapat di-host sendiri (self-hosted). Ia menautkan satu atau beberapa nomor WhatsApp lewat [Baileys](https://github.com/WhiskeySockets/Baileys), lalu menjalankan loop agen yang otonom: mengamati chat, mengingat konteks, memanggil *skill* (tool), dan membalas dengan kebijakan izin yang ketat.

**Status: `0.1.0` — tahap awal (fondasi).** Implementasi berjalan di branch `dev`.

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

```bash
git clone https://github.com/IbraDecode/ibra-x.git
cd ibra-x
npm install
npm run init      # wizard: pilih provider, isi API key, tautkan nomor WhatsApp
npm run start     # jalankan agen
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

## Kemampuan WhatsApp

Skill bawaan `whatsapp` mengekspos operasi ini sebagai tool (semuanya tunduk pada policy & tingkat otonomi):

| Tool | Risiko | Fungsi |
|---|---|---|
| `wa_send_message` | medium | Kirim pesan teks (dengan kutipan opsional) |
| `wa_send_media` | medium | Kirim gambar/video/audio/dokumen |
| `wa_react` | low | Beri/hapus reaksi emoji |
| `wa_edit_message` | medium | Sunting pesan yang pernah dikirim |
| `wa_delete_message` | **high** | Hapus pesan (selalu butuh persetujuan) |
| `wa_mark_read` | low | Tandai dibaca |
| `wa_get_history` | low | Ambil riwayat chat |
| `wa_set_presence` | low | Indikator menulis/tersedia |
| `wa_list_chats` | low | Daftar chat |
| `wa_group_info` | low | Info grup & peserta |

Media masuk diunduh otomatis ke `<dataDir>/media/`. Aktifkan **transkripsi pesan suara** otomatis dengan `IBRA_TRANSCRIBE=true` (atau `media.transcribe` di config) — transkrip akan dilampirkan ke konteks agen.

## Otomasi (job periodik)

Agen dapat bertindak **proaktif** lewat job periodik yang dideklarasikan skill:

| Skill | Job | Fungsi |
|---|---|---|
| `reminders` | setiap 60s | Mengirim pengingat yang jatuh tempo |
| `scheduler` | setiap 30s | Mengirim pesan terjadwal |

Skill kustom dapat menambahkan `jobs` sendiri (lihat [`docs/SKILLS.md`](docs/SKILLS.md)). State job disimpan di `SkillStore` masing-masing, sehingga scheduler tetap sederhana tanpa layanan eksternal.

## Subagen (delegasi)

Agen dapat mendelegasikan tugas mandiri ke **subagen berkonteks terisolasi** lewat tool `spawn_subagent`. Hanya ringkasan akhir yang kembali, sehingga konteks percakapan utama tetap ringkas. Kedalaman bersarang dibatasi `maxSubagentDepth` (default 1) untuk mencegah rekursi tak terkendali.

---

## Dokumentasi

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arsitektur, keputusan desain, dan alur.
- [`docs/SKILLS.md`](docs/SKILLS.md) — cara menulis skill dan memakai server MCP.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — alur kontribusi dan strategi branch.

---

## Branch

- `main` — stabil, rilis.
- `dev` — integrasi, tempat pengembangan aktif. **PR mengarah ke `dev`.**

---

## Lisensi

MIT © IbraDecode
