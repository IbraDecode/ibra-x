---
title: Ibra X
---

# Ibra X

> Agen otonom untuk WhatsApp — membaca, mengingat, memahami, dan bertindak.
> Multi-nomor, multi-provider LLM, Skills API & SDK.

[![npm](https://img.shields.io/npm/v/ibra-x.svg)](https://www.npmjs.com/package/ibra-x)
[![license](https://img.shields.io/npm/l/ibra-x.svg)](https://github.com/IbraDecode/ibra-x/blob/main/LICENSE)

## Mulai Cepat

```bash
npx ibra-x init     # wizard: provider, API key, akun WhatsApp
npx ibra-x start    # jalankan agen + dashboard (http://127.0.0.1:8787)
```

## Dokumentasi

- [Arsitektur](ARCHITECTURE) — prinsip, multi-nomor berperan, loop agen, memori, policy, keandalan.
- [Menulis Skill](SKILLS) — Skills API, job periodik, server MCP.
- [Contributing](https://github.com/IbraDecode/ibra-x/blob/main/CONTRIBUTING.md) — alur & strategi branch.
- [Changelog](https://github.com/IbraDecode/ibra-x/blob/main/CHANGELOG.md)
- [Keamanan](https://github.com/IbraDecode/ibra-x/blob/main/SECURITY.md)

## Fitur

- **Baca, ingat, pahami, bertindak** — memori jangka panjang (SQLite + FTS5), transkripsi suara, deskripsi gambar.
- **Multi-nomor berperan** — `observer` (membaca), `assistant` (membalas), `hybrid`; memori dibagi antar-nomor.
- **Banyak penyedia LLM** — OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek, xAI, Ollama, custom.
- **22 tool WhatsApp** — kirim teks/media, reaksi, sunting/hapus, presence, riwayat, info grup, admin grup, poll, lokasi, cek nomor, blokir.
- **Otomasi proaktif** — pengingat, pesan terjadwal, ringkasan harian (job periodik milik skill).
- **Subagen** — delegasi berkonteks terisolasi.
- **Skills API & SDK** + **MCP** (stdio & Streamable HTTP).- **Dashboard web** dan **guardrails** (rate limit, jam tenang, otonomi berjenjang).

## Lisensi

MIT © IbraDecode
