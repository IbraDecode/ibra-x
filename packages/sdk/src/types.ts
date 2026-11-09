/**
 * Tipe inti Ibra X.
 *
 * Semua paket bergantung pada tipe di sini. Paket ini sengaja bebas dari
 * dependensi runtime (kecuali zod untuk validasi skema tool).
 */

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

/** Tingkat risiko sebuah aksi. `high` selalu memerlukan persetujuan. */
export type RiskLevel = "low" | "medium" | "high"

/** Tingkat otonomi agen. */
export type AutonomyLevel = "readonly" | "suggest" | "auto" | "autonomous"

/** Peran sebuah akun WhatsApp. */
export type AccountRole = "observer" | "assistant" | "hybrid"

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface Logger {
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
  child(bindings: Record<string, unknown>): Logger
}

// ---------------------------------------------------------------------------
// Skema JSON (kompatibel MCP / OpenAI function calling)
// ---------------------------------------------------------------------------

export interface JsonSchemaObject {
  type: "object"
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  [key: string]: unknown
}

export interface ToolSchema {
  name: string
  description: string
  parameters: JsonSchemaObject
}

// ---------------------------------------------------------------------------
// Pesan
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant" | "tool"

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: ChatRole
  content: string | null
  /** Nama tool saat role = "tool". */
  name?: string
  /** id tool call saat role = "tool". */
  toolCallId?: string
  /** Tool call yang dipancarkan asisten. */
  toolCalls?: ToolCall[]
}

// ---------------------------------------------------------------------------
// Provider LLM
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  /** id unik, mis. "openai", "anthropic", "ollama". */
  id: string
  label: string
  /** URL dasar API yang kompatibel OpenAI, mis. https://api.openai.com/v1 */
  baseUrl: string
  /** Nama variabel lingkungan untuk API key. */
  apiKeyEnv?: string
  /** Apakah provider memerlukan API key. */
  requiresKey: boolean
  /** Model yang disarankan (opsional). */
  recommendedModels?: string[]
  /** Header tambahan statis (opsional). */
  headers?: Record<string, string>
}

export interface CompleteRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
}

export type StreamChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call"; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason?: string }

export interface CompletionResult {
  message: ChatMessage
  usage: Usage
  finishReason?: string
}

export interface Provider {
  info: ProviderInfo
  stream(req: CompleteRequest): AsyncIterable<StreamChunk>
  complete(req: CompleteRequest): Promise<CompletionResult>
}

// ---------------------------------------------------------------------------
// Konteks tool & skill
// ---------------------------------------------------------------------------

/** Memori yang dapat diakses tool. */
export interface MemoryApi {
  remember(input: {
    scope: "global" | "contact" | "chat"
    scopeId?: string
    text: string
    tags?: string[]
    source?: string
    /** Akun WhatsApp yang mempelajari fakta ini (jejak lintas-nomor). */
    sourceAccountId?: string
  }): Promise<{ id: string; merged?: boolean }>
  search(query: string, opts?: { scope?: "global" | "contact" | "chat"; scopeId?: string; limit?: number }): Promise<
    Array<{ id: string; scope: string; scopeId?: string; text: string; tags: string[]; createdAt: number }>
  >
  forget(id: string): Promise<void>
}

/** Operasi WhatsApp lanjutan (opsional; bergantung pada transport). */
export interface WhatsAppOps {
  /** Beri reaksi emoji pada sebuah pesan. */
  react(chatId: string, messageId: string, emoji: string, opts?: { fromMe?: boolean; accountId?: string }): Promise<void>
  /** Sunting pesan teks yang pernah dikirim. */
  editMessage(chatId: string, messageId: string, text: string, opts?: { accountId?: string }): Promise<void>
  /** Hapus pesan (untuk semua orang bila memungkinkan). */
  deleteMessage(chatId: string, messageId: string, opts?: { forEveryone?: boolean; accountId?: string }): Promise<void>
  /** Setel status presence (sedang menulis, dsb.). */
  setPresence(chatId: string, state: "composing" | "paused" | "available", opts?: { accountId?: string }): Promise<void>
  /** Daftar chat yang dikenal store lokal. */
  listChats(opts?: { accountId?: string }): Promise<Array<{ id: string; kind: string; name?: string }>>
  /** Metadata grup (anggota, nama). */
  getGroupInfo(chatId: string, opts?: { accountId?: string }): Promise<{ id: string; name?: string; participants: string[] } | undefined>

  /** Cek apakah nomor terdaftar di WhatsApp. */
  onWhatsApp(numbers: string[], opts?: { accountId?: string }): Promise<Array<{ jid: string; exists: boolean }>>
  /** Buat grup baru. Mengembalikan JID grup. */
  groupCreate(subject: string, participants: string[], opts?: { accountId?: string }): Promise<{ id: string }>
  /** Ubah keanggotaan grup. */
  groupParticipants(
    chatId: string,
    action: "add" | "remove" | "promote" | "demote",
    participants: string[],
    opts?: { accountId?: string },
  ): Promise<void>
  /** Kode undangan grup. */
  groupInviteCode(chatId: string, opts?: { accountId?: string }): Promise<string | undefined>
  /** Ubah pengaturan grup (announcement/locked). */
  groupSetting(
    chatId: string,
    setting: "announcement" | "not_announcement" | "locked" | "unlocked",
    opts?: { accountId?: string },
  ): Promise<void>
  /** Kirim lokasi. */
  sendLocation(
    chatId: string,
    location: { latitude: number; longitude: number; name?: string; address?: string },
    opts?: { accountId?: string },
  ): Promise<void>
  /** Kirim poll. */
  sendPoll(
    chatId: string,
    poll: { name: string; options: string[]; selectableCount?: number },
    opts?: { accountId?: string },
  ): Promise<void>
  /** URL foto profil. */
  profilePictureUrl(chatId: string, opts?: { accountId?: string }): Promise<string | undefined>
  /** Blokir/buka blokir kontak. */
  blockStatus(chatId: string, block: boolean, opts?: { accountId?: string }): Promise<void>
}

/** Delegasi ke sub-agen dengan konteks terisolasi. */
export interface SubagentApi {
  /** Menjalankan sub-agen; hanya ringkasan akhir yang kembali ke pemanggil. */
  run(task: string, opts?: { model?: string; role?: string }): Promise<{ text: string; reason: string; steps: number }>
}

/** Kapabilitas runtime yang dapat dipanggil tool. */
export interface RuntimeApi {
  /** ID akun WhatsApp yang sedang aktif. */
  readonly accountId: string
  /** Kirim pesan WhatsApp ke sebuah chat. */
  sendMessage(
    chatId: string,
    payload: { text: string } | { mediaPath: string; mime: string; caption?: string },
    opts?: { replyTo?: string; accountId?: string },
  ): Promise<{ messageId: string; messageIds?: string[] }>
  /** Ambil riwayat pesan sebuah chat dari store lokal. */
  getChatHistory(chatId: string, opts?: { limit?: number }): Promise<
    Array<{ id: string; fromMe: boolean; senderId: string; text: string; timestamp: number }>
  >
  /** Tandai pesan sudah dibaca. */
  markRead(chatId: string, messageIds: string[]): Promise<void>
  /** Memori jangka panjang. */
  readonly memory: MemoryApi
  /** Operasi WhatsApp lanjutan (bila transport mendukung). */
  readonly whatsapp?: WhatsAppOps
  /** Delegasi ke sub-agen (bila diaktifkan). */
  readonly subagent?: SubagentApi
}

/** Penyimpanan kunci-nilai ber-namespace untuk sebuah skill. */
export interface SkillStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>
}

export interface ToolContext {
  logger: Logger
  runtime: RuntimeApi
  store: SkillStore
  sessionId: string
  accountId: string
  /** Chat asal pesan (bila ada). */
  chatId?: string
  /** Pengirim pesan (bila ada). */
  senderId?: string
  signal?: AbortSignal
  /** Minta persetujuan manusia sebelum melanjutkan (menghasilkan tugas terparkir). */
  requestApproval(reason: string): Promise<{ approved: boolean }>
}

// ---------------------------------------------------------------------------
// Tool & Skill
// ---------------------------------------------------------------------------

export interface Tool<In = unknown, Out = unknown> {
  name: string
  description: string
  parameters: JsonSchemaObject
  risk: RiskLevel
  /** Bila true, selalu minta persetujuan walau tingkat otonomi mengizinkan. */
  requiresApproval?: boolean
  execute(input: In, ctx: ToolContext): Promise<Out>
}

export interface SkillCommand {
  name: string
  description: string
  run(ctx: ToolContext, args: string): Promise<string>
}

export interface SkillSetupApi {
  logger: Logger
  store: SkillStore
}

/** Konteks yang diberikan ke job terjadwal milik skill. */
export interface JobContext {
  logger: Logger
  store: SkillStore
  runtime: RuntimeApi
}

/** Job periodik yang didaftarkan skill dan dijalankan scheduler. */
export interface SkillJob {
  id: string
  /** Interval antar-jalan dalam milidetik. */
  intervalMs: number
  run(ctx: JobContext): Promise<void>
}

/** Konteks hook pesan masuk (dipanggil sebelum agen berjalan). */
export interface InboundHookContext {
  message: InboundMessage
  logger: Logger
  store: SkillStore
  runtime: RuntimeApi
}

export interface InboundHookResult {
  /** Bila diisi, balasan ini dikirim dan agen TIDAK dijalankan. */
  reply?: string
  /** Bila true, pesan dianggap tertangani tanpa balasan. */
  handled?: boolean
}

export interface Skill {
  /** id unik, mis. "whatsapp", "reminders". */
  id: string
  name: string
  description?: string
  version?: string
  tools?: Tool[]
  commands?: SkillCommand[]
  /** Job periodik (cron) milik skill. */
  jobs?: SkillJob[]
  /** Hook deterministik untuk pesan masuk (short-circuit sebelum LLM). */
  onInbound?(ctx: InboundHookContext): Promise<InboundHookResult | undefined> | InboundHookResult | undefined
  /** Tambahan system prompt yang aktif selama skill ini terpasang. */
  systemPrompt?: string
  setup?(api: SkillSetupApi): Promise<void> | void
}

// ---------------------------------------------------------------------------
// Envelope pesan WhatsApp yang dinormalisasi
// ---------------------------------------------------------------------------

export interface InboundMessage {
  /** Kunci idempotensi = id pesan WhatsApp. */
  id: string
  accountId: string
  chatId: string
  chatKind: "dm" | "group"
  senderId: string
  /** Bentuk alternatif identitas pengirim (PN saat pengirim LID). */
  senderAlt?: string
  fromMe: boolean
  timestamp: number
  text?: string
  media?: { kind: string; mime?: string; localPath?: string; caption?: string }
  mentions?: string[]
  quotedId?: string
}
