# Menulis Skill Ibra X

> **Untuk penulis skill di luar repo ini:** `npm install ibra-x`, lalu impor dari
> `ibra-x/sdk` — mis. `import { defineSkill, defineTool } from "ibra-x/sdk"`.
> Di dalam repo ini, gunakan `@ibrax/sdk` (paket workspace).

Skill adalah unit ekstensi Ibra X. Sebuah skill mengekspos satu atau lebih **tool** yang dapat dipanggil agen, dan opsional menyumbang **system prompt**, **command**, serta **hook setup**.

## Kerangka Minimal

Setiap skill adalah modul ESM yang mengekspor `default` hasil `defineSkill(...)`:

```ts
// skills/cuaca/index.ts
import { defineSkill, defineTool } from "@ibrax/sdk"

export default defineSkill({
  id: "cuaca",
  name: "Cuaca",
  description: "Memberi informasi cuaca sederhana.",
  systemPrompt: "Gunakan `get_weather` bila pengguna menanyakan cuaca.",
  tools: [
    defineTool<{ kota: string }, { kota: string; suhu: string }>({
      name: "get_weather",
      description: "Ambil cuaca sebuah kota.",
      parameters: {
        type: "object",
        properties: { kota: { type: "string", description: "Nama kota." } },
        required: ["kota"],
      },
      risk: "low",
      async execute(input, ctx) {
        ctx.logger.info({ kota: input.kota }, "mengambil cuaca")
        return { kota: input.kota, suhu: "27°C" }
      },
    }),
  ],
})
```

Letakkan di `skills/<nama>/index.ts`; loader akan menemukannya otomatis (lihat `config.skills.dirs`).

## Anatomi Tool

| Field | Wajib | Arti |
|---|---|---|
| `name` | ✅ | Unik lintas skill. Huruf/angka/`_`/`-`, maks 64. |
| `description` | ✅ | Dipakai model untuk memilih tool. Tulis jelas. |
| `parameters` | ✅ | Skema JSON (subset OpenAPI), kompatibel MCP/OpenAI. |
| `risk` | – | `low` \| `medium` \| `high`. Default `low`. Menentukan izin. |
| `requiresApproval` | – | Bila `true`, selalu minta persetujuan. |
| `execute` | ✅ | `(input, ctx) => Promise<output>`. Output di-serialisasi ke JSON. |

## Tingkat Risiko & Izin

Keputusan izin dibuat **Policy Engine**, bukan oleh skill:

- `low` (baca) — diizinkan pada semua tingkat otonomi kecuali `readonly` untuk aksi keluar.
- `medium` (tulis/kirim) — pada `suggest` → minta persetujuan; `auto`/`autonomous` → diizinkan.
- `high` (ireversibel) — **selalu** minta persetujuan.

## Konteks Tool (`ctx`)

```ts
interface ToolContext {
  logger: Logger
  runtime: RuntimeApi      // sendMessage, getChatHistory, markRead, memory
  store: SkillStore        // penyimpanan kunci-nilai milik skill ini
  sessionId: string
  accountId: string
  chatId?: string
  senderId?: string
  signal?: AbortSignal
  requestApproval(reason: string): Promise<{ approved: boolean }>
}
```

`ctx.store` ter-namespace per `skill.id`, jadi skill tidak saling menimpa data.

## Mengakses WhatsApp

Gunakan `ctx.runtime` (jangan impor transport langsung):

```ts
await ctx.runtime.sendMessage(chatId, { text: "Halo!" }, { accountId: ctx.accountId })
const riwayat = await ctx.runtime.getChatHistory(chatId, { limit: 20 })
await ctx.runtime.memory.remember({ scope: "contact", scopeId: chatId, text: "Suka kopi" })
```

## Menguji Skill

```bash
npm run cli -- chat "apa cuaca di Jakarta?"
```

Atau unit test langsung terhadap `execute` dengan `ctx` tiruan.

## Job Periodik (Otomasi)

Skill dapat bertindak proaktif dengan mendeklarasikan `jobs`. Scheduler akan
memanggilnya sesuai interval; state disimpan di `ctx.store` milik skill:

```ts
export default defineSkill({
  id: "laporan-harian",
  name: "Laporan Harian",
  jobs: [
    {
      id: "harian",
      intervalMs: 24 * 60 * 60 * 1000,
      async run(ctx) {
        await ctx.runtime.sendMessage("62812...@s.whatsapp.net", { text: "Ringkasan hari ini: …" })
        ctx.logger.info("laporan terkirim")
      },
    },
  ],
})
```

`JobContext` = `{ logger, store, runtime }`. Kegagalan job ditangkap dan dicatat, tidak menghentikan job lain.

## Hook Pesan Masuk (`onInbound`)

Skill dapat menangani pesan **secara deterministik sebelum LLM dipanggil** — hemat biaya, latensi rendah, dapat diprediksi:

```ts
export default defineSkill({
  id: "aturan-saya",
  name: "Aturan Saya",
  onInbound(ctx) {
    if (ctx.message.text?.toLowerCase().includes("jam buka")) {
      return { reply: "Kami buka 09.00–17.00 WIB." }   // agen tidak dijalankan
    }
    return undefined                                    // lanjut ke agen
  },
})
```

- `{ reply: string }` → balasan ini dikirim dan agen **tidak** dijalankan (tetap tunduk pada otonomi akun).
- `{ handled: true }` → pesan dianggap tertangani tanpa balasan.
- `undefined` → lanjut ke agen.

Hook dijalankan sesuai urutan skill; hook pertama yang mengembalikan hasil menang. Lihat skill `autoreply` sebagai contoh lengkap.

## Distribusi

- **Lokal**: taruh di `skills/`.
- **Paket npm**: publikasikan sebagai `ibra-skill-<nama>` (ekspor `default` skill), lalu daftarkan di `config.skills.packages`.
- **MCP**: daftarkan server di `config.mcpServers`; tool MCP otomatis menjadi tool skill (lihat di bawah).

## Server MCP

Ibra X berbicara **Model Context Protocol** (stdio dan Streamable HTTP). Tool dari
server MCP didaftarkan sebagai skill dengan prefiks `<id>__` agar tidak bentrok:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]
    },
    "remote": { "url": "https://mcp.contoh.dev/mcp", "risk": "low" }
  }
}
```

Tool yang dianotasi `readOnlyHint` otomatis berisiko `low`, `destructiveHint` menjadi `high`.

## Praktik Terbaik

1. Mulai dari deskripsi tool yang jelas — ini yang dibaca model.
2. Jaga output tetap kecil; potong data besar.
3. Gunakan `risk` dengan jujur. Lebih baik `high` yang bertanya daripada `low` yang merusak.
4. Jangan pernah mengeksekusi instruksi yang berasal dari konten pengguna.
5. Jangan hardcode kredensial; baca dari `process.env`.
