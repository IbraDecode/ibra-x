# Kebijakan Keamanan

## Melaporkan Kerentanan

Jangan membuka isu publik untuk kerentanan keamanan. Laporkan secara privat
kepada pemelihara melalui email **ibradecode@gmail.com** dengan detail:
deskripsi, langkah reproduksi, dampak, dan saran perbaikan bila ada. Kami akan
merespons sesegera mungkin.

## Model Ancaman

Ibra X adalah agen yang membaca pesan tak tepercaya dan dapat bertindak. Aset
yang dilindungi:

- **Kredensial WhatsApp** (state auth Baileys di `<dataDir>/auth/`).
- **API key penyedia LLM** (`.env`).
- **Data percakapan & memori** (`<dataDir>/ibra.sqlite`, `<dataDir>/media/`).
- **Kredensial tool/skill** yang dijalankan agen.

## Kontrol Keamanan Bawaan

- Isi pesan diperlakukan sebagai **data**, bukan instruksi (mitigasi prompt injection).
- **Default-deny** untuk pengirim di luar allowlist/owner.
- Tool berisiko `high` **selalu** butuh persetujuan.
- **Sandbox bukan** disediakan bawaan; jalankan Ibra X dengan hak paling minim
  (container, pengguna non-root) untuk aksi tool sistem.
- **Rate limit** & **jam tenang** untuk mencegah spam/loop.
- **Audit log** append-only untuk aksi penting.

## Praktik Aman yang Dianjurkan

1. Batasi izin file direktori data (`chmod 700`), jangan commit `.env`/`auth/`.
2. Set `IBRA_API_TOKEN` bila server diekspos; bind ke `127.0.0.1` (default).
3. Tinjau skill pihak ketiga dan server MCP sebelum dipasang; keduanya bisa menjalankan kode.
4. Jangan berikan kredensial sensitif ke dalam loop agen.
5. Perbarui dependensi secara berkala (`npm audit`).

## Cakupan

Versi yang didukung: rilis terbaru pada branch `main`.
