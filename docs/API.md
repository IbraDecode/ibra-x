# Referensi API SDK

Referensi ini mencakup permukaan publik yang dipakai untuk membangun skill dan meng-embed agen.

## Impor

- Di dalam repo ini: `import { defineSkill, defineTool } from "@ibrax/sdk"`.
- Untuk penulis skill eksternal (dari paket npm): `npm i ibra-x` lalu `import { defineSkill, defineTool } from "ibra-x/sdk"`.

## `defineSkill(input)`

```ts
defineSkill({
  id: string,                 // unik, mis. "cuaca"
  name: string,               // nama tampilan
  description?: string,
  version?: string,
  tools?: Tool[],             // tool yang diekspos ke agen
  commands?: SkillCommand[],  // (opsional) perintah teks
  jobs?: SkillJob[],          // (opsional) pekerjaan periodik
  onInbound?(ctx): InboundHookResult | undefined,  // (opsional) hook pesan masuk
  systemPrompt?: string,      // ditambahkan ke system prompt selama skill aktif
  setup?(api: SkillSetupApi), // dipanggil sekali saat pemuatan
})
```

## `defineTool(input)`

```ts
defineTool<Input, Output>({
  name: string,               // ^[a-zA-Z0-9_-]{1,64}$, unik lintas skill
  description: string,
  parameters: JsonSchemaObject,   // skema JSON (kompatibel MCP/OpenAI)
  risk?: "low" | "medium" | "high",   // default "low"
  requiresApproval?: boolean,         // selalu minta persetujuan
  execute: (input, ctx: ToolContext) => Promise<Output>,
})
```

`JsonSchemaObject`:

```ts
{ type: "object", properties?: Record<string, unknown>, required?: string[], additionalProperties?: boolean }
```

## `ToolContext` (argumen `ctx` pada `execute`)

```ts
interface ToolContext {
  logger: Logger                 // .debug/.info/.warn/.error/.child
  runtime: RuntimeApi            // lihat di bawah
  store: SkillStore              // penyimpanan kunci-nilai milik skill ini
  sessionId: string
  accountId: string              // akun WhatsApp aktif
  chatId?: string                // chat asal (bila ada)
  senderId?: string              // pengirim asal (bila ada)
  signal?: AbortSignal
  requestApproval(reason: string): Promise<{ approved: boolean }>
}
```

## `RuntimeApi`

```ts
interface RuntimeApi {
  readonly accountId: string

  sendMessage(
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string; ptt?: boolean },
    opts?: { replyTo?: string; accountId?: string },
  ): Promise<{ messageId: string; messageIds?: string[] }>

  getChatHistory(chatId: string, opts?: { limit?: number }): Promise<
    Array<{ id: string; fromMe: boolean; senderId: string; text: string; timestamp: number }>
  >

  markRead(chatId: string, messageIds: string[]): Promise<void>

  readonly memory: MemoryApi          // remember / search / forget
  readonly whatsapp?: WhatsAppOps     // operasi WhatsApp lanjutan (lihat bawah)
  readonly subagent?: SubagentApi     // subagent.run(task, opts)
  readonly speech?: SpeechApi         // speech.synthesize(text) → path audio
  readonly handoff?: HandoffApi       // enable / disable / isActive / list
  readonly approvals?: ApprovalApi    // list / approve / reject (tugas terparkir)
}
```

### `ApprovalApi`

```ts
interface ApprovalApi {
  // Daftar aksi yang menunggu persetujuan (opsional filter akun).
  list(opts?: { accountId?: string }): ApprovalInfo[]
  // Setujui & lanjutkan (menjalankan ulang agen dengan izin).
  approve(id: string): Promise<{ ok: boolean; text?: string; reason?: string }>
  // Tolak aksi terparkir.
  reject(id: string): Promise<{ ok: boolean }>
}
```

### `MemoryApi`

```ts
remember(input: {
  scope: "global" | "contact" | "chat"
  scopeId?: string
  text: string
  tags?: string[]
  source?: string
  sourceAccountId?: string
}): Promise<{ id: string; merged?: boolean }>

search(query, opts?: { scope?; scopeId?; limit? }): Promise<MemoryRow[]>
forget(id: string): Promise<void>
```

### `WhatsAppOps` (opsional; bergantung pada transport)

`react`, `editMessage`, `deleteMessage`, `setPresence`, `listChats`, `getGroupInfo`,
`onWhatsApp`, `groupCreate`, `groupParticipants`, `groupInviteCode`, `groupSetting`,
`sendLocation`, `sendPoll`, `profilePictureUrl`, `blockStatus`. Masing-masing menerima
`opts?: { accountId?: string }` (kecuali `listChats`).

### `SubagentApi`

```ts
run(task: string, opts?: { model?: string; role?: string }):
  Promise<{ text: string; reason: string; steps: number }>
```

### `SpeechApi`

```ts
synthesize(text: string): Promise<string>  // mengembalikan path berkas audio lokal
```

## `SkillStore`

```ts
get<T>(key: string): Promise<T | undefined>
set(key: string, value: unknown): Promise<void>
delete(key: string): Promise<void>
list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>
```

Ter-namespace per `skill.id`, sehingga skill tidak saling menimpa data.

## Hook pesan masuk (`onInbound`)

```ts
onInbound(ctx: {
  message: InboundMessage
  logger: Logger
  store: SkillStore
  runtime: RuntimeApi
}): InboundHookResult | undefined

type InboundHookResult = { reply?: string; handled?: boolean }
```

- `{ reply }` → balasan dikirim, agen **tidak** dijalankan (tetap tunduk pada otonomi akun/observer).
- `{ handled: true }` → pesan dianggap tertangani, tanpa balasan.
- `undefined` → lanjut ke agen.

## Job periodik (`jobs`)

```ts
jobs: [{
  id: string
  intervalMs: number
  run(ctx: { logger: Logger; store: SkillStore; runtime: RuntimeApi }): Promise<void>
}]
```

Kegagalan satu job dicatat dan tidak menghentikan job lain.

## Tipe penting lain

| Tipe | Keterangan |
|---|---|
| `RiskLevel` | `"low" \| "medium" \| "high"` |
| `AutonomyLevel` | `"readonly" \| "suggest" \| "auto" \| "autonomous"` |
| `AccountRole` | `"observer" \| "assistant" \| "hybrid"` |
| `InboundMessage` | Pesan masuk yang dinormalisasi (id, chatId, chatKind, senderId, text, media, …) |
| `ChatMessage` / `ToolCall` | Tipe pesan model & pemanggilan tool |
| `Provider` / `CompleteRequest` | Antarmuka provider LLM (untuk adaptor kustom) |
| `Logger` | `.debug/.info/.warn/.error/.child` |

## Contoh minimal

```ts
import { defineSkill, defineTool } from "ibra-x/sdk"

export default defineSkill({
  id: "cuaca",
  name: "Cuaca",
  tools: [
    defineTool({
      name: "get_weather",
      description: "Ambil cuaca sebuah kota.",
      parameters: { type: "object", properties: { kota: { type: "string" } }, required: ["kota"] },
      risk: "low",
      async execute({ kota }, ctx) {
        ctx.logger.info({ kota }, "mengambil cuaca")
        return { kota, suhu: "27°C" }
      },
    }),
  ],
})
```

Lihat [`SKILLS.md`](SKILLS.md) untuk panduan penulisan dan distribusi skill.
