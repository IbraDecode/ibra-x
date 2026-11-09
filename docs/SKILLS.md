# Menulis Skill Ibra X

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
