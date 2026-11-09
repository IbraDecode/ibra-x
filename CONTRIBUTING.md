# Kontribusi ke Ibra X

Terima kasih ingin berkontribusi. Dokumen ini menjelaskan alur kerja dan **strategi branch**.

## Strategi Branch

| Branch | Peran |
|---|---|
| `main` | Stabil. Hanya menerima merge dari `dev` saat rilis. Jangan berkomitmen langsung ke sini. |
| `dev` | Integrasi. **Branch default untuk pengembangan.** Semua PR mengarah ke sini. |
| `feat/<nama>` | Fitur baru. Bercabang dari `dev`, PR ke `dev`. |
| `fix/<nama>` | Perbaikan bug. Bercabang dari `dev`, PR ke `dev`. |
| `docs/<nama>` | Perubahan dokumentasi. |
| `release/<versi>` | Persiapan rilis. Bercabang dari `dev`, di-merge ke `main` dan `dev`. |
| `hotfix/<nama>` | Perbaikan darurat produksi. Bercabang dari `main`, di-merge ke `main` dan `dev`. |

Aturan:

1. Selalu bercabang dari `dev` (kecuali `hotfix/*` dari `main`).
2. Beri nama branch deskriptif: `feat/whatsapp-poll-tool`, `fix/reconnect-loop`.
3. Satu PR = satu tujuan. Hindari PR campur aduk.
4. `main` hanya menerima merge dari `dev` atau `hotfix/*` saat rilis, disertai tag versi.

## Konvensi Commit

Memakai [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(whatsapp): tambah tool kirim poll
fix(core): cegah loop pada retry tanpa backoff
docs(skills): contoh skill reminder
chore(deps): perbarui baileys
```

Tipe: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`.

## Alur Pull Request

1. Sinkronkan `dev`: `git checkout dev && git pull`.
2. Buat branch: `git checkout -b feat/nama-fitur`.
3. Kerjakan, commit dengan pesan konvensional.
4. Pastikan lolos: `npm run typecheck` dan `npm test`.
5. Buka PR ke `dev` dengan deskripsi: apa, mengapa, cara uji, dampak.
6. Minimal satu review sebelum merge.

## Struktur Proyek

```
ibra-x/
├── packages/
│   ├── sdk/         # tipe & helper untuk penulis skill
│   ├── providers/   # adaptor LLM
│   ├── core/        # domain: config, db, memori, sesi, policy, agen
│   ├── whatsapp/    # transport Baileys (multi-akun)
│   ├── app/         # komposisi seluruh paket
│   ├── server/      # HTTP API + SSE
│   └── cli/         # perintah `ibrax`
├── skills/          # skill bawaan & contoh
├── docs/
└── scripts/
```

## Gaya Kode

- TypeScript strict, ESM, tanpa build step saat self-host (dijalankan dengan `tsx`).
- Nama file `kebab-case.ts`; tipe `PascalCase`; fungsi `camelCase`.
- Utamakan kejelasan daripada keringkasan.
- Tambahkan tes untuk logika yang mudah salah (policy, memori, pemuatan skill).

## Keamanan

Jangan pernah meng-commit: `.env`, direktori auth WhatsApp, kredensial, atau data pengguna. Laporkan kerentanan secara privat kepada pemelihara, bukan lewat isu publik.
